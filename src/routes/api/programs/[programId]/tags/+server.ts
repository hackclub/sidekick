import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { createLogger } from '$lib/server/logger.js';
import { normalizeTagColor } from '$lib/utils/tags.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:project-tags');

export const GET: RequestHandler = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const tags = await db.projectTagDefinition.findMany({
		where: { programId: params.programId },
		orderBy: { label: 'asc' },
		select: { id: true, label: true, color: true }
	});

	return json({ tags });
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canUpdateProgram', {
		isSuperAdmin: user.isSuperAdmin
	});

	const body = await request.json();
	const { id, label, color } = body;

	if (!label || typeof label !== 'string' || !label.trim()) {
		throw error(400, 'label is required');
	}
	if (label.trim().length > 50) {
		throw error(400, 'label must be 50 characters or fewer');
	}
	if (color !== undefined && typeof color !== 'string') {
		throw error(400, 'color must be a string');
	}

	const data = {
		label: label.trim(),
		color: normalizeTagColor(color)
	};

	const duplicate = await db.projectTagDefinition.findUnique({
		where: { programId_label: { programId: params.programId, label: data.label } }
	});
	if (duplicate && duplicate.id !== id) {
		throw error(409, 'A tag with this name already exists');
	}

	let tag;
	if (id) {
		const existing = await db.projectTagDefinition.findUnique({ where: { id } });
		if (!existing || existing.programId !== params.programId) {
			throw error(404, 'Tag not found');
		}
		tag = await db.projectTagDefinition.update({ where: { id }, data });
	} else {
		tag = await db.projectTagDefinition.create({
			data: { programId: params.programId, ...data }
		});
	}

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action: id ? 'project_tag_update' : 'project_tag_create',
			entityType: 'project_tag',
			entityId: tag.id,
			metadata: { label: tag.label, color: tag.color }
		}
	});

	logger.info('Project tag upserted', { programId: params.programId, tagId: tag.id });
	return json({ tag: { id: tag.id, label: tag.label, color: tag.color } });
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

	const tag = await db.projectTagDefinition.findUnique({ where: { id } });
	if (!tag || tag.programId !== params.programId) {
		throw error(404, 'Tag not found');
	}

	// Assignments cascade-delete with the definition.
	await db.projectTagDefinition.delete({ where: { id } });

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action: 'project_tag_delete',
			entityType: 'project_tag',
			entityId: tag.id,
			metadata: { label: tag.label }
		}
	});

	logger.info('Project tag deleted', { programId: params.programId, tagId: tag.id });
	return json({ success: true });
};
