import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { encrypt } from '$lib/server/crypto.js';
import { getTheseusUser } from '$lib/server/integrations/theseus.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:warehouse');

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

	logger.info('Setting Theseus API key', { programId: params.programId });

	const theseusUser = await getTheseusUser(apiKey.trim());

	await db.program.update({
		where: { id: params.programId },
		data: {
			theseusApiKey: encrypt(apiKey.trim()),
			theseusUserName: theseusUser.name,
			theseusUserEmail: theseusUser.email
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

	logger.info('Theseus API key set', { programId: params.programId, theseusUserName: theseusUser.name });

	return json({ success: true, theseusUser: { name: theseusUser.name, email: theseusUser.email } });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'isRoot', {
		isSuperAdmin: user.isSuperAdmin
	});

	logger.info('Removing Theseus API key', { programId: params.programId });

	await db.program.update({
		where: { id: params.programId },
		data: {
			theseusApiKey: null,
			theseusUserName: null,
			theseusUserEmail: null
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

	logger.info('Theseus API key removed', { programId: params.programId });

	return json({ success: true });
};
