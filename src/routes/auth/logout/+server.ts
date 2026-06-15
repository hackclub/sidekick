import { redirect } from '@sveltejs/kit';
import { destroySession } from '$lib/server/auth.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const log = createLogger('auth:logout');

export const GET: RequestHandler = async ({ cookies }) => {
	log.info('session destruction requested');
	await destroySession(cookies);
	log.info('session destroyed, redirecting to login');
	throw redirect(302, '/auth/login');
};
