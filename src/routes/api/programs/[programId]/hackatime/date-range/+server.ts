import { json, error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/rbac.js';
import { getProjectDateRange } from '$lib/server/integrations/hackatime.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:hackatime:date-range');

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const userId = url.searchParams.get('userId');
	const projects = url.searchParams.get('projects');
	const tz = url.searchParams.get('tz') || undefined;

	if (!userId || !projects) {
		throw error(400, 'Missing userId or projects');
	}

	const projectKeys = projects.split(',').map((p) => p.trim());
	logger.debug('GET request', { userId, projects: projectKeys.join(','), tz, programId: params.programId });

	let range;
	try {
		range = await getProjectDateRange(userId, projectKeys, tz);
	} catch (e) {
		logger.error('Failed to get date range', e, { userId, projects: projectKeys.join(',') });
		range = null;
	}
	logger.debug('Result', { userId, range: range ? `${range.firstDate} to ${range.lastDate}` : 'null' });

	return json({ range });
};
