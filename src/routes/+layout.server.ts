import { redirect } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/auth.js';
import { getUserPrograms } from '$lib/server/rbac.js';
import { createLogger } from '$lib/server/logger.js';
import type { LayoutServerLoad } from './$types.js';

const log = createLogger('layout');

export const load: LayoutServerLoad = async ({ cookies, url }) => {
	if (url.pathname.startsWith('/auth/')) {
		return { user: null, programs: [] };
	}

	const user = await getSessionUser(cookies);

	if (!user) {
		log.debug('no session, redirecting to login', { path: url.pathname });
		throw redirect(302, '/auth/login');
	}

	const programs = await getUserPrograms(user.id, user.isSuperAdmin);
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
		programs: programs.map((p) => ({
			id: p.id,
			name: p.name,
			iconUrl: p.iconUrl,
			description: p.description
		}))
	};
};
