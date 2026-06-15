import { redirect } from '@sveltejs/kit';
import { getHcaAuthorizationUrl } from '$lib/server/auth.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const log = createLogger('auth:login');

export const GET: RequestHandler = async () => {
	log.info('login redirect initiated');
	throw redirect(302, getHcaAuthorizationUrl());
};
