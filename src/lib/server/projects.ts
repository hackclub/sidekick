import { ProtocolClient } from './protocol/client.js';
import { resolveActorIds } from './actors.js';
import type { Project } from './protocol/types.js';

// Ship statuses a project may be filtered by, plus "all". Mirrors the upstream
// FETCH_PROJECTS status filter. Endpoints that don't honour the filter may
// return everything, which is acceptable for a browse view.
export const PROJECT_STATUS_FILTERS = [
	'all',
	'pending',
	'pending_hq',
	'approved',
	'rejected'
] as const;

export type ProjectStatusFilter = (typeof PROJECT_STATUS_FILTERS)[number];

export function parseStatusFilter(value: string | null): ProjectStatusFilter {
	return PROJECT_STATUS_FILTERS.includes(value as ProjectStatusFilter)
		? (value as ProjectStatusFilter)
		: 'all';
}

export interface ProjectsPage {
	projects: Project[];
	actors: Record<string, { name: string; avatarUrl: string | null }>;
	nextCursor: string | null;
	totalCount: number;
}

// A single page of the project catalogue with its authors resolved to display
// names/avatars. Shared by the Projects page load and its pagination endpoint.
export async function loadProjectsPage(
	masterEndpoint: string,
	secretKey: string,
	status: ProjectStatusFilter,
	cursor?: string,
	limit = 50
): Promise<ProjectsPage> {
	const client = new ProtocolClient(masterEndpoint, secretKey);
	const result = await client.fetchProjects({ status, cursor, limit });

	const actorMap = await resolveActorIds([...new Set(result.projects.map((p) => p.authorId))]);
	const actors: Record<string, { name: string; avatarUrl: string | null }> = {};
	for (const [id, actor] of actorMap) {
		actors[id] = { name: actor.name, avatarUrl: actor.avatarUrl };
	}

	return {
		projects: result.projects,
		actors,
		nextCursor: result.nextCursor ?? null,
		totalCount: result.totalCount
	};
}
