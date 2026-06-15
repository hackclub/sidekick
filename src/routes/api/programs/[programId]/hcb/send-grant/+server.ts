import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient } from '$lib/server/protocol/client.js';
import { getValidHcbToken, createCardGrant, topUpCardGrant } from '$lib/server/integrations/hcb.js';
import { createLogger } from '$lib/server/logger.js';
import type { CardGrantParams } from '$lib/server/integrations/hcb.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:hcb:send-grant');

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canUpdateFulfillments', {
		isSuperAdmin: user.isSuperAdmin
	});

	const body = await request.json();
	const { orderId, email, topUpGrantId } = body;

	if (!orderId || !email) {
		throw error(400, 'orderId and email are required');
	}

	logger.info('POST send grant', { orderId, email, topUpGrantId: topUpGrantId ?? null, programId: params.programId });

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});

	if (!program.hcbOrganizationId) {
		throw error(400, 'No HCB organization linked to this program');
	}

	// Fetch the order to get itemId
	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);
	const orderDetail = await client.fetchOrderDetail({ orderId });

	// Look up the template for this item
	const template = await db.cardGrantTemplate.findUnique({
		where: {
			programId_shopItemId: {
				programId: params.programId,
				shopItemId: orderDetail.item.id
			}
		}
	});

	if (!template) {
		throw error(404, 'No card grant template configured for this item');
	}

	const totalAmountCents = template.amountCents * orderDetail.order.quantity;

	// Get a valid HCB token
	const token = await getValidHcbToken(user.id);
	if (!token) {
		return json({ needsAuth: true }, { status: 401 });
	}

	let grant;
	let action: string;

	if (topUpGrantId) {
		// Top up an existing grant
		logger.debug('Topping up existing grant', { topUpGrantId, amountCents: totalAmountCents });
		grant = await topUpCardGrant(token, topUpGrantId, totalAmountCents);
		action = 'card_grant_topup';
	} else {
		// Create a new grant
		const grantParams: CardGrantParams = {
			amount_cents: totalAmountCents,
			email
		};

		if (template.purpose) grantParams.purpose = template.purpose;
		if (template.oneTimeUse) grantParams.one_time_use = template.oneTimeUse;
		if (template.preAuthorizationRequired) grantParams.pre_authorization_required = template.preAuthorizationRequired;
		if (template.instructions) grantParams.instructions = template.instructions;
		if (template.merchantLock) grantParams.merchant_lock = template.merchantLock;
		if (template.categoryLock) grantParams.category_lock = template.categoryLock;
		if (template.keywordLock) grantParams.keyword_lock = template.keywordLock;
		if (template.expirationDays) {
			const expDate = new Date(Date.now() + template.expirationDays * 86400000);
			grantParams.expiration_at = expDate.toISOString().split('T')[0];
		}

		logger.debug('Creating new card grant', { amountCents: totalAmountCents, email });
		grant = await createCardGrant(token, program.hcbOrganizationId, grantParams);
		action = 'card_grant_sent';
	}

	// Update the order reference with the grant ID
	const reference = `https://hcb.hackclub.com/grants/${grant.id.replace(/^cdg_/, '')}`;
	await client.updateOrderFields({ orderId, reference });

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action,
			entityType: 'order',
			entityId: orderId,
			metadata: {
				grantId: grant.id,
				amountCents: totalAmountCents,
				quantity: orderDetail.order.quantity,
				topUp: !!topUpGrantId,
				email,
				shopItemId: orderDetail.item.id
			}
		}
	});

	logger.info('Grant sent successfully', { orderId, grantId: grant.id, amountCents: totalAmountCents, action });

	return json({ success: true, grant, reference });
};
