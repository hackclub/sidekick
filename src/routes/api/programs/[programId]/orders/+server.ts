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

	if (body.status) {
		await client.updateOrderStatus({
			orderId: body.orderId,
			newStatus: body.status,
			reference: body.reference
		});
	}

	if (body.reference !== undefined || body.adminNotes !== undefined) {
		await client.updateOrderFields({
			orderId: body.orderId,
			...(body.reference !== undefined && { reference: body.reference }),
			...(body.adminNotes !== undefined && { adminNotes: body.adminNotes })
		});
	}

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action: body.status ? 'order_status_change' : 'order_fields_update',
			entityType: 'order',
			entityId: body.orderId,
			metadata: body
		}
	});

	return json({ success: true });
};
