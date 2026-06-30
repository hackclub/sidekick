import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { getEndpointFeatures } from '$lib/server/protocol/capabilities.js';
import { PROTOCOL_FEATURES } from '$lib/server/protocol/types.js';
import { loadProjectsPage, parseStatusFilter } from '$lib/server/projects.js';
import type { RequestHandler } from './$types.js';

// Pagination endpoint backing the Projects page's "Load more" — returns the
// next cursor-delimited page of projects so the list can grow client-side.
export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	await requirePermission(locals.user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: locals.user.isSuperAdmin
	});

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});

	const features = await getEndpointFeatures(program.masterEndpoint, program.secretKey);
	if (!features.includes(PROTOCOL_FEATURES.PROJECTS)) {
		throw error(404, 'Projects browsing is not supported by this endpoint.');
	}

	const status = parseStatusFilter(url.searchParams.get('status'));
	const cursor = url.searchParams.get('cursor') ?? undefined;
	const page = await loadProjectsPage(program.masterEndpoint, program.secretKey, status, cursor);

	return json(page);
};
