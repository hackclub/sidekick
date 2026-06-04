import { redirect } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/auth.js';
import { getUserPrograms } from '$lib/server/rbac.js';
import type { LayoutServerLoad } from './$types.js';

export const load: LayoutServerLoad = async ({ cookies, url }) => {
	if (url.pathname.startsWith('/auth/')) {
		return { user: null, programs: [] };
	}

	const user = await getSessionUser(cookies);

	if (!user) {
		if (url.pathname !== '/') {
			throw redirect(302, '/');
		}
		return { user: null, programs: [] };
	}

	const programs = await getUserPrograms(user.id, user.isSuperAdmin);

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
