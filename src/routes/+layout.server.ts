import { error, redirect } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/auth.js';
import { HACKATIME_EXPORT_ROUTE } from '$lib/server/mcp/tokens.js';
import { getUserPrograms } from '$lib/server/rbac.js';
import { programIconUrl } from '$lib/server/icons.js';
import { createLogger } from '$lib/server/logger.js';
import type { LayoutServerLoad } from './$types.js';

const log = createLogger('layout');

export const load: LayoutServerLoad = async ({ cookies, url, route, locals, request }) => {
	if (url.pathname.startsWith('/auth/')) {
		return { user: null, programs: [] };
	}

	// The Hackatime export page also opens to a personal MCP token, which
	// hooks.server.ts resolves into locals.user for that route's GETs only.
	// Every other page keeps requiring the session cookie.
	const exportPage = route.id === HACKATIME_EXPORT_ROUTE;
	const sessionUser = await getSessionUser(cookies);
	const user = sessionUser ?? (exportPage ? locals.user : null);

	if (!user) {
		// A token that didn't authenticate gets a plain 401 rather than a
		// login page the snapshot client can't use.
		if (exportPage && request.headers.has('authorization')) {
			throw error(401, 'Invalid, expired or revoked token');
		}
		log.debug('no session, redirecting to login', { path: url.pathname });
		throw redirect(302, '/auth/login');
	}

	// The export page has no app shell, so it needs no program picker.
	const programs = sessionUser && !exportPage ? await getUserPrograms(user.id, user.isSuperAdmin) : [];
	log.debug('layout loaded', { userId: user.id, programCount: programs.length });

	return {
		user: {
			id: user.id,
			hcaId: user.hcaId,
			email: user.email,
			name: user.name,
			avatarUrl: user.avatarUrl,
			slackId: user.slackId,
			hackatimeId: user.hackatimeId,
			isSuperAdmin: user.isSuperAdmin,
			isProgramAuthor: user.isProgramAuthor
		},
		// The pinned program always leads the list, wherever the picker or the
		// home page shows it.
		programs: programs
			.map((p) => ({
				id: p.id,
				name: p.name,
				iconUrl: programIconUrl(p),
				description: p.description,
				isMember: p.isMember,
				isPinned: p.id === sessionUser?.pinnedProgramId
			}))
			.sort((a, b) => Number(b.isPinned) - Number(a.isPinned))
	};
};
