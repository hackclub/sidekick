import { redirect, error, fail } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import crypto from 'node:crypto';
import type { PageServerLoad, Actions } from './$types.js';

export const load: PageServerLoad = async ({ parent }) => {
	const { user } = await parent();
	if (!user) throw redirect(302, '/auth/login');
	if (!user.isProgramAuthor && !user.isSuperAdmin) {
		throw error(403, 'Only program authors can create programs.');
	}
	return {};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) throw error(401);
		if (!user.isProgramAuthor && !user.isSuperAdmin) {
			throw error(403, 'Only program authors can create programs.');
		}

		const form = await request.formData();
		const name = (form.get('name') as string)?.trim();
		const masterEndpoint = (form.get('masterEndpoint') as string)?.trim();
		const providedKey = (form.get('secretKey') as string)?.trim();

		if (!name) return fail(400, { error: 'Program name is required.' });
		if (!masterEndpoint) return fail(400, { error: 'Master endpoint URL is required.' });

		try {
			new URL(masterEndpoint);
		} catch {
			return fail(400, { error: 'Master endpoint must be a valid URL.' });
		}

		const secretKey = providedKey || `sk_${crypto.randomBytes(32).toString('hex')}`;

		const program = await db.program.create({
			data: {
				name,
				masterEndpoint,
				secretKey,
				memberships: {
					create: {
						userId: user.id,
						canViewReviews: true,
						canCreateReviews: true,
						canAuthorizeReviews: true,
						canViewFulfillments: true,
						canViewAddressData: true,
						canUpdateFulfillments: true,
						canUpdateProgram: true,
						isRoot: true
					}
				}
			}
		});

		throw redirect(303, `/program/${program.id}/manage`);
	}
};
