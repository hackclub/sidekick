import { json, error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/rbac.js';
import { getLapseAfkStatuses } from '$lib/server/queue/lapse-afk.js';
import type { RequestHandler } from './$types.js';

const MAX_IDS = 100;

// AFK analysis status for a batch of timelapses. Read-only: analyses are
// queued in the background when the review page loads its timelapses.
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const ids = [...new Set((url.searchParams.get('ids') ?? '').split(',').filter(Boolean))];
	if (ids.length > MAX_IDS) throw error(400, `At most ${MAX_IDS} ids are allowed`);

	return json({ statuses: await getLapseAfkStatuses(ids) });
};
