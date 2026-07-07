import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient, ProtocolError } from '$lib/server/protocol/client.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:review:authorize');

// Some endpoints (e.g. Beest's audit approve) require these fields, so we
// always send something meaningful even when the authorizer typed nothing.
const DEFAULT_AUTHORIZE_JUSTIFICATION = 'Approved via Sidekick HQ authorization.';
const DEFAULT_DEAUTHORIZE_MESSAGE =
	'Your approval was sent back by HQ for another look. Please re-review this ship.';

function parseProtocolError(e: ProtocolError): { status: number; body: { error: string; message: string } } {
	try {
		const parsed = JSON.parse(e.body);
		return { status: e.status, body: { error: parsed.error ?? 'PROTOCOL_ERROR', message: parsed.message ?? e.body } };
	} catch {
		return { status: e.status, body: { error: 'PROTOCOL_ERROR', message: e.body } };
	}
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canAuthorizeReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const { pendingApprovalId, justification: rawJustification } = await request.json();
	if (!pendingApprovalId) throw error(400, 'pendingApprovalId is required');
	const justification =
		(typeof rawJustification === 'string' && rawJustification.trim()) || DEFAULT_AUTHORIZE_JUSTIFICATION;

	logger.info('POST authorize', { programId: params.programId, pendingApprovalId });

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});
	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);

	try {
		if (pendingApprovalId.startsWith('hq:')) {
			const shipId = pendingApprovalId.slice(3);
			const reviewerId = user.slackId || user.hcaId;
			logger.debug('Direct HQ authorization', { shipId, reviewerId });
			const result = await client.submitReviewAction({
				shipId,
				reviewerId,
				action: 'authorize',
				justification
			});

			await db.auditLog.create({
				data: {
					programId: params.programId,
					userId: user.id,
					action: 'review_authorize',
					entityType: 'ship',
					entityId: shipId,
					metadata: { pendingApprovalId }
				}
			});

			logger.info('HQ authorization completed', { shipId, success: result.success });
			return json({ success: result.success });
		}

		const pending = await db.pendingApproval.findUnique({
			where: { id: pendingApprovalId }
		});
		if (!pending || pending.programId !== params.programId) {
			throw error(404, 'Pending approval not found');
		}

		try {
			await client.submitReviewAction({
				shipId: pending.shipId,
				reviewerId: pending.reviewerId,
				action: 'approve',
				hoursAssigned: pending.hoursAssigned,
				feedbackMessage: pending.feedbackMessage,
				justification: pending.justification,
				isHq: false,
				fields: (pending.fields as Record<string, string | number | boolean>) ?? undefined
			});
		} catch (e) {
			if (!(e instanceof ProtocolError)) throw e;
		}

		const reviewerId = user.slackId || user.hcaId;
		const result = await client.submitReviewAction({
			shipId: pending.shipId,
			reviewerId,
			action: 'authorize',
			hoursAssigned: pending.hoursAssigned,
			justification
		});

		await db.pendingApproval.delete({ where: { id: pendingApprovalId } });

		await db.auditLog.create({
			data: {
				programId: params.programId,
				userId: user.id,
				action: 'review_authorize',
				entityType: 'ship',
				entityId: pending.shipId,
				metadata: {
					projectId: pending.projectId,
					hoursAssigned: pending.hoursAssigned,
					originalReviewerId: pending.reviewerId,
					pendingApprovalId
				}
			}
		});

		logger.info('Pending approval authorized', { pendingApprovalId, shipId: pending.shipId, success: result.success });
		return json({ success: result.success });
	} catch (e) {
		if (e instanceof ProtocolError) {
			const { status, body } = parseProtocolError(e);
			logger.warn('Authorization protocol error', { pendingApprovalId, status, error: body.message });
			return json(body, { status });
		}
		throw e;
	}
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canAuthorizeReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const { pendingApprovalId, message: rawMessage } = await request.json();
	if (!pendingApprovalId) throw error(400, 'pendingApprovalId is required');
	const message = (typeof rawMessage === 'string' && rawMessage.trim()) || DEFAULT_DEAUTHORIZE_MESSAGE;

	logger.info('DELETE discard pending', { programId: params.programId, pendingApprovalId });

	try {
		if (pendingApprovalId.startsWith('hq:')) {
			const shipId = pendingApprovalId.slice(3);
			const reviewerId = user.slackId || user.hcaId;

			const program = await db.program.findUniqueOrThrow({
				where: { id: params.programId }
			});
			const client = new ProtocolClient(program.masterEndpoint, program.secretKey);
			const result = await client.submitReviewAction({
				shipId,
				reviewerId,
				action: 'deauthorize',
				message
			});

			await db.auditLog.create({
				data: {
					programId: params.programId,
					userId: user.id,
					action: 'review_discard_pending',
					entityType: 'ship',
					entityId: shipId,
					metadata: { pendingApprovalId }
				}
			});

			logger.info('HQ deauthorization completed', { shipId, success: result.success });
			return json({ success: result.success });
		}

		const pending = await db.pendingApproval.findUnique({
			where: { id: pendingApprovalId }
		});
		if (!pending || pending.programId !== params.programId) {
			throw error(404, 'Pending approval not found');
		}

		await db.pendingApproval.update({
			where: { id: pendingApprovalId },
			data: { status: 'discarded', discardedById: user.slackId || user.hcaId }
		});

		await db.auditLog.create({
			data: {
				programId: params.programId,
				userId: user.id,
				action: 'review_discard_pending',
				entityType: 'ship',
				entityId: pending.shipId,
				metadata: {
					projectId: pending.projectId,
					hoursAssigned: pending.hoursAssigned,
					originalReviewerId: pending.reviewerId,
					pendingApprovalId
				}
			}
		});

		logger.info('Pending approval discarded', { pendingApprovalId, shipId: pending.shipId });
		return json({ success: true });
	} catch (e) {
		if (e instanceof ProtocolError) {
			const { status, body } = parseProtocolError(e);
			logger.warn('Discard protocol error', { pendingApprovalId, status, error: body.message });
			return json(body, { status });
		}
		throw e;
	}
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canAuthorizeReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const { pendingApprovalId, reviewerId, feedbackMessage, justification, hoursAssigned } = await request.json();
	if (!pendingApprovalId) throw error(400, 'pendingApprovalId is required');

	logger.debug('PATCH pending approval', { programId: params.programId, pendingApprovalId });

	if (pendingApprovalId.startsWith('hq:')) {
		if (!reviewerId) throw error(400, 'reviewerId is required for HQ pending approvals');
		const shipId = pendingApprovalId.slice(3);

		const program = await db.program.findUniqueOrThrow({
			where: { id: params.programId }
		});
		const client = new ProtocolClient(program.masterEndpoint, program.secretKey);

		try {
			await client.updateReviewAction({
				shipId,
				reviewerId,
				type: 'approval',
				feedbackMessage: feedbackMessage ?? '',
				justification: justification ?? '',
				hoursAssigned: hoursAssigned != null ? hoursAssigned : undefined
			});
		} catch (e) {
			if (e instanceof ProtocolError) {
				const parsed = parseProtocolError(e);
				logger.warn('HQ edit protocol error', { pendingApprovalId, status: parsed.status, error: parsed.body.message });
				return json(parsed.body, { status: parsed.status });
			}
			throw e;
		}

		logger.info('HQ pending approval updated via protocol', { shipId });
		return json({ success: true });
	}

	const pending = await db.pendingApproval.findUnique({
		where: { id: pendingApprovalId }
	});
	if (!pending || pending.programId !== params.programId) {
		throw error(404, 'Pending approval not found');
	}

	await db.pendingApproval.update({
		where: { id: pendingApprovalId },
		data: {
			feedbackMessage: feedbackMessage ?? pending.feedbackMessage,
			justification: justification ?? pending.justification,
			hoursAssigned: hoursAssigned != null ? hoursAssigned : pending.hoursAssigned
		}
	});

	logger.info('Pending approval updated', { pendingApprovalId });
	return json({ success: true });
};
