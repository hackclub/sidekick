import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:hcb:templates');

export const GET: RequestHandler = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canUpdateProgram', {
		isSuperAdmin: user.isSuperAdmin
	});

	logger.debug('GET card grant templates', { programId: params.programId });

	const templates = await db.cardGrantTemplate.findMany({
		where: { programId: params.programId }
	});

	logger.debug('Templates fetched', { programId: params.programId, count: templates.length });
	return json({ templates });
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'isRoot', {
		isSuperAdmin: user.isSuperAdmin
	});

	const body = await request.json();
	const { shopItemId, amountCents, purpose, oneTimeUse, preAuthorizationRequired, instructions, merchantLock, categoryLock, keywordLock, expirationDays } = body;

	logger.info('PUT card grant template', { programId: params.programId, shopItemId, amountCents });

	if (!shopItemId || !amountCents || amountCents <= 0) {
		throw error(400, 'shopItemId and a positive amountCents are required');
	}

	if (purpose && purpose.length > 30) {
		throw error(400, 'Purpose must be 30 characters or fewer');
	}

	// Ensure no warehouse template exists for this item
	const existingWarehouse = await db.warehouseTemplate.findUnique({
		where: { programId_shopItemId: { programId: params.programId, shopItemId } }
	});
	if (existingWarehouse) {
		throw error(409, 'A warehouse template already exists for this item. Delete it first.');
	}

	const template = await db.cardGrantTemplate.upsert({
		where: {
			programId_shopItemId: { programId: params.programId, shopItemId }
		},
		create: {
			programId: params.programId,
			shopItemId,
			amountCents,
			purpose: purpose || null,
			oneTimeUse: oneTimeUse ?? false,
			preAuthorizationRequired: preAuthorizationRequired ?? false,
			instructions: instructions || null,
			merchantLock: merchantLock || null,
			categoryLock: categoryLock || null,
			keywordLock: keywordLock || null,
			expirationDays: expirationDays || null
		},
		update: {
			amountCents,
			purpose: purpose || null,
			oneTimeUse: oneTimeUse ?? false,
			preAuthorizationRequired: preAuthorizationRequired ?? false,
			instructions: instructions || null,
			merchantLock: merchantLock || null,
			categoryLock: categoryLock || null,
			keywordLock: keywordLock || null,
			expirationDays: expirationDays || null
		}
	});

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action: 'card_template_upsert',
			entityType: 'card_grant_template',
			entityId: template.id,
			metadata: { shopItemId, amountCents }
		}
	});

	logger.info('Card grant template upserted', { programId: params.programId, templateId: template.id, shopItemId });
	return json({ template });
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'isRoot', {
		isSuperAdmin: user.isSuperAdmin
	});

	const body = await request.json();
	const { shopItemId } = body;

	logger.info('DELETE card grant template', { programId: params.programId, shopItemId });

	if (!shopItemId) throw error(400, 'shopItemId is required');

	const template = await db.cardGrantTemplate.findUnique({
		where: { programId_shopItemId: { programId: params.programId, shopItemId } }
	});

	if (!template) throw error(404, 'Template not found');

	await db.cardGrantTemplate.delete({
		where: { id: template.id }
	});

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action: 'card_template_delete',
			entityType: 'card_grant_template',
			entityId: template.id,
			metadata: { shopItemId }
		}
	});

	logger.info('Card grant template deleted', { programId: params.programId, templateId: template.id, shopItemId });
	return json({ success: true });
};
