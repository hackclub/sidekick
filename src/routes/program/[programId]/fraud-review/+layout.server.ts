import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient } from '$lib/server/protocol/client.js';
import { resolveActorIds } from '$lib/server/actors.js';
import { fraudReviewShip, loadFraudReviewStates } from '$lib/server/fraud-review.js';
import { createLogger } from '$lib/server/logger.js';
import type { Project } from '$lib/server/protocol/types.js';
import type { LayoutServerLoad } from './$types.js';

const log = createLogger('page:fraud-review-list');

// Every page of a status, as the review queue fetches it: the upstream sorts
// newest first and caps `limit` at 100, so the longest-waiting projects are
// on the last pages.
async function fetchAllProjects(client: ProtocolClient, status: 'pending' | 'pending_hq') {
	const projects: Project[] = [];
	let cursor: string | undefined;
	let explicitlySorted = false;
	for (;;) {
		const result = await client.fetchProjects({ status, cursor, limit: 100 });
		projects.push(...result.projects);
		if (result.explicitlySorted) explicitlySorted = true;
		if (!result.nextCursor) break;
		cursor = result.nextCursor;
	}
	return { projects, explicitlySorted };
}

// The list lives in the layout so that moving from one project to the next
// reloads only the selected project, not every page of the queue.
export const load: LayoutServerLoad = async ({ params, parent }) => {
	const tLoad = log.time('load');
	const { user } = await parent();
	if (!user) throw redirect(302, '/auth/login');

	await requirePermission(user.id, params.programId, 'canViewHeartbeats', {
		isSuperAdmin: user.isSuperAdmin
	});

	const program = await db.program.findUniqueOrThrow({ where: { id: params.programId } });
	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);

	const [pending, pendingHq] = await Promise.all([
		fetchAllProjects(client, 'pending'),
		fetchAllProjects(client, 'pending_hq')
	]);

	// A project can appear under both statuses; the ship a verdict lands on is
	// its most recent pending one either way. Endpoints that don't support
	// pending_hq may return every project, so those without one drop out.
	const byId = new Map<
		string,
		{ project: Project; ship: NonNullable<ReturnType<typeof fraudReviewShip>> }
	>();
	for (const project of [...pending.projects, ...pendingHq.projects]) {
		const ship = fraudReviewShip(project);
		if (ship && !byId.has(project.id)) byId.set(project.id, { project, ship });
	}
	const entries = [...byId.values()];
	if (!pending.explicitlySorted && !pendingHq.explicitlySorted) {
		entries.sort(
			(a, b) => new Date(a.ship.submittedAt).getTime() - new Date(b.ship.submittedAt).getTime()
		);
	}

	const [actors, verdicts] = await Promise.all([
		resolveActorIds([...new Set(entries.map((e) => e.project.authorId))]),
		loadFraudReviewStates(params.programId, new Map(entries.map((e) => [e.project.id, e.ship.id])))
	]);

	log.info('fraud review list loaded', {
		programId: params.programId,
		projectCount: entries.length,
		verdictCount: verdicts.size
	});
	tLoad.end();

	return {
		queue: entries.map(({ project, ship }) => {
			const author = actors.get(project.authorId);
			return {
				id: project.id,
				title: project.title,
				author: { name: author?.name ?? project.authorId, avatarUrl: author?.avatarUrl ?? null },
				shipId: ship.id,
				shipNumber: project.ships.indexOf(ship) + 1,
				shipStatus: ship.status as 'pending' | 'pending_hq',
				hoursClaimed: ship.hoursSubmitted,
				submittedAt: ship.submittedAt,
				hasHackatime: project.hackatimeProjectKeys.length > 0
			};
		}),
		verdicts: Object.fromEntries(verdicts)
	};
};
