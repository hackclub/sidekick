import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient } from '$lib/server/protocol/client.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ params, locals, getClientAddress }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Not authenticated');

	await requirePermission(user.id, params.programId, 'canViewAddressData', {
		isSuperAdmin: user.isSuperAdmin
	});

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});

	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);
	const address = await client.revealOrderAddress({ orderId: params.orderId });

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action: 'address_reveal',
			entityType: 'order',
			entityId: params.orderId,
			ipAddress: getClientAddress(),
			metadata: {}
		}
	});

	return json(address);
};
