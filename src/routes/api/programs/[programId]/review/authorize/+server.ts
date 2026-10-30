import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient, ProtocolError } from '$lib/server/protocol/client.js';
import { createLogger } from '$lib/server/logger.js';
import { FRAUD_QUEUE, isFraudQueueReviewer, isRoutedToFraudQueue } from '$lib/server/experiments/fraud-queue.js';
import { isPendingHqUpstream } from '$lib/server/held-approvals.js';
import type { RequestHandler } from './$types.js';
import type { ProgramMembership } from '@prisma/client';

const logger = createLogger('api:review:authorize');

// Some endpoints (e.g. Beest's audit approve) require these fields, so we
// always send something meaningful even when the authorizer typed nothing.
const DEFAULT_AUTHORIZE_JUSTIFICATION = 'Approved via Sidekick HQ authorization.';
const DEFAULT_DEAUTHORIZE_MESSAGE =
	'Your approval was sent back by HQ for another look. Please re-review this ship.';

// Approvals held in the fraud queue may only be acted on by fraud reviewers
// (who need not be HQ authorizers); everything else needs canAuthorizeReviews.
function requireQueueAccess(membership: ProgramMembership, pending: { queue: string }) {
	if (pending.queue === FRAUD_QUEUE) {
		if (!isFraudQueueReviewer(membership)) throw error(403, 'This approval is awaiting fraud review.');
		return;
	}
	requireHqAuthorizer(membership);
}

function requireHqAuthorizer(membership: ProgramMembership) {
	if (!membership.canAuthorizeReviews) throw error(403, 'Missing permission: canAuthorizeReviews');
}

// An upstream pending_hq approval that Sidekick also holds (sent to the fraud
// queue, or mirrored by a program with mirrorHeldApprovals) is acted on through
// its held row, which carries the queue and its permissions; the hq: shortcut
// would authorize around them.
async function requireNotHeld(programId: string, shipId: string) {
	const held = await db.pendingApproval.findFirst({
		where: { programId, shipId, status: 'pending' },
		select: { queue: true }
	});
	if (!held) return;
	if (held.queue === FRAUD_QUEUE) throw error(403, 'This approval is awaiting fraud review.');
	throw error(409, 'This approval is held in Sidekick; authorize or discard the held approval instead.');
}

// Only a fraud-queue row (see the hq: branch of POST) or a row in a program
// that mirrors held approvals can stand for an approval already parked
// upstream; anywhere else the row exists only here, so skip the round trip.
async function isHeldUpstream(
	program: { mirrorHeldApprovals: boolean },
	client: ProtocolClient,
	pending: { queue: string; projectId: string; shipId: string }
): Promise<boolean> {
	if (pending.queue !== FRAUD_QUEUE && !program.mirrorHeldApprovals) return false;
	return isPendingHqUpstream(client, pending);
}

async function auditSentToFraudQueue(
	programId: string,
	userId: string,
	shipId: string,
	metadata: { projectId: string; originalReviewerId: string; pendingApprovalId: string }
) {
	await db.auditLog.create({
		data: {
			programId,
			userId,
			action: 'review_send_to_fraud_queue',
			entityType: 'ship',
			entityId: shipId,
			metadata: { ...metadata, queue: FRAUD_QUEUE }
		}
	});
}

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

	const membership = await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const { pendingApprovalId, justification: rawJustification, projectId } = await request.json();
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
			requireHqAuthorizer(membership);
			const shipId = pendingApprovalId.slice(3);
			await requireNotHeld(params.programId, shipId);

			// Experiment: a routed authorizer's sign-off holds the upstream
			// approval in the fraud queue instead of authorizing it. The ship
			// stays pending_hq upstream until a fraud reviewer authorizes it.
			if (isRoutedToFraudQueue(membership)) {
				if (typeof projectId !== 'string') throw error(400, 'projectId is required');
				const timeline = await client.fetchProjectTimeline({ projectId });
				const approval = timeline.events.findLast(
					(e): e is Extract<typeof e, { type: 'approval' }> => e.type === 'approval' && e.shipId === shipId
				);
				if (!approval) throw error(404, 'Upstream approval not found');

				const data = {
					hoursAssigned: approval.hoursAssigned,
					rewardedHoursOverride: approval.rewardedHoursOverride ?? null,
					feedbackMessage: approval.feedbackMessage,
					justification: approval.justification,
					fields: approval.fields ?? undefined,
					status: 'pending',
					queue: FRAUD_QUEUE
				};
				const held = await db.pendingApproval.upsert({
					where: {
						programId_shipId_reviewerId: { programId: params.programId, shipId, reviewerId: approval.actorId }
					},
					create: { programId: params.programId, projectId, shipId, reviewerId: approval.actorId, ...data },
					update: data
				});
				await auditSentToFraudQueue(params.programId, user.id, shipId, {
					projectId,
					originalReviewerId: approval.actorId,
					pendingApprovalId: held.id
				});

				logger.info('HQ approval sent to fraud review', { shipId, pendingApprovalId: held.id });
				return json({ success: true, queue: FRAUD_QUEUE });
			}

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
					metadata: {
						pendingApprovalId,
						...(typeof projectId === 'string' && { projectId })
					}
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
		requireQueueAccess(membership, pending);

		// Experiment: a routed authorizer's sign-off moves the approval into the
		// fraud queue instead of sending it upstream.
		if (pending.queue !== FRAUD_QUEUE && isRoutedToFraudQueue(membership)) {
			await db.pendingApproval.update({
				where: { id: pendingApprovalId },
				data: { queue: FRAUD_QUEUE }
			});
			await auditSentToFraudQueue(params.programId, user.id, pending.shipId, {
				projectId: pending.projectId,
				originalReviewerId: pending.reviewerId,
				pendingApprovalId
			});

			logger.info('Pending approval sent to fraud review', { pendingApprovalId, shipId: pending.shipId });
			return json({ success: true, queue: FRAUD_QUEUE });
		}

		// A held approval already parked upstream (sent to the fraud queue from
		// pending_hq, or mirrored when it was made): sync any edits onto that
		// approval rather than stacking a duplicate one.
		if (await isHeldUpstream(program, client, pending)) {
			await client.updateReviewAction({
				shipId: pending.shipId,
				reviewerId: pending.reviewerId,
				type: 'approval',
				feedbackMessage: pending.feedbackMessage,
				justification: pending.justification,
				hoursAssigned: pending.hoursAssigned,
				rewardedHoursOverride: pending.rewardedHoursOverride
			});
		} else {
			try {
				await client.submitReviewAction({
					shipId: pending.shipId,
					reviewerId: pending.reviewerId,
					action: 'approve',
					hoursAssigned: pending.hoursAssigned,
					rewardedHoursOverride: pending.rewardedHoursOverride ?? undefined,
					feedbackMessage: pending.feedbackMessage,
					justification: pending.justification,
					isHq: false,
					fields: (pending.fields as Record<string, string | number | boolean>) ?? undefined
				});
			} catch (e) {
				if (!(e instanceof ProtocolError)) throw e;
			}
		}

		const reviewerId = user.slackId || user.hcaId;
		const result = await client.submitReviewAction({
			shipId: pending.shipId,
			reviewerId,
			action: 'authorize',
			hoursAssigned: pending.hoursAssigned,
			rewardedHoursOverride: pending.rewardedHoursOverride ?? undefined,
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
					pendingApprovalId,
					queue: pending.queue
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

	const membership = await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const { pendingApprovalId, message: rawMessage, projectId } = await request.json();
	if (!pendingApprovalId) throw error(400, 'pendingApprovalId is required');
	const message = (typeof rawMessage === 'string' && rawMessage.trim()) || DEFAULT_DEAUTHORIZE_MESSAGE;

	logger.info('DELETE discard pending', { programId: params.programId, pendingApprovalId });

	try {
		if (pendingApprovalId.startsWith('hq:')) {
			requireHqAuthorizer(membership);
			const shipId = pendingApprovalId.slice(3);
			await requireNotHeld(params.programId, shipId);
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
					metadata: {
						pendingApprovalId,
						...(typeof projectId === 'string' && { projectId })
					}
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
		requireQueueAccess(membership, pending);

		// A held row mirroring an upstream pending_hq approval has to be sent
		// back upstream too, or the ship would resurface in the HQ queue.
		const program = await db.program.findUniqueOrThrow({
			where: { id: params.programId }
		});
		const client = new ProtocolClient(program.masterEndpoint, program.secretKey);
		if (await isHeldUpstream(program, client, pending)) {
			await client.submitReviewAction({
				shipId: pending.shipId,
				reviewerId: user.slackId || user.hcaId,
				action: 'deauthorize',
				message
			});
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

	const membership = await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const { pendingApprovalId, reviewerId, feedbackMessage, justification, hoursAssigned, rewardedHoursOverride } = await request.json();
	if (!pendingApprovalId) throw error(400, 'pendingApprovalId is required');
	// undefined = leave untouched, null = clear the override, number = set it.
	if (rewardedHoursOverride !== undefined && rewardedHoursOverride !== null && (typeof rewardedHoursOverride !== 'number' || !Number.isFinite(rewardedHoursOverride) || rewardedHoursOverride < 0)) {
		throw error(400, 'rewardedHoursOverride must be a non-negative number or null');
	}

	logger.debug('PATCH pending approval', { programId: params.programId, pendingApprovalId });

	if (pendingApprovalId.startsWith('hq:')) {
		requireHqAuthorizer(membership);
		if (!reviewerId) throw error(400, 'reviewerId is required for HQ pending approvals');
		const shipId = pendingApprovalId.slice(3);
		await requireNotHeld(params.programId, shipId);

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
				hoursAssigned: hoursAssigned != null ? hoursAssigned : undefined,
				rewardedHoursOverride
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
	requireQueueAccess(membership, pending);

	await db.pendingApproval.update({
		where: { id: pendingApprovalId },
		data: {
			feedbackMessage: feedbackMessage ?? pending.feedbackMessage,
			justification: justification ?? pending.justification,
			hoursAssigned: hoursAssigned != null ? hoursAssigned : pending.hoursAssigned,
			rewardedHoursOverride: rewardedHoursOverride === undefined ? pending.rewardedHoursOverride : rewardedHoursOverride
		}
	});

	logger.info('Pending approval updated', { pendingApprovalId });
	return json({ success: true });
};
