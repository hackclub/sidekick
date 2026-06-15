import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient } from '$lib/server/protocol/client.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:orders');

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

	logger.info('PATCH order', {
		orderId: body.orderId,
		programId: params.programId,
		status: body.status ?? null,
		hasReference: body.reference !== undefined,
		hasAdminNotes: body.adminNotes !== undefined,
		hasUserNotes: body.userNotes !== undefined
	});

	if (body.status) {
		await client.updateOrderStatus({
			orderId: body.orderId,
			newStatus: body.status,
			reference: body.reference
		});
	}

	if (body.reference !== undefined || body.adminNotes !== undefined || body.userNotes !== undefined) {
		await client.updateOrderFields({
			orderId: body.orderId,
			...(body.reference !== undefined && { reference: body.reference }),
			...(body.adminNotes !== undefined && { adminNotes: body.adminNotes }),
			...(body.userNotes !== undefined && { userNotes: body.userNotes })
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

	logger.debug('PATCH order complete', { orderId: body.orderId });

	return json({ success: true });
};
