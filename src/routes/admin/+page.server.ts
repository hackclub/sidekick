import { redirect, error, fail } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { createLogger } from '$lib/server/logger.js';
import type { PageServerLoad, Actions } from './$types.js';

const logger = createLogger('page:admin');

export const load: PageServerLoad = async ({ parent, url }) => {
	const { user } = await parent();
	if (!user) throw redirect(302, '/auth/login');
	if (!user.isSuperAdmin) throw error(403, 'Only super admins can access this page.');

	const search = url.searchParams.get('q')?.trim() || '';
	const page = parseInt(url.searchParams.get('page') || '1', 10);
	const perPage = 20;

	logger.debug('Loading admin page', { search, page });

	const where = search
		? {
				OR: [
					{ name: { contains: search, mode: 'insensitive' as const } },
					{ email: { contains: search, mode: 'insensitive' as const } },
					{ slackId: { contains: search, mode: 'insensitive' as const } }
				]
			}
		: {};

	const [users, totalCount] = await Promise.all([
		db.user.findMany({
			where,
			orderBy: { createdAt: 'desc' },
			skip: (page - 1) * perPage,
			take: perPage,
			include: {
				_count: { select: { memberships: true } }
			}
		}),
		db.user.count({ where })
	]);

	logger.debug('Admin page loaded', { userCount: users.length, totalCount });

	return {
		users: users.map((u) => ({
			id: u.id,
			name: u.name,
			email: u.email,
			avatarUrl: u.avatarUrl,
			slackId: u.slackId,
			isSuperAdmin: u.isSuperAdmin,
			isProgramAuthor: u.isProgramAuthor,
			createdAt: u.createdAt.toISOString(),
			programCount: u._count.memberships
		})),
		totalCount,
		page,
		perPage,
		search
	};
};

export const actions: Actions = {
	toggleRole: async ({ request, locals }) => {
		const user = locals.user;
		if (!user?.isSuperAdmin) throw error(403);

		const form = await request.formData();
		const userId = form.get('userId') as string;
		const field = form.get('field') as string;
		const value = form.get('value') === 'true';

		logger.info('toggleRole action', { userId, field, value });

		if (!userId || !['isSuperAdmin', 'isProgramAuthor'].includes(field)) {
			return fail(400, { error: 'Invalid request.' });
		}

		if (field === 'isSuperAdmin' && userId === user.id) {
			return fail(400, { error: "You can't remove your own super admin role." });
		}

		await db.user.update({
			where: { id: userId },
			data: { [field]: value }
		});

		return { success: true };
	}
};
