import { redirect, error } from '@sveltejs/kit';
import { randomBytes } from 'crypto';
import { getHcbAuthorizationUrl } from '$lib/server/integrations/hcb.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const log = createLogger('auth:hcb');

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const returnUrl = url.searchParams.get('returnUrl') || '/';
	log.info('hcb oauth initiated', { userId: locals.user.id, returnUrl });

	const nonce = randomBytes(16).toString('hex');
	const state = Buffer.from(JSON.stringify({ returnUrl, nonce })).toString('base64url');

	cookies.set('hcb_oauth_state', state, {
		path: '/',
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		maxAge: 600
	});

	throw redirect(302, getHcbAuthorizationUrl(state));
};
