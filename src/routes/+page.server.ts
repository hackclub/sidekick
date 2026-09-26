import { redirect } from '@sveltejs/kit';
import { getMembership } from '$lib/server/rbac.js';
import type { PageServerLoad } from './$types.js';

// With a pinned program there's nothing to pick, so skip the picker and land
// straight on its review queue (or its overview, for members who can't review).
export const load: PageServerLoad = async ({ parent }) => {
	const { user, programs } = await parent();
	if (!user) return;

	const pinned = programs.find((p) => p.isPinned);
	if (!pinned) return;

	const canViewReviews = user.isSuperAdmin || !!(await getMembership(user.id, pinned.id))?.canViewReviews;
	throw redirect(302, canViewReviews ? `/program/${pinned.id}/review` : `/program/${pinned.id}`);
};
