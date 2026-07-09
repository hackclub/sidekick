import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient, ProtocolError } from '$lib/server/protocol/client.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:user-note');

function parseProtocolError(e: ProtocolError): {
	status: number;
	body: { error: string; message: string };
} {
	try {
		const parsed = JSON.parse(e.body);
		return {
			status: e.status,
			body: { error: parsed.error ?? 'PROTOCOL_ERROR', message: parsed.message ?? e.body }
		};
	} catch {
		return { status: e.status, body: { error: 'PROTOCOL_ERROR', message: e.body } };
	}
}

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canCreateReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const { userId, note } = await request.json();
	if (typeof userId !== 'string' || !userId) throw error(400, 'userId is required');
	if (note !== null && note !== undefined && typeof note !== 'string') {
		throw error(400, 'note must be a string or null');
	}
	const trimmed = typeof note === 'string' ? note.trim() : '';

	logger.info('PUT user note', { programId: params.programId, userId, cleared: !trimmed });

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});
	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);

	try {
		const result = await client.updateUserNote({
			userId,
			note: trimmed || null,
			editorId: user.slackId || user.hcaId
		});

		await db.auditLog.create({
			data: {
				programId: params.programId,
				userId: user.id,
				action: 'user_note_update',
				entityType: 'user',
				entityId: userId,
				metadata: { cleared: !trimmed }
			}
		});

		return json({ success: result.success });
	} catch (e) {
		if (e instanceof ProtocolError) {
			const { status, body } = parseProtocolError(e);
			logger.warn('user note protocol error', { userId, status, error: body.message });
			return json(body, { status });
		}
		throw e;
	}
};
