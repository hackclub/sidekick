import { json, error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/rbac.js';
import { getProjectDateRange } from '$lib/server/integrations/hackatime.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const userId = url.searchParams.get('userId');
	const projects = url.searchParams.get('projects');

	if (!userId || !projects) {
		throw error(400, 'Missing userId or projects');
	}

	const projectKeys = projects.split(',').map((p) => p.trim());
	let range;
	try {
		range = await getProjectDateRange(userId, projectKeys);
	} catch (e) {
		console.error(`[date-range] Failed for userId=${userId} projects=${projectKeys.join(',')}:`, e);
		range = null;
	}
	console.log(`[date-range] userId=${userId} projects=${projectKeys.join(',')} → ${range ? `${range.firstDate} to ${range.lastDate}` : 'null'}`);

	return json({ range });
};
