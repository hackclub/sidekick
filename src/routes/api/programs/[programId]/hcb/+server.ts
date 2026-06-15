import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { getValidHcbToken, getHcbUserOrganizations } from '$lib/server/integrations/hcb.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:hcb');

export const GET: RequestHandler = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'isRoot', {
		isSuperAdmin: user.isSuperAdmin
	});

	logger.debug('GET organizations', { programId: params.programId });

	const token = await getValidHcbToken(user.id);
	if (!token) {
		logger.debug('No valid HCB token, needs auth');
		return json({ needsAuth: true, organizations: [] });
	}

	try {
		const organizations = await getHcbUserOrganizations(token);
		logger.debug('Fetched organizations', { count: organizations.length });
		return json({ needsAuth: false, organizations });
	} catch {
		logger.warn('Failed to fetch organizations, needs re-auth');
		return json({ needsAuth: true, organizations: [] });
	}
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'isRoot', {
		isSuperAdmin: user.isSuperAdmin
	});

	const body = await request.json();
	const { organizationId, organizationName, organizationSlug } = body;

	if (!organizationId || !organizationName) {
		throw error(400, 'organizationId and organizationName are required');
	}

	logger.info('Linking HCB organization', { programId: params.programId, organizationId, organizationName, organizationSlug });

	await db.program.update({
		where: { id: params.programId },
		data: {
			hcbOrganizationId: organizationId,
			hcbOrganizationName: organizationName,
			hcbOrganizationSlug: organizationSlug || null
		}
	});

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action: 'hcb_org_link',
			entityType: 'program',
			entityId: params.programId,
			metadata: { organizationId, organizationName }
		}
	});

	logger.info('HCB organization linked', { programId: params.programId, organizationId });

	return json({ success: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'isRoot', {
		isSuperAdmin: user.isSuperAdmin
	});

	logger.info('Unlinking HCB organization', { programId: params.programId });

	await db.program.update({
		where: { id: params.programId },
		data: {
			hcbOrganizationId: null,
			hcbOrganizationName: null,
			hcbOrganizationSlug: null
		}
	});

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action: 'hcb_org_unlink',
			entityType: 'program',
			entityId: params.programId
		}
	});

	logger.info('HCB organization unlinked', { programId: params.programId });

	return json({ success: true });
};
