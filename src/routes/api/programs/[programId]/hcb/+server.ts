import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { getValidHcbToken, getHcbUserOrganizations } from '$lib/server/integrations/hcb.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'isRoot', {
		isSuperAdmin: user.isSuperAdmin
	});

	const token = await getValidHcbToken(user.id);
	if (!token) {
		return json({ needsAuth: true, organizations: [] });
	}

	try {
		const organizations = await getHcbUserOrganizations(token);
		return json({ needsAuth: false, organizations });
	} catch {
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

	return json({ success: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'isRoot', {
		isSuperAdmin: user.isSuperAdmin
	});

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

	return json({ success: true });
};
