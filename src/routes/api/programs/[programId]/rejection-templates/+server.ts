import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:rejection-templates');

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canUpdateProgram', {
		isSuperAdmin: user.isSuperAdmin
	});

	const body = await request.json();
	const { id, name, feedbackMessage, internalMessage } = body;

	if (!name || typeof name !== 'string' || !name.trim()) {
		throw error(400, 'name is required');
	}
	if (!feedbackMessage || typeof feedbackMessage !== 'string' || !feedbackMessage.trim()) {
		throw error(400, 'feedbackMessage is required');
	}
	if (internalMessage !== undefined && typeof internalMessage !== 'string') {
		throw error(400, 'internalMessage must be a string');
	}

	logger.info('PUT rejection template', { programId: params.programId, id: id ?? null });

	const data = {
		name: name.trim(),
		feedbackMessage,
		internalMessage: internalMessage ?? ''
	};

	let template;
	if (id) {
		const existing = await db.rejectionTemplate.findUnique({ where: { id } });
		if (!existing || existing.programId !== params.programId) {
			throw error(404, 'Template not found');
		}
		template = await db.rejectionTemplate.update({ where: { id }, data });
	} else {
		template = await db.rejectionTemplate.create({
			data: { programId: params.programId, ...data }
		});
	}

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action: id ? 'rejection_template_update' : 'rejection_template_create',
			entityType: 'rejection_template',
			entityId: template.id,
			metadata: { name: template.name }
		}
	});

	logger.info('Rejection template upserted', {
		programId: params.programId,
		templateId: template.id
	});
	return json({ template });
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canUpdateProgram', {
		isSuperAdmin: user.isSuperAdmin
	});

	const body = await request.json();
	const { id } = body;

	if (!id) throw error(400, 'id is required');

	logger.info('DELETE rejection template', { programId: params.programId, id });

	const template = await db.rejectionTemplate.findUnique({ where: { id } });
	if (!template || template.programId !== params.programId) {
		throw error(404, 'Template not found');
	}

	await db.rejectionTemplate.delete({ where: { id } });

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action: 'rejection_template_delete',
			entityType: 'rejection_template',
			entityId: template.id,
			metadata: { name: template.name }
		}
	});

	logger.info('Rejection template deleted', {
		programId: params.programId,
		templateId: template.id
	});
	return json({ success: true });
};
