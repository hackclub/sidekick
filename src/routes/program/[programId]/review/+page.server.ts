import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient } from '$lib/server/protocol/client.js';
import type { Project } from '$lib/server/protocol/types.js';
import { resolveActorIds } from '$lib/server/actors.js';
import { createLogger } from '$lib/server/logger.js';
import type { PageServerLoad } from './$types.js';

const log = createLogger('page:review-list');

// Fetch every page of projects for a status. The review queue must surface all
// pending projects — including the longest-waiting ones, which the upstream's
// created_at-desc ordering pushes past the first page. The upstream caps `limit`
// at 100, so a single large fetch is not enough once pending exceeds that.
async function fetchAllProjects(
	client: ProtocolClient,
	status: 'pending' | 'pending_hq'
): Promise<{ projects: Project[]; totalCount: number }> {
	const projects: Project[] = [];
	let cursor: string | undefined;
	let totalCount = 0;

	for (;;) {
		const result = await client.fetchProjects({ status, cursor, limit: 100 });
		projects.push(...result.projects);
		totalCount = result.totalCount;
		if (!result.nextCursor) break;
		cursor = result.nextCursor;
	}

	return { projects, totalCount };
}

export const load: PageServerLoad = async ({ params, parent }) => {
	const tLoad = log.time('load');
	const { user } = await parent();
	if (!user) throw redirect(302, '/auth/login');

	const membership = await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});

	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);

	const now = new Date();
	const weekAgo = new Date(now.getTime() - 7 * 86400000);
	const twelveWeeksAgo = new Date(now.getTime() - 12 * 7 * 86400000);

	const [projectsResult, hqProjectsResult, statsResult, reviewLogs, pendingApprovals] = await Promise.all([
		fetchAllProjects(client, 'pending'),
		fetchAllProjects(client, 'pending_hq'),
		client.getProgramStats({}),
		db.auditLog.findMany({
			where: {
				programId: params.programId,
				action: { startsWith: 'review_' }
			},
			include: { user: true },
			orderBy: { createdAt: 'desc' },
			take: 500
		}),
		membership.canAuthorizeReviews
			? db.pendingApproval.findMany({
					where: { programId: params.programId, status: 'pending' },
					orderBy: { createdAt: 'asc' }
				})
			: Promise.resolve([])
	]);

	// Filter to projects that actually have pending_hq ships (endpoints that
	// don't support the status may return all projects).
	const hqProjects = hqProjectsResult.projects.filter(
		(p) => p.ships.some((s) => s.status === 'pending_hq')
	);

	const allProjects = [...projectsResult.projects, ...hqProjects];
	const approvedShipIds = allProjects
		.flatMap((p) => p.ships.filter((s) => s.status === 'approved').map((s) => s.id));

	const approvalLogs = approvedShipIds.length > 0
		? await db.auditLog.findMany({
				where: {
					programId: params.programId,
					action: { in: ['review_approve', 'review_authorize'] },
					entityType: 'ship',
					entityId: { in: approvedShipIds }
				},
				orderBy: { createdAt: 'desc' },
				select: { entityId: true, createdAt: true }
			})
		: [];

	const shipApprovalDates: Record<string, string> = {};
	for (const log of approvalLogs) {
		if (log.entityId && !shipApprovalDates[log.entityId]) {
			shipApprovalDates[log.entityId] = log.createdAt.toISOString();
		}
	}

	// Sort by earliest pending ship submission date so longest-waiting projects
	// appear first in the review queue.
	const getPendingDate = (p: typeof projectsResult.projects[0], shipStatus: string) => {
		const ship = p.ships.find((s) => s.status === shipStatus);
		return ship ? new Date(ship.submittedAt).getTime() : Infinity;
	};
	projectsResult.projects.sort((a, b) => getPendingDate(a, 'pending') - getPendingDate(b, 'pending'));
	hqProjects.sort((a, b) => getPendingDate(a, 'pending_hq') - getPendingDate(b, 'pending_hq'));

	const authorIds = [...new Set([
		...projectsResult.projects.map((p) => p.authorId),
		...hqProjects.map((p) => p.authorId)
	])];
	for (const pa of pendingApprovals) {
		authorIds.push(pa.reviewerId);
	}
	const actors = await resolveActorIds([...new Set(authorIds)]);

	const actorsObj: Record<string, { name: string; avatarUrl: string | null }> = {};
	for (const [id, actor] of actors) {
		actorsObj[id] = { name: actor.name, avatarUrl: actor.avatarUrl };
	}

	// Leaderboards
	const weeklyLogs = reviewLogs.filter((l) => l.createdAt >= weekAgo);
	const reviewLeaderboardWeekly = aggregateByUser(weeklyLogs);
	const reviewLeaderboardAllTime = aggregateByUser(reviewLogs);

	// Review volume: count per week for last 12 weeks
	const reviewVolume = buildWeeklyVolume(reviewLogs, twelveWeeksAgo, now);
	const totalReviewsThisWeek = weeklyLogs.length;

	log.info('review list loaded', {
		programId: params.programId,
		projectCount: projectsResult.projects.length,
		hqProjectCount: hqProjects.length,
		pendingCount: statsResult.pendingReviewCount,
		pendingApprovalCount: pendingApprovals.length,
		totalReviewsThisWeek
	});
	tLoad.end();

	return {
		projects: projectsResult.projects,
		hqProjects,
		actors: actorsObj,
		nextCursor: null,
		totalCount: projectsResult.totalCount,
		pendingCount: statsResult.pendingReviewCount,
		pendingHqCount: statsResult.pendingHqCount ?? hqProjects.length,
		reviewLeaderboardWeekly,
		reviewLeaderboardAllTime,
		reviewVolume,
		totalReviewsThisWeek,
		shipApprovalDates,
		canAuthorize: membership.canAuthorizeReviews,
		pendingApprovals: pendingApprovals.map((pa) => ({
			id: pa.id,
			projectId: pa.projectId,
			shipId: pa.shipId,
			reviewerId: pa.reviewerId,
			hoursAssigned: pa.hoursAssigned,
			feedbackMessage: pa.feedbackMessage,
			justification: pa.justification,
			createdAt: pa.createdAt.toISOString()
		}))
	};
};

function aggregateByUser(
	logs: Array<{ user: { name: string; avatarUrl: string | null } }>
): Array<{ username: string; avatarUrl: string | null; value: number }> {
	const map = new Map<string, { avatarUrl: string | null; count: number }>();
	for (const log of logs) {
		const existing = map.get(log.user.name);
		if (existing) {
			existing.count++;
		} else {
			map.set(log.user.name, { avatarUrl: log.user.avatarUrl, count: 1 });
		}
	}
	return Array.from(map.entries())
		.map(([username, { avatarUrl, count }]) => ({ username, avatarUrl, value: count }))
		.sort((a, b) => b.value - a.value);
}

function buildWeeklyVolume(
	logs: Array<{ createdAt: Date }>,
	start: Date,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	_end: Date
): number[] {
	const weeks: number[] = new Array(12).fill(0);
	const startMs = start.getTime();
	const weekMs = 7 * 86400000;
	for (const log of logs) {
		const logMs = log.createdAt.getTime();
		if (logMs < startMs) continue;
		const weekIndex = Math.min(Math.floor((logMs - startMs) / weekMs), 11);
		weeks[weekIndex]++;
	}
	return weeks;
}
