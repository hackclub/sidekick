import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient } from '$lib/server/protocol/client.js';
import { createLogger } from '$lib/server/logger.js';
import type { UpdateReviewActionInput } from '$lib/server/protocol/types.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:review');

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canCreateReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});

	const body = await request.json();
	const { type, reviewerId, feedbackMessage, justification, internalMessage } = body as {
		type: 'approval' | 'rejection';
		reviewerId: string;
		feedbackMessage: string;
		justification?: string;
		internalMessage?: string;
	};

	if (!reviewerId) throw error(400, 'reviewerId is required');

	logger.info('PATCH review edit', { programId: params.programId, shipId: params.shipId, type, reviewerId });

	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);

	let input: UpdateReviewActionInput;
	if (type === 'approval') {
		input = {
			shipId: params.shipId,
			reviewerId,
			type: 'approval',
			feedbackMessage,
			justification: justification ?? ''
		};
	} else {
		input = {
			shipId: params.shipId,
			reviewerId,
			type: 'rejection',
			feedbackMessage,
			internalMessage
		};
	}

	const result = await client.updateReviewAction(input);

	await db.auditLog.create({
		data: {
			programId: params.programId,
			userId: user.id,
			action: `review_edit_${type}`,
			entityType: 'ship',
			entityId: params.shipId
		}
	});

	logger.info('Review edit completed', { programId: params.programId, shipId: params.shipId, type, success: result.success });
	return json({ success: result.success });
};
