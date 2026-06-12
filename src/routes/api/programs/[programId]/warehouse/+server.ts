import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { encrypt } from '$lib/server/crypto.js';
import { getTheseusUser } from '$lib/server/integrations/theseus.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'isRoot', {
		isSuperAdmin: user.isSuperAdmin
	});

	const body = await request.json();
	const { apiKey } = body;

	if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
		throw error(400, 'API key is required');
	}

	const theseusUser = await getTheseusUser(apiKey.trim());

	await db.program.update({
		where: { id: params.programId },
		data: {
			theseusApiKey: encrypt(apiKey.trim()),
			theseusUserName: theseusUser.name,
			theseusUserEmail: theseusUser.email,
			theseusUserAvatar: theseusUser.avatar
		}
	});

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action: 'theseus_api_key_set',
			entityType: 'program',
			entityId: params.programId,
			metadata: { theseusUserName: theseusUser.name, theseusUserEmail: theseusUser.email }
		}
	});

	return json({ success: true, theseusUser: { name: theseusUser.name, email: theseusUser.email } });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'isRoot', {
		isSuperAdmin: user.isSuperAdmin
	});

	await db.program.update({
		where: { id: params.programId },
		data: {
			theseusApiKey: null,
			theseusUserName: null,
			theseusUserEmail: null,
			theseusUserAvatar: null
		}
	});

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action: 'theseus_api_key_removed',
			entityType: 'program',
			entityId: params.programId,
			metadata: {}
		}
	});

	return json({ success: true });
};
