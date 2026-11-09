import { redirect, fail } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { mintMcpToken, revokeMcpToken, MAX_LIVE_TOKENS } from '$lib/server/mcp/tokens.js';
import { createLogger } from '$lib/server/logger.js';
import type { PageServerLoad, Actions } from './$types.js';

const log = createLogger('page:agents');

export const load: PageServerLoad = async ({ parent, url }) => {
	const { user } = await parent();
	if (!user) throw redirect(302, '/auth/login');

	const tokens = await db.mcpToken.findMany({
		where: { userId: user.id },
		orderBy: { createdAt: 'desc' },
		take: 30
	});
	const now = new Date();

	return {
		mcpUrl: `${url.origin}/mcp`,
		maxLiveTokens: MAX_LIVE_TOKENS,
		tokens: tokens.map((t) => ({
			id: t.id,
			name: t.name,
			hint: t.hint,
			createdAt: t.createdAt.toISOString(),
			lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
			expiresAt: t.expiresAt.toISOString(),
			state: t.revokedAt ? 'revoked' : t.expiresAt < now ? 'expired' : 'live'
		}))
	};
};

export const actions: Actions = {
	mint: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) throw redirect(302, '/auth/login');
		const name = String((await request.formData()).get('name') ?? '');
		try {
			const { raw } = await mintMcpToken(user.id, name);
			// Returned once; only its digest is stored.
			return { minted: raw };
		} catch (e) {
			log.warn('mint refused', { userId: user.id, error: String(e) });
			return fail(400, { error: e instanceof Error ? e.message : 'Could not mint a token.' });
		}
	},

	revoke: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) throw redirect(302, '/auth/login');
		const id = String((await request.formData()).get('id') ?? '');
		await revokeMcpToken(user.id, id);
		return { revoked: true };
	}
};
