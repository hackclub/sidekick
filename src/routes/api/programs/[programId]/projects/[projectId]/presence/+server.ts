import { json, error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/rbac.js';
import { heartbeat, leave } from '$lib/server/presence.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:presence');

async function readTabId(request: Request): Promise<string> {
	const body = await request.json().catch(() => null);
	const tabId = body?.tabId;
	if (typeof tabId !== 'string' || !/^[\w-]{1,64}$/.test(tabId)) {
		throw error(400, 'tabId is required');
	}
	return tabId;
}

// Heartbeat: marks this tab as viewing the project, returns who else is.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});
	const tabId = await readTabId(request);

	try {
		const viewers = await heartbeat(params.programId, params.projectId, user.id, tabId);
		return json({ viewers });
	} catch (e) {
		// Presence is cosmetic — never let a Redis hiccup surface as a page error.
		logger.warn('heartbeat failed', { error: e });
		return json({ viewers: [] });
	}
};

// Leave: sent with `keepalive` on tab close / navigation, so it may land after
// the page is gone. No permission lookup — a user can only remove their own tab.
export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	const tabId = await readTabId(request);
	try {
		await leave(params.programId, params.projectId, user.id, tabId);
	} catch (e) {
		logger.warn('leave failed', { error: e });
	}
	return new Response(null, { status: 204 });
};
