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
): Promise<{ projects: Project[]; totalCount: number; explicitlySorted: boolean }> {
	const projects: Project[] = [];
	let cursor: string | undefined;
	let totalCount = 0;
	// The program advertises its own ordering via `explicitlySorted`. Honor it if
	// any page of this status query sets it — pages are concatenated in cursor
	// order, so the received order is preserved as-is.
	let explicitlySorted = false;

	for (;;) {
		const result = await client.fetchProjects({ status, cursor, limit: 100 });
		projects.push(...result.projects);
		totalCount = result.totalCount;
		if (result.explicitlySorted) explicitlySorted = true;
		if (!result.nextCursor) break;
		cursor = result.nextCursor;
	}

	return { projects, totalCount, explicitlySorted };
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

	const [projectsResult, hqProjectsResult, statsResult, tagDefinitions, tagAssignments, pendingApprovals] = await Promise.all([
		fetchAllProjects(client, 'pending'),
		fetchAllProjects(client, 'pending_hq'),
		client.getProgramStats({}),
		db.projectTagDefinition.findMany({
			where: { programId: params.programId },
			orderBy: { label: 'asc' },
			select: { id: true, label: true, color: true }
		}),
		db.projectTagAssignment.findMany({
			where: { programId: params.programId },
			select: { projectId: true, tagId: true }
		}),
		membership.canAuthorizeReviews
			? db.pendingApproval.findMany({
					where: { programId: params.programId, status: 'pending' },
					orderBy: { createdAt: 'asc' }
				})
			: Promise.resolve([])
	]);

	const projectTagIds: Record<string, string[]> = {};
	for (const a of tagAssignments) {
		(projectTagIds[a.projectId] ??= []).push(a.tagId);
	}

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
	// appear first in the review queue — unless the program advertised its own
	// ordering via `explicitlySorted`, in which case we preserve what we received.
	const getPendingDate = (p: typeof projectsResult.projects[0], shipStatus: string) => {
		const ship = p.ships.find((s) => s.status === shipStatus);
		return ship ? new Date(ship.submittedAt).getTime() : Infinity;
	};
	if (!projectsResult.explicitlySorted) {
		projectsResult.projects.sort((a, b) => getPendingDate(a, 'pending') - getPendingDate(b, 'pending'));
	}
	if (!hqProjectsResult.explicitlySorted) {
		hqProjects.sort((a, b) => getPendingDate(a, 'pending_hq') - getPendingDate(b, 'pending_hq'));
	}

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

	log.info('review list loaded', {
		programId: params.programId,
		projectCount: projectsResult.projects.length,
		hqProjectCount: hqProjects.length,
		pendingCount: statsResult.pendingReviewCount,
		pendingApprovalCount: pendingApprovals.length
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
		explicitlySorted: projectsResult.explicitlySorted || hqProjectsResult.explicitlySorted,
		tagDefinitions,
		projectTagIds,
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
