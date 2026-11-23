import { redirect } from '@sveltejs/kit';
import { getHcaAuthorizationUrl, LOGIN_STATE_COOKIE } from '$lib/server/auth.js';
import { issueOauthState } from '$lib/server/oauth-state.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const log = createLogger('auth:login');

export const GET: RequestHandler = async ({ cookies }) => {
	log.info('login redirect initiated');
	throw redirect(302, getHcaAuthorizationUrl(issueOauthState(cookies, LOGIN_STATE_COOKIE)));
};
