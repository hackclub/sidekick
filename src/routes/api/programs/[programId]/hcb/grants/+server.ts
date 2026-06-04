import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { getValidHcbToken, listOrgCardGrants } from '$lib/server/integrations/hcb.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canUpdateFulfillments', {
		isSuperAdmin: user.isSuperAdmin
	});

	const email = url.searchParams.get('email');
	if (!email) throw error(400, 'email is required');

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});

	if (!program.hcbOrganizationId) {
		return json({ grants: [] });
	}

	const token = await getValidHcbToken(user.id);
	if (!token) {
		return json({ needsAuth: true, grants: [] }, { status: 401 });
	}

	try {
		const allGrants = await listOrgCardGrants(token, program.hcbOrganizationId);
		const grants = allGrants.filter(
			(g) => g.email?.toLowerCase() === email.toLowerCase() && g.status === 'active'
		);
		return json({ grants });
	} catch {
		return json({ grants: [] });
	}
};
