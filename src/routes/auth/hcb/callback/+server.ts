import { redirect, error } from '@sveltejs/kit';
import { exchangeHcbCode } from '$lib/server/integrations/hcb.js';
import { encrypt } from '$lib/server/crypto.js';
import { db } from '$lib/server/db.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state) throw error(400, 'Missing code or state');

	const savedState = cookies.get('hcb_oauth_state');
	if (!savedState || savedState !== state) {
		throw error(400, 'Invalid OAuth state');
	}

	cookies.delete('hcb_oauth_state', { path: '/' });

	let returnUrl = '/';
	try {
		const payload = JSON.parse(Buffer.from(state, 'base64url').toString());
		returnUrl = payload.returnUrl || '/';
	} catch {
		// Fall back to /
	}

	const tokens = await exchangeHcbCode(code);

	await db.user.update({
		where: { id: locals.user.id },
		data: {
			hcbAccessToken: encrypt(tokens.access_token),
			hcbRefreshToken: encrypt(tokens.refresh_token),
			hcbTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000)
		}
	});

	throw redirect(302, returnUrl);
};
