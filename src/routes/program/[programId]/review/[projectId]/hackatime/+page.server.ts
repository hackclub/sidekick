import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient } from '$lib/server/protocol/client.js';
import { resolveActorId } from '$lib/server/actors.js';
import { getProjectHackatimeStats, getUserInfo } from '$lib/server/integrations/hackatime.js';
import { parseRepoUrl, getCommits } from '$lib/server/integrations/github.js';
import { createLogger } from '$lib/server/logger.js';
import type { PageServerLoad } from './$types.js';

const log = createLogger('page:review:hackatime');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Below md the viewer switches to its mobile layout, which the review page
// never shows a desktop reviewer.
const MIN_WIDTH = 768;
const MAX_WIDTH = 3840;

// The review page's Hackatime section on its own, for a reviewer's local
// snapshot client to screenshot (see HACKATIME_EXPORT_ROUTE in mcp/tokens.ts).
// It loads what that section's props come from in the review page's load and
// nothing else: no Airtable, checks, Lapse, Lookout or timeline. Day markers
// are the ships and the GitHub commits, which need no timeline merging.
export const load: PageServerLoad = async ({ params, parent, url }) => {
	const { user } = await parent();
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canViewHeartbeats', {
		isSuperAdmin: user.isSuperAdmin
	});

	const date = url.searchParams.get('date');
	if (date && !DATE_RE.test(date)) throw error(400, 'date must be YYYY-MM-DD');
	const widthParam = url.searchParams.get('width');
	const width = widthParam ? Number(widthParam) : null;
	if (width !== null && !(Number.isInteger(width) && width >= MIN_WIDTH && width <= MAX_WIDTH)) {
		throw error(400, `width must be a whole number of pixels from ${MIN_WIDTH} to ${MAX_WIDTH}`);
	}
	const tab = url.searchParams.get('tab') ?? 'graph';
	if (!['graph', 'breakdown', 'files'].includes(tab)) {
		throw error(400, 'tab must be graph, breakdown or files');
	}

	const program = await db.program.findUniqueOrThrow({ where: { id: params.programId } });
	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);
	const project = await client.fetchProjectDetail({ projectId: params.projectId });

	const hackatimeUser = project.hackatimeId ?? project.authorId;
	const hasHackatime = !!hackatimeUser && project.hackatimeProjectKeys.length > 0;
	const pendingShip = project.ships.findLast(
		(s) => s.status === 'pending' || s.status === 'pending_hq'
	);

	const [author, userInfo] = await Promise.all([
		resolveActorId(project.authorId),
		hasHackatime
			? getUserInfo(hackatimeUser).catch((e) => {
					log.warn('getUserInfo failed', { error: e });
					return null;
				})
			: null
	]);
	const authorTimezone = userInfo?.timezone ?? 'UTC';

	// Streamed like the review page's hackatimeData, so the viewer's own
	// fetches start while the totals for the project pills are computed.
	const projectBreakdown = (async () => {
		if (!hasHackatime) return [];
		try {
			const stats = await getProjectHackatimeStats(
				hackatimeUser,
				project.hackatimeProjectKeys,
				project.hackatimeStartDate
			);
			return stats.projects.map((p) => ({ name: p.name, totalSeconds: p.totalSeconds }));
		} catch (e) {
			log.error('hackatime stats failed', e);
			return [];
		}
	})();

	const repo = parseRepoUrl(project.codeUrl);
	const commits = (async () => {
		if (!repo) return [];
		try {
			// Same branch fallback as the review page's githubData.
			const list = repo.branch
				? await getCommits(repo.owner, repo.repo, { sha: repo.branch }).catch(() =>
						getCommits(repo.owner, repo.repo)
					)
				: await getCommits(repo.owner, repo.repo);
			return list.map((c) => ({
				date: c.date,
				message: c.message,
				author: c.author,
				authorLogin: c.authorLogin,
				authorAvatarUrl: c.authorAvatarUrl
			}));
		} catch (e) {
			log.error('github commits failed', e);
			return [];
		}
	})();

	return {
		programId: params.programId,
		projectId: params.projectId,
		hackatimeUser: hasHackatime ? hackatimeUser : null,
		hackatimeProjectKeys: project.hackatimeProjectKeys,
		hackatimeStartDate: project.hackatimeStartDate,
		authorTimezone,
		// The review page opens the pending ship's day (in the author's
		// timezone) until the viewer picks the newest active day; a requested
		// date is selected over that once the day list is in.
		defaultDate:
			date ??
			(pendingShip?.submittedAt
				? new Date(pendingShip.submittedAt).toLocaleDateString('sv-SE', {
						timeZone: authorTimezone
					})
				: undefined),
		date,
		width,
		tab,
		ships: project.ships.map((s) => ({
			submittedAt: s.submittedAt,
			hoursSubmitted: s.hoursSubmitted
		})),
		author: { name: author.name, avatarUrl: author.avatarUrl },
		projectBreakdown,
		commits
	};
};
