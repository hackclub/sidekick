import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient } from '$lib/server/protocol/client.js';
import { resolveActorIds } from '$lib/server/actors.js';
import {
	getProjectHackatimeStats,
	getTrustLogs,
	getUserInfo
} from '$lib/server/integrations/hackatime.js';
import type { TrustLog, UserInfo } from '$lib/server/integrations/hackatime.js';
import { getCommits, parseRepoUrl } from '$lib/server/integrations/github.js';
import { fraudReviewShip, loadFraudReviewState } from '$lib/server/fraud-review.js';
import { createLogger } from '$lib/server/logger.js';
import type { PageServerLoad } from './$types.js';

const log = createLogger('page:fraud-review');

// Only what the review page's Hackatime cards need, and nothing else it
// loads: one protocol call (project detail, for the keys and ships), the
// author's Hackatime timezone and trust, and, streamed, the time totals and
// commit times the viewer marks. No timeline, Airtable, README, Lapse,
// Lookout, checks or presence: a fraud pass reads heartbeats only.
export const load: PageServerLoad = async ({ params, parent }) => {
	const tLoad = log.time('load');
	const { user } = await parent();
	if (!user) throw redirect(302, '/auth/login');

	const membership = await requirePermission(user.id, params.programId, 'canViewHeartbeats', {
		isSuperAdmin: user.isSuperAdmin
	});

	const program = await db.program.findUniqueOrThrow({ where: { id: params.programId } });
	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);
	const project = await client.fetchProjectDetail({ projectId: params.projectId });
	const pendingShip = fraudReviewShip(project);

	const hasHackatime = project.hackatimeProjectKeys.length > 0;
	const hackatimeUser = project.hackatimeId ?? project.authorId;

	const [actors, authorUser, userInfo, fraudReview] = await Promise.all([
		resolveActorIds([project.authorId]),
		db.user.findFirst({
			where: project.authorId.startsWith('U')
				? { slackId: project.authorId }
				: { hcaId: project.authorId },
			select: { hackatimeId: true }
		}),
		hasHackatime
			? getUserInfo(hackatimeUser).catch((e) => {
					log.warn('getUserInfo failed', { error: e });
					return null as UserInfo | null;
				})
			: Promise.resolve(null as UserInfo | null),
		loadFraudReviewState(params.programId, project)
	]);
	const author = actors.get(project.authorId);

	// Same aggregation as the review page, scoped to the program's Hackatime
	// start date so time logged on a reused project before the event doesn't
	// count toward the totals.
	const hackatimeData = (async () => {
		if (!hasHackatime) return null;
		try {
			const [stats, trustLogs] = await Promise.all([
				getProjectHackatimeStats(
					hackatimeUser,
					project.hackatimeProjectKeys,
					project.hackatimeStartDate
				),
				getTrustLogs(hackatimeUser).catch((e) => {
					log.warn('trust logs fetch failed', { error: e });
					return [] as TrustLog[];
				})
			]);
			return {
				totalSeconds: stats.projects.reduce((s, p) => s + p.totalSeconds, 0),
				aiSeconds: stats.aiSeconds,
				browserSeconds: stats.browserSeconds,
				aiAndBrowserSeconds: stats.aiAndBrowserSeconds,
				truncated: stats.truncated,
				trustLogs,
				projectBreakdown: stats.projects.map((p) => ({
					name: p.name,
					totalSeconds: p.totalSeconds
				}))
			};
		} catch (e) {
			log.error('hackatime integration failed', e);
			return null;
		}
	})();

	// Commit times for the viewer's day markers. Commits are all the GitHub this
	// page reads (no repo info or README), and they're cached in memory, so a
	// reviewer stepping back to a project doesn't refetch them.
	const repo = parseRepoUrl(project.codeUrl);
	const commitsData = (async () => {
		if (!repo || !hasHackatime) return [];
		try {
			const commits = repo.branch
				? await getCommits(repo.owner, repo.repo, { sha: repo.branch }).catch(() =>
						getCommits(repo.owner, repo.repo)
					)
				: await getCommits(repo.owner, repo.repo);
			return commits.map((c) => ({
				sha: c.sha,
				message: c.message,
				author: c.author,
				authorLogin: c.authorLogin,
				authorAvatarUrl: c.authorAvatarUrl,
				date: c.date
			}));
		} catch (e) {
			log.warn('commit fetch failed', { error: e });
			return [];
		}
	})();

	tLoad.end({ projectId: project.id });

	return {
		project: {
			id: project.id,
			title: project.title,
			authorId: project.authorId,
			hackatimeProjectKeys: project.hackatimeProjectKeys,
			hackatimeStartDate: project.hackatimeStartDate,
			ships: project.ships.map((s) => ({
				id: s.id,
				status: s.status,
				hoursSubmitted: s.hoursSubmitted,
				submittedAt: s.submittedAt
			}))
		},
		pendingShip: pendingShip
			? {
					id: pendingShip.id,
					number: project.ships.indexOf(pendingShip) + 1,
					status: pendingShip.status,
					hoursSubmitted: pendingShip.hoursSubmitted,
					submittedAt: pendingShip.submittedAt
				}
			: null,
		author: {
			name: author?.name ?? project.authorId,
			avatarUrl: author?.avatarUrl ?? null,
			slackId: author?.slackId ?? null,
			hackatimeId: authorUser?.hackatimeId ?? project.hackatimeId ?? null
		},
		hackatimeUser: hasHackatime ? hackatimeUser : null,
		authorTimezone: userInfo?.timezone ?? 'UTC',
		trustLevel: userInfo?.trustLevel ?? null,
		fraudReview,
		canOpenReview: membership.canViewReviews,
		hackatimeData,
		commitsData
	};
};
