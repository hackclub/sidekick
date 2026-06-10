import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient, ProtocolError } from '$lib/server/protocol/client.js';
import type { RequestHandler } from './$types.js';

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

	const { pendingApprovalId } = await request.json();
	if (!pendingApprovalId) throw error(400, 'pendingApprovalId is required');

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});
	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);

	try {
		if (pendingApprovalId.startsWith('hq:')) {
			const shipId = pendingApprovalId.slice(3);
			const reviewerId = user.slackId || user.hcaId;
			const result = await client.submitReviewAction({
				shipId,
				reviewerId,
				action: 'authorize'
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

			return json({ success: result.success });
		}

		const pending = await db.pendingApproval.findUnique({
			where: { id: pendingApprovalId }
		});
		if (!pending || pending.programId !== params.programId) {
			throw error(404, 'Pending approval not found');
		}

		const result = await client.submitReviewAction({
			shipId: pending.shipId,
			reviewerId: pending.reviewerId,
			action: 'approve',
			hoursAssigned: pending.hoursAssigned,
			feedbackMessage: pending.feedbackMessage,
			justification: pending.justification
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

		return json({ success: result.success });
	} catch (e) {
		if (e instanceof ProtocolError) {
			const { status, body } = parseProtocolError(e);
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

	const { pendingApprovalId } = await request.json();
	if (!pendingApprovalId) throw error(400, 'pendingApprovalId is required');

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
				action: 'deauthorize'
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

		return json({ success: true });
	} catch (e) {
		if (e instanceof ProtocolError) {
			const { status, body } = parseProtocolError(e);
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

	const { pendingApprovalId, feedbackMessage, justification } = await request.json();
	if (!pendingApprovalId) throw error(400, 'pendingApprovalId is required');

	if (pendingApprovalId.startsWith('hq:')) {
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
			justification: justification ?? pending.justification
		}
	});

	return json({ success: true });
};
