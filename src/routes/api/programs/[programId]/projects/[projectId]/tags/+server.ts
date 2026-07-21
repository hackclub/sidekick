import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:project-tag-assignments');

// Replaces the full set of tags assigned to a project.
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canCreateReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const body = await request.json();
	const { tagIds } = body;

	if (!Array.isArray(tagIds) || tagIds.some((id) => typeof id !== 'string')) {
		throw error(400, 'tagIds must be an array of strings');
	}

	const uniqueIds = [...new Set(tagIds)];

	// Only tags defined for this program can be assigned — a foreign tag ID
	// would otherwise let one program write assignments against another's tags.
	const validTags = await db.projectTagDefinition.findMany({
		where: { id: { in: uniqueIds }, programId: params.programId },
		select: { id: true, label: true, color: true }
	});
	if (validTags.length !== uniqueIds.length) {
		throw error(400, 'One or more tags do not exist in this program');
	}

	await db.$transaction([
		db.projectTagAssignment.deleteMany({
			where: { programId: params.programId, projectId: params.projectId }
		}),
		db.projectTagAssignment.createMany({
			data: uniqueIds.map((tagId) => ({
				programId: params.programId,
				projectId: params.projectId,
				tagId
			}))
		})
	]);

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action: 'project_tags_update',
			entityType: 'project',
			entityId: params.projectId,
			metadata: { tags: validTags.map((t) => t.label) }
		}
	});

	logger.info('Project tags updated', {
		programId: params.programId,
		projectId: params.projectId,
		tagCount: uniqueIds.length
	});
	return json({ tags: validTags });
};
