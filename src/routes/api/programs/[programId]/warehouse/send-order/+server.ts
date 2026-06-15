import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient, ProtocolError } from '$lib/server/protocol/client.js';
import { decrypt } from '$lib/server/crypto.js';
import { createWarehouseOrder } from '$lib/server/integrations/theseus.js';
import { getValidHcbToken, createHcbTransfer } from '$lib/server/integrations/hcb.js';
import type { CreateWarehouseOrderParams } from '$lib/server/integrations/theseus.js';
import type { RequestHandler } from './$types.js';

function toCents(value: number | null): number {
	if (!value) return 0;
	return Math.round(value * 100);
}

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

	if (!program.hcbOrganizationSlug) {
		throw error(400, 'No HCB organization linked to this program');
	}

	const apiKey = decrypt(program.theseusApiKey);

	const hcbToken = await getValidHcbToken(user.id);
	if (!hcbToken) {
		return json({ needsAuth: true }, { status: 401 });
	}

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

	if (!result.id) {
		throw error(502, 'Theseus returned a warehouse order without an ID');
	}

	const reference = `https://mail.hackclub.com/packages/${result.id}`;

	const totalCostCents = toCents(result.contents_cost)
		+ toCents(result.labor_cost)
		+ toCents(result.postage_cost);

	if (totalCostCents <= 0) {
		// Still set the reference and log, but report the missing cost
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
					email: orderDetail.order.userEmail,
					totalCostCents: 0,
					hcbTransferId: null,
					warning: 'Theseus returned zero cost — no HCB transfer created'
				}
			}
		});
		return json({
			success: true,
			warning: 'Warehouse order created, but Theseus reported $0.00 total cost — no HCB disbursement was sent. You may need to create it manually.',
			warehouseOrder: result,
			reference,
			totalCostCents: 0,
			transfer: null
		});
	}

	const fmtCost = (v: number | null) => '$' + (v ?? 0).toFixed(2);
	const skuList = contents.length === 1 && contents[0].quantity === 1
		? contents[0].sku
		: contents.map(c => `${c.quantity}x ${c.sku}`).join(', ');
	const transferName = `Warehouse order for ${skuList} (contents: ${fmtCost(result.contents_cost)}, labor: ${fmtCost(result.labor_cost)}, postage: ${fmtCost(result.postage_cost)}) via sidekick.ascpixi.dev`;

	let transfer;
	try {
		transfer = await createHcbTransfer(
			hcbToken,
			program.hcbOrganizationSlug,
			'hq',
			totalCostCents,
			transferName
		);
	} catch (e) {
		// Warehouse order already placed — don't lose that info
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
					email: orderDetail.order.userEmail,
					totalCostCents,
					hcbTransferId: null,
					error: `HCB transfer failed: ${e instanceof Error ? e.message : String(e)}`
				}
			}
		});
		return json({
			success: true,
			warning: `Warehouse order created, but the HCB disbursement of ${fmtCost(totalCostCents / 100)} failed: ${e instanceof Error ? e.message : String(e)}. You will need to transfer funds manually.`,
			warehouseOrder: result,
			reference,
			totalCostCents,
			transfer: null
		});
	}

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
				email: orderDetail.order.userEmail,
				totalCostCents,
				hcbTransferId: transfer.id
			}
		}
	});

	return json({ success: true, warehouseOrder: result, reference, totalCostCents, transfer });
};
