import { redirect, error } from '@sveltejs/kit';
import { safeReturnPath } from '$lib/server/oauth-state.js';
import { exchangeHcbCode } from '$lib/server/integrations/hcb.js';
import { encrypt } from '$lib/server/crypto.js';
import { db } from '$lib/server/db.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const log = createLogger('auth:hcb:callback');

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	log.info('hcb callback received', { userId: locals.user.id });

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state) throw error(400, 'Missing code or state');

	const savedState = cookies.get('hcb_oauth_state');
	if (!savedState || savedState !== state) {
		log.warn('invalid oauth state mismatch', { userId: locals.user.id });
		throw error(400, 'Invalid OAuth state');
	}

	cookies.delete('hcb_oauth_state', { path: '/' });

	let payload: { returnUrl?: string; userId?: string };
	try {
		payload = JSON.parse(Buffer.from(state, 'base64url').toString());
	} catch {
		throw error(400, 'Invalid OAuth state');
	}

	// The HCB account goes to whoever started the flow. If the session changed
	// hands in between, storing the tokens would give them to somebody else.
	if (payload.userId !== locals.user.id) {
		log.warn('oauth state belongs to another user', { userId: locals.user.id });
		throw error(400, 'Invalid OAuth state');
	}

	const returnUrl = safeReturnPath(payload.returnUrl);

	const tExchange = log.time('hcb token exchange');
	const tokens = await exchangeHcbCode(code);
	tExchange.end();

	await db.user.update({
		where: { id: locals.user.id },
		data: {
			hcbAccessToken: encrypt(tokens.access_token),
			hcbRefreshToken: encrypt(tokens.refresh_token),
			hcbTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000)
		}
	});
	log.info('hcb tokens stored', { userId: locals.user.id, returnUrl });

	throw redirect(302, returnUrl);
};
