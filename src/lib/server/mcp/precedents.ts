import { resolveActorIds } from '../actors.js';
import { clip, type McpContext } from './access.js';
import type { ProtocolClient } from '../protocol/client.js';
import type { Project, TimelineEvent } from '../protocol/types.js';

// Decided projects change slowly and a search over them reads every page of
// the program's list, so the list is kept for a few minutes per program.
const LIST_TTL_MS = 5 * 60 * 1000;
const MAX_PAGES = 30;
// by_me has to read timelines to know who decided; this bounds how many.
const MAX_TIMELINES = 60;

type DecidedStatus = 'approved' | 'rejected';
const listCache = new Map<string, { projects: Project[]; expiresAt: number }>();

async function decidedProjects(programId: string, client: ProtocolClient, status: DecidedStatus) {
	const key = `${programId}:${status}`;
	const cached = listCache.get(key);
	if (cached && cached.expiresAt > Date.now()) return cached.projects;

	const projects: Project[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const result = await client.fetchProjects({ status, cursor, limit: 100 });
		projects.push(...result.projects);
		if (!result.nextCursor) break;
		cursor = result.nextCursor;
	}
	listCache.set(key, { projects, expiresAt: Date.now() + LIST_TTL_MS });
	return projects;
}

function lastDecidedAt(p: Project, statuses: DecidedStatus[]): number {
	const ship = p.ships.findLast((s) => (statuses as string[]).includes(s.status));
	return ship ? new Date(ship.submittedAt).getTime() : 0;
}

type Decision = Extract<TimelineEvent, { type: 'approval' | 'authorized_approval' | 'rejection' }>;

function isDecision(e: TimelineEvent): e is Decision {
	return e.type === 'approval' || e.type === 'authorized_approval' || e.type === 'rejection';
}

/**
 * Projects a program already decided, newest first, with the decisions as
 * they were written: hours, feedback and justification. `query` matches the
 * title, description and URLs; `byMe` keeps decisions the caller made.
 */
export async function pastReviews(
	ctx: McpContext,
	programId: string,
	client: ProtocolClient,
	opts: {
		status: DecidedStatus | 'all';
		query?: string;
		byMe: boolean;
		excludeProjectId?: string;
		offset: number;
		limit: number;
	}
) {
	const statuses: DecidedStatus[] =
		opts.status === 'all' ? ['approved', 'rejected'] : [opts.status];
	const lists = await Promise.all(statuses.map((s) => decidedProjects(programId, client, s)));
	const seen = new Set<string>();
	const needle = opts.query?.trim().toLowerCase();
	const candidates = lists
		.flat()
		.filter((p) => {
			if (seen.has(p.id) || p.id === opts.excludeProjectId) return false;
			seen.add(p.id);
			if (!needle) return true;
			return [p.title, p.description, p.codeUrl, p.demoUrl ?? ''].some((f) =>
				f.toLowerCase().includes(needle)
			);
		})
		.sort((a, b) => lastDecidedAt(b, statuses) - lastDecidedAt(a, statuses));

	const me = ctx.user.slackId || ctx.user.hcaId;
	const wanted = (e: Decision) =>
		(!opts.byMe || e.actorId === me) &&
		(opts.status === 'all' || (opts.status === 'approved') === (e.type !== 'rejection'));

	// Without by_me the page is known up front; with it, timelines are read in
	// order until enough of them hold a decision of the caller's.
	const pool = opts.byMe
		? candidates.slice(0, MAX_TIMELINES)
		: candidates.slice(opts.offset, opts.offset + opts.limit);
	const found: Array<{ project: Project; decisions: Decision[] }> = [];
	let skipped = 0;
	for (let i = 0; i < pool.length && found.length < opts.limit; i += 5) {
		const batch = await Promise.all(
			pool.slice(i, i + 5).map(async (project) => {
				const { events } = await client.fetchProjectTimeline({ projectId: project.id });
				return { project, decisions: events.filter(isDecision).filter(wanted) };
			})
		);
		for (const item of batch) {
			if (item.decisions.length === 0 || found.length >= opts.limit) continue;
			if (opts.byMe && skipped < opts.offset) {
				skipped++;
				continue;
			}
			found.push(item);
		}
	}

	const actors = await resolveActorIds([
		...new Set(found.flatMap((f) => f.decisions.map((d) => d.actorId)))
	]);
	return {
		matchingProjects: candidates.length,
		...(opts.byMe && candidates.length > MAX_TIMELINES
			? {
					note: `Only the ${MAX_TIMELINES} most recent matching projects were searched for your decisions.`
				}
			: {}),
		offset: opts.offset,
		projects: found.map(({ project, decisions }) => ({
			projectId: project.id,
			title: project.title,
			description: clip(project.description, 300),
			codeUrl: project.codeUrl,
			demoUrl: project.demoUrl ?? null,
			decisions: decisions.map((d) => {
				const ship = project.ships.find((s) => s.id === d.shipId);
				const base = {
					type: d.type === 'rejection' ? 'rejection' : 'approval',
					at: d.timestamp.slice(0, 10),
					by: actors.get(d.actorId)?.name ?? d.actorId,
					byYou: d.actorId === me,
					ship: ship ? project.ships.indexOf(ship) + 1 : undefined,
					hoursClaimed: ship?.hoursSubmitted
				};
				return d.type === 'rejection'
					? {
							...base,
							feedback: clip(d.feedbackMessage, 600),
							internal: clip(d.internalMessage, 600) ?? undefined
						}
					: {
							...base,
							hoursAssigned: d.hoursAssigned,
							hoursDeflated: d.hoursDeflated || undefined,
							feedback: clip(d.feedbackMessage, 400),
							justification: clip(d.justification, 1500)
						};
			})
		}))
	};
}
