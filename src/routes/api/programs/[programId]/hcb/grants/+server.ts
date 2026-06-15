import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { getValidHcbToken, listOrgCardGrants } from '$lib/server/integrations/hcb.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:hcb:grants');

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canUpdateFulfillments', {
		isSuperAdmin: user.isSuperAdmin
	});

	const email = url.searchParams.get('email');
	if (!email) throw error(400, 'email is required');

	logger.debug('GET grants', { programId: params.programId, email });

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});

	if (!program.hcbOrganizationId) {
		logger.debug('No HCB organization linked, returning empty grants');
		return json({ grants: [] });
	}

	const token = await getValidHcbToken(user.id);
	if (!token) {
		logger.debug('No valid HCB token, needs auth');
		return json({ needsAuth: true, grants: [] }, { status: 401 });
	}

	try {
		const allGrants = await listOrgCardGrants(token, program.hcbOrganizationId);
		const grants = allGrants.filter(
			(g) => g.email?.toLowerCase() === email.toLowerCase() && g.status === 'active'
		);
		logger.debug('Grants fetched', { email, total: allGrants.length, matched: grants.length });
		return json({ grants });
	} catch {
		logger.warn('Failed to fetch grants');
		return json({ grants: [] });
	}
};
