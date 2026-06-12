import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient, ProtocolError } from '$lib/server/protocol/client.js';
import { decrypt } from '$lib/server/crypto.js';
import { createWarehouseOrder } from '$lib/server/integrations/theseus.js';
import type { CreateWarehouseOrderParams } from '$lib/server/integrations/theseus.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	const membership = await requirePermission(user.id, params.programId, 'canUpdateFulfillments', {
		isSuperAdmin: user.isSuperAdmin
	});

	if (!membership.canViewAddressData) {
		throw error(403, 'You need address data permission to send warehouse orders');
	}

	const body = await request.json();
	const { orderId } = body;

	if (!orderId) {
		throw error(400, 'orderId is required');
	}

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});

	if (!program.theseusApiKey) {
		throw error(400, 'No Theseus API key configured for this program');
	}

	const apiKey = decrypt(program.theseusApiKey);

	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);
	const orderDetail = await client.fetchOrderDetail({ orderId });

	const template = await db.warehouseTemplate.findUnique({
		where: {
			programId_shopItemId: {
				programId: params.programId,
				shopItemId: orderDetail.item.id
			}
		}
	});

	if (!template) {
		throw error(404, 'No warehouse template configured for this item');
	}

	let address;
	try {
		address = await client.revealOrderAddress({ orderId });
	} catch (e) {
		if (e instanceof ProtocolError) {
			throw error(400, 'No shipping address on file for this order');
		}
		throw e;
	}

	if (!address?.line1?.trim()) {
		throw error(400, 'No shipping address on file for this order');
	}

	const tags = template.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
	const contents = (template.contents as Array<{ sku: string; quantity: number }>).map(c => ({
		sku: c.sku,
		quantity: c.quantity * orderDetail.order.quantity
	}));

	const orderParams: CreateWarehouseOrderParams = {
		warehouse_order: {
			recipient_email: orderDetail.order.userEmail,
			tags,
			user_facing_title: template.userFacingTitle || undefined,
			idempotency_key: `sidekick-${params.programId}-${orderId}`,
			metadata: {
				...(template.metadata as Record<string, unknown> ?? {}),
				sidekick_program_id: params.programId,
				sidekick_order_id: orderId
			}
		},
		address: {
			first_name: address.firstName,
			last_name: address.lastName,
			line_1: address.line1,
			line_2: address.line2 || undefined,
			city: address.city,
			state: address.stateProvince || undefined,
			postal_code: address.postalCode,
			country: address.country
		},
		contents
	};

	const result = await createWarehouseOrder(apiKey, orderParams);

	const reference = `warehouse:${result.id}`;
	await client.updateOrderFields({ orderId, reference });

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action: 'warehouse_order_sent',
			entityType: 'order',
			entityId: orderId,
			metadata: {
				warehouseOrderId: result.id,
				shopItemId: orderDetail.item.id,
				quantity: orderDetail.order.quantity,
				email: orderDetail.order.userEmail
			}
		}
	});

	return json({ success: true, warehouseOrder: result, reference });
};
