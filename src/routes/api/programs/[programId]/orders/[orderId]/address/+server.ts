import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import {
	ProtocolClient,
	ProtocolError,
	isAddressUnavailable
} from '$lib/server/protocol/client.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:orders:address');

export const POST: RequestHandler = async ({ params, locals, getClientAddress }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Not authenticated');

	await requirePermission(user.id, params.programId, 'canViewAddressData', {
		isSuperAdmin: user.isSuperAdmin
	});

	logger.info('POST address reveal', { programId: params.programId, orderId: params.orderId });

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});

	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);

	let address;
	try {
		address = await client.revealOrderAddress({ orderId: params.orderId });
	} catch (e) {
		if (e instanceof ProtocolError) {
			if (isAddressUnavailable(e)) {
				logger.warn('Address temporarily unavailable upstream', {
					orderId: params.orderId,
					status: e.status
				});
				return json({ addressUnavailable: true }, { status: 503 });
			}
			logger.debug('No address on file', { orderId: params.orderId });
			return json({ noAddress: true }, { status: 404 });
		}
		throw e;
	}

	if (!address?.line1?.trim()) {
		logger.debug('Address empty', { orderId: params.orderId });
		return json({ noAddress: true }, { status: 404 });
	}

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

	logger.info('Address revealed', { programId: params.programId, orderId: params.orderId });
	return json(address);
};
