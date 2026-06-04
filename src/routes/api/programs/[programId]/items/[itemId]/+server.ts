import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient } from '$lib/server/protocol/client.js';
import type { RequestHandler } from './$types.js';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Not authenticated');

	await requirePermission(user.id, params.programId, 'canUpdateFulfillments', {
		isSuperAdmin: user.isSuperAdmin
	});

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});

	const body = await request.json();
	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);

	await client.updateItemFields({
		itemId: params.itemId,
		fulfillerContext: body.fulfillerContext
	});

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action: 'item_fields_update',
			entityType: 'item',
			entityId: params.itemId,
			metadata: { fulfillerContext: body.fulfillerContext }
		}
	});

	return json({ success: true });
};
