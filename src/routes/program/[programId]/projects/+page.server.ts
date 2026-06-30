import { redirect, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { getEndpointFeatures } from '$lib/server/protocol/capabilities.js';
import { PROTOCOL_FEATURES } from '$lib/server/protocol/types.js';
import { loadProjectsPage, parseStatusFilter } from '$lib/server/projects.js';
import { createLogger } from '$lib/server/logger.js';
import type { PageServerLoad } from './$types.js';

const log = createLogger('page:projects');

export const load: PageServerLoad = async ({ params, parent, url }) => {
	const { user } = await parent();
	if (!user) throw redirect(302, '/auth/login');

	await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});

	// Browsing the full catalogue is an optional capability — guard the route so
	// it 404s for endpoints that don't advertise it, even if reached directly.
	const features = await getEndpointFeatures(program.masterEndpoint, program.secretKey);
	if (!features.includes(PROTOCOL_FEATURES.PROJECTS)) {
		throw error(404, "This program's endpoint does not support browsing projects.");
	}

	const status = parseStatusFilter(url.searchParams.get('status'));
	const page = await loadProjectsPage(program.masterEndpoint, program.secretKey, status);

	log.info('projects list loaded', {
		programId: params.programId,
		status,
		count: page.projects.length,
		totalCount: page.totalCount
	});

	return { ...page, status };
};
