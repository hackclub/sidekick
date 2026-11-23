// What a reviewer can do to a ship, in one place: the review page (its form
// action and the authorize endpoint) and the MCP both call these, so an agent
// acting for a reviewer does exactly what that reviewer could do on the page,
// with the same checks, the same upstream calls and the same audit rows.
//
// Callers resolve the actor's membership with `requirePermission` first (the
// permission each entry point needs is noted on it); everything that depends
// on the membership beyond that (HQ, the fraud queue) is checked here.

import type { Program, ProgramMembership, PendingApproval } from '@prisma/client';
import { db } from './db.js';
import { ProtocolClient, ProtocolError } from './protocol/client.js';
import {
	FRAUD_QUEUE,
	isFraudQueueReviewer,
	isRoutedToFraudQueue
} from './experiments/fraud-queue.js';
import { isPendingHqUpstream } from './held-approvals.js';
import { createLogger } from './logger.js';
import type { SessionUser } from '$lib/types.js';
import type {
	Project,
	ReviewFieldDefinition,
	ReviewFieldValues,
	Ship,
	SubmitReviewActionInput
} from './protocol/types.js';

const log = createLogger('review-actions');

export interface ReviewActor {
	user: Pick<SessionUser, 'id' | 'slackId' | 'hcaId'>;
	membership: ProgramMembership;
	program: Program;
	/** Set when the MCP acts for the user; recorded on every audit row written. */
	mcp?: { tokenId: string };
}

/**
 * A refusal the caller shows as it stands. `code` is set when the refusal
 * carries a machine-readable reason (the program's own error code, or one of
 * the codes below).
 */
export class ReviewActionError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly code?: string
	) {
		super(message);
	}
}

/** The ship already has an approval awaiting HQ authorization. */
export const AWAITING_HQ = 'AWAITING_HQ';
/** The ship has an approval held in the fraud queue that this member may not act on. */
export const AWAITING_FRAUD_REVIEW = 'AWAITING_FRAUD_REVIEW';

// Some endpoints (e.g. Beest's audit approve) require these fields, so we
// always send something meaningful even when the authorizer typed nothing.
export const DEFAULT_AUTHORIZE_JUSTIFICATION = 'Approved via Sidekick HQ authorization.';
export const DEFAULT_DEAUTHORIZE_MESSAGE =
	'Your approval was sent back by HQ for another look. Please re-review this ship.';

function reviewerIdOf(actor: ReviewActor): string {
	return actor.user.slackId || actor.user.hcaId;
}

function clientOf(actor: ReviewActor): ProtocolClient {
	return new ProtocolClient(actor.program.masterEndpoint, actor.program.secretKey);
}

function audit(
	actor: ReviewActor,
	action: string,
	shipId: string,
	metadata: Record<string, string | number | boolean | null>
) {
	return db.auditLog.create({
		data: {
			programId: actor.program.id,
			userId: actor.user.id,
			action,
			entityType: 'ship',
			entityId: shipId,
			metadata: { ...metadata, ...(actor.mcp && { via: 'mcp', tokenId: actor.mcp.tokenId }) }
		}
	});
}

export function parseProtocolError(e: ProtocolError): {
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

// A draft is only ever its own reviewer's, so removing it needs no permission
// beyond being that reviewer.
export async function discardReviewDraft(programId: string, shipId: string, userId: string) {
	await db.reviewDraft.deleteMany({ where: { programId, shipId, userId } });
}

// ---------------------------------------------------------------------------
// First reviews: approve, reject, comment, internal comment.
// Needs canCreateReviews.

export type ReviewAction = 'approve' | 'reject' | 'comment' | 'internal_comment';

export interface ReviewInput {
	projectId: string;
	shipId: string;
	action: string;
	hoursAssigned?: number;
	rewardedHoursOverride?: number;
	feedbackMessage?: string;
	justification?: string;
	internalMessage?: string;
	commentText?: string;
	fields?: ReviewFieldValues;
}

export type ReviewOutcome =
	| { kind: 'held'; queue: 'hq' | 'fraud'; pendingApprovalId: string }
	| { kind: 'submitted'; action: ReviewAction; isHq: boolean; success: boolean };

function isReviewAction(action: string): action is ReviewAction {
	return (
		action === 'approve' ||
		action === 'reject' ||
		action === 'comment' ||
		action === 'internal_comment'
	);
}

function coerceField(def: ReviewFieldDefinition, raw: string | number | boolean) {
	const bad = (expected: string) =>
		new ReviewActionError(
			400,
			`The field "${def.label}" (${def.name}) takes ${expected}; got ${JSON.stringify(raw)}.`
		);
	switch (def.type) {
		case 'integer':
			if (typeof raw === 'number' && Number.isInteger(raw)) return raw;
			if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) return parseInt(raw, 10);
			throw bad('a whole number');
		case 'boolean':
			if (typeof raw === 'boolean') return raw;
			if (raw === 'true' || raw === 'false') return raw === 'true';
			throw bad('true or false');
		case 'select': {
			const value = String(raw);
			const values = (def.options ?? []).map((o) => o.value);
			if (values.includes(value)) return value;
			throw bad(`one of ${values.map((v) => JSON.stringify(v)).join(', ')}`);
		}
		default:
			return String(raw);
	}
}

// The review form only offers the ship's own fields, typed as the protocol
// wants them, and keeps a verdict back until every required one is filled
// (a required field with a default counts as filled). Held to the same here.
function normalizeFields(
	defs: ReviewFieldDefinition[] | undefined,
	values: ReviewFieldValues | undefined
): ReviewFieldValues | undefined {
	const byName = new Map((defs ?? []).map((d) => [d.name, d]));
	const out: ReviewFieldValues = {};
	for (const [name, raw] of Object.entries(values ?? {})) {
		const def = byName.get(name);
		if (!def) {
			const known = [...byName.keys()].join(', ') || 'none';
			throw new ReviewActionError(400, `Unknown field "${name}". This form's fields: ${known}.`);
		}
		out[name] = coerceField(def, raw);
	}
	for (const def of defs ?? []) {
		if (!def.required) continue;
		if (out[def.name] === undefined && def.defaultValue !== undefined) {
			out[def.name] = def.defaultValue;
		}
		const value = out[def.name];
		if (value === undefined || (typeof value === 'string' && !value.trim())) {
			throw new ReviewActionError(400, `The field "${def.label}" (${def.name}) is required.`);
		}
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

export type ValidReview = (
	| {
			action: 'approve';
			hoursAssigned: number;
			rewardedHoursOverride?: number;
			feedbackMessage: string;
			justification: string;
			fields?: ReviewFieldValues;
	  }
	| {
			action: 'reject';
			feedbackMessage: string;
			internalMessage?: string;
			fields?: ReviewFieldValues;
	  }
	| { action: 'comment' | 'internal_comment'; commentText: string }
) & { projectId: string; shipId: string };

/**
 * The review form's own rules for what it lets a reviewer submit, applied to
 * the input alone (not to the ship's state; see `submitReview`).
 */
export function validateReviewInput(ship: Ship, input: ReviewInput): ValidReview {
	const { action } = input;
	if (!isReviewAction(action)) throw new ReviewActionError(400, `Unknown action: ${action}`);
	const base = { projectId: input.projectId, shipId: input.shipId };
	if (action === 'comment' || action === 'internal_comment') {
		const commentText = input.commentText ?? '';
		if (!commentText.trim()) throw new ReviewActionError(400, 'Comment text is required');
		return { ...base, action, commentText };
	}
	const feedbackMessage = input.feedbackMessage ?? '';
	if (!feedbackMessage.trim()) {
		throw new ReviewActionError(400, 'A feedback message for the author is required.');
	}
	if (action === 'reject') {
		return {
			...base,
			action,
			feedbackMessage,
			internalMessage: input.internalMessage || undefined,
			fields: normalizeFields(ship.rejectFields, input.fields)
		};
	}
	const hoursAssigned = input.hoursAssigned;
	if (hoursAssigned === undefined || !Number.isFinite(hoursAssigned) || hoursAssigned <= 0) {
		throw new ReviewActionError(400, 'An approval needs a positive number of hours to assign.');
	}
	const justification = input.justification ?? '';
	if (!justification.trim()) throw new ReviewActionError(400, 'An approval needs a justification.');
	const override = input.rewardedHoursOverride;
	if (override !== undefined) {
		if (!ship.supportsRewardedOverride) {
			throw new ReviewActionError(400, 'This ship does not accept a rewarded hours override.');
		}
		if (!Number.isFinite(override) || override < 0) {
			throw new ReviewActionError(400, 'Rewarded hours override must be a non-negative number.');
		}
	}
	return {
		...base,
		action,
		hoursAssigned,
		rewardedHoursOverride: override,
		feedbackMessage,
		justification,
		fields: normalizeFields(ship.approveFields, input.fields)
	};
}

// The review page offers a verdict only on a ship awaiting a first review
// with no approval already awaiting HQ on it, held here (including one in the
// fraud queue this member cannot see) or parked upstream as pending_hq.
async function requireOpenForVerdict(actor: ReviewActor, ship: Ship) {
	if (ship.status === 'approved' || ship.status === 'rejected') {
		throw new ReviewActionError(409, `This ship was already ${ship.status}.`);
	}
	const held = await db.pendingApproval.findMany({
		where: { programId: actor.program.id, shipId: ship.id, status: 'pending' },
		select: { queue: true, reviewerId: true }
	});
	const hidden = held.some(
		(h) =>
			h.queue === FRAUD_QUEUE &&
			!isFraudQueueReviewer(actor.membership) &&
			h.reviewerId !== reviewerIdOf(actor)
	);
	if (hidden) {
		throw new ReviewActionError(
			409,
			'This ship has an approval awaiting fraud review.',
			AWAITING_FRAUD_REVIEW
		);
	}
	if (held.length > 0 || ship.status === 'pending_hq') {
		throw new ReviewActionError(
			409,
			'This ship has an approval awaiting HQ authorization.',
			AWAITING_HQ
		);
	}
}

/**
 * The review page's `review` form action. Unless the program holds its own
 * approvals, those by members without canAuthorizeReviews, and by members
 * routed to the fraud queue, are held as a PendingApproval; every other action
 * goes to the program, approvals and rejections flagged `isHq` for HQ members.
 * A successful verdict deletes the actor's agent draft for the ship. Pass
 * `project` when it is already loaded.
 */
export async function submitReview(
	actor: ReviewActor,
	input: ReviewInput,
	project?: Project
): Promise<ReviewOutcome> {
	const client = clientOf(actor);
	const { program, membership, user } = actor;
	const detail = project ?? (await client.fetchProjectDetail({ projectId: input.projectId }));
	const ship = detail.ships.find((s) => s.id === input.shipId);
	if (!ship) throw new ReviewActionError(404, 'Ship not found on this project.');
	const review = validateReviewInput(ship, input);
	if (review.action === 'approve' || review.action === 'reject') {
		await requireOpenForVerdict(actor, ship);
	} else if (ship.status !== 'pending' && ship.status !== 'pending_hq') {
		throw new ReviewActionError(409, `This ship was already ${ship.status}.`);
	}

	const { shipId, projectId } = review;
	const reviewerId = reviewerIdOf(actor);
	const auditHours = review.action === 'approve' ? String(review.hoursAssigned) : null;
	const auditOverride = review.action === 'approve' ? (review.rewardedHoursOverride ?? null) : null;

	// Unless the program holds its own approvals, Sidekick holds non-HQ
	// approvals instead of sending them to the master endpoint. So do
	// approvals by users routed into the fraud-review experiment, which land
	// in the separate "fraud" queue; the experiment needs Sidekick to be the
	// holder.
	const queue =
		!program.programHoldsApprovals && isRoutedToFraudQueue(membership) ? FRAUD_QUEUE : undefined;
	if (
		review.action === 'approve' &&
		!program.programHoldsApprovals &&
		(!membership.canAuthorizeReviews || queue)
	) {
		log.info('queuing pending approval', { shipId, projectId, queue: queue ?? 'hq' });
		const data = {
			hoursAssigned: review.hoursAssigned,
			rewardedHoursOverride: review.rewardedHoursOverride ?? null,
			feedbackMessage: review.feedbackMessage,
			justification: review.justification,
			fields: review.fields ?? undefined,
			...(queue && { queue })
		};
		// A reviewer's earlier approval of this ship that HQ discarded is the
		// same row; approving again has to put it back in the queue.
		const held = await db.pendingApproval.upsert({
			where: { programId_shipId_reviewerId: { programId: program.id, shipId, reviewerId } },
			create: { programId: program.id, projectId, shipId, reviewerId, ...data },
			update: { ...data, status: 'pending', discardedById: null }
		});

		await audit(actor, 'review_pending_approve', shipId, {
			projectId,
			hoursAssigned: auditHours,
			rewardedHoursOverride: auditOverride,
			...(queue && { queue })
		});

		await discardReviewDraft(program.id, shipId, user.id);
		log.info('review queued for approval', { shipId, projectId, queue: queue ?? 'hq' });
		return { kind: 'held', queue: queue ? 'fraud' : 'hq', pendingApprovalId: held.id };
	}

	// The program parks an approval sent with isHq: false until HQ authorizes
	// it, which keeps a fraud-routed member's sign-off unpaid too.
	const isHq =
		membership.canAuthorizeReviews &&
		!(review.action === 'approve' && isRoutedToFraudQueue(membership));
	const base = { shipId, reviewerId };
	let upstream: SubmitReviewActionInput;
	switch (review.action) {
		case 'approve':
			// HQ users not routed to the fraud queue, or anyone at all when the
			// program holds its own approvals: everyone else's were held above.
			upstream = {
				...base,
				action: 'approve',
				hoursAssigned: review.hoursAssigned,
				rewardedHoursOverride: review.rewardedHoursOverride,
				feedbackMessage: review.feedbackMessage,
				justification: review.justification,
				isHq,
				fields: review.fields
			};
			break;
		case 'reject':
			upstream = {
				...base,
				action: 'reject',
				feedbackMessage: review.feedbackMessage,
				internalMessage: review.internalMessage,
				isHq,
				fields: review.fields
			};
			break;
		default:
			upstream = { ...base, action: review.action, commentText: review.commentText };
	}

	const result = await client.submitReviewAction(upstream);

	await audit(actor, `review_${review.action}`, shipId, {
		projectId,
		hoursAssigned: auditHours,
		rewardedHoursOverride: auditOverride
	});

	if (result.success && (review.action === 'approve' || review.action === 'reject')) {
		await discardReviewDraft(program.id, shipId, user.id);
	}
	return { kind: 'submitted', action: review.action, isHq, success: result.success };
}

// ---------------------------------------------------------------------------
// Approvals awaiting HQ. Two kinds share one id space, as on the review page:
// a PendingApproval row (held by Sidekick, in the HQ or the fraud queue) by
// its id, and an approval the program itself parks as pending_hq as
// `hq:<shipId>`. Each entry point needs canViewReviews; the queue's own
// permission (canAuthorizeReviews, or canReviewFraudQueue for the fraud
// queue) is checked here.

function requireHqAuthorizer(membership: ProgramMembership) {
	if (!membership.canAuthorizeReviews) {
		throw new ReviewActionError(403, 'Missing permission: canAuthorizeReviews');
	}
}

// Approvals held in the fraud queue may only be acted on by fraud reviewers
// (who need not be HQ authorizers); everything else needs canAuthorizeReviews.
function requireQueueAccess(membership: ProgramMembership, pending: { queue: string }) {
	if (pending.queue === FRAUD_QUEUE) {
		if (!isFraudQueueReviewer(membership)) {
			throw new ReviewActionError(403, 'This approval is awaiting fraud review.');
		}
		return;
	}
	requireHqAuthorizer(membership);
}

// An upstream pending_hq approval that Sidekick also holds (an authorize that
// sent the approval and then failed) is acted on through its held row, which
// carries the queue and its permissions; the hq: shortcut would authorize
// around them.
async function requireNotHeld(programId: string, shipId: string) {
	const held = await db.pendingApproval.findFirst({
		where: { programId, shipId, status: 'pending' },
		select: { queue: true }
	});
	if (!held) return;
	if (held.queue === FRAUD_QUEUE) {
		throw new ReviewActionError(403, 'This approval is awaiting fraud review.');
	}
	throw new ReviewActionError(
		409,
		'This approval is held in Sidekick; authorize or discard the held approval instead.'
	);
}

// The program holds an `hq:` approval, so Sidekick cannot move it into its own
// fraud queue, and a routed authorizer's sign-off must not skip it.
function requireNotRouted(membership: ProgramMembership) {
	if (isRoutedToFraudQueue(membership)) {
		throw new ReviewActionError(
			403,
			'Your sign-offs go through fraud review, which approvals this program holds itself do not support.'
		);
	}
}

/** Refuses, before anything is sent, an Authorize that `authorizeApproval` would refuse. */
export function requireCanAuthorize(
	actor: ReviewActor,
	approval: Pick<AwaitingApproval, 'heldIn'>
): void {
	requireQueueAccess(actor.membership, { queue: approval.heldIn });
	if (approval.heldIn === 'program') requireNotRouted(actor.membership);
}

async function loadHeld(actor: ReviewActor, pendingApprovalId: string): Promise<PendingApproval> {
	const pending = await db.pendingApproval.findUnique({ where: { id: pendingApprovalId } });
	if (!pending || pending.programId !== actor.program.id) {
		throw new ReviewActionError(404, 'Pending approval not found');
	}
	requireQueueAccess(actor.membership, pending);
	return pending;
}

function auditSentToFraudQueue(
	actor: ReviewActor,
	shipId: string,
	metadata: { projectId: string; originalReviewerId: string; pendingApprovalId: string }
) {
	return audit(actor, 'review_send_to_fraud_queue', shipId, { ...metadata, queue: FRAUD_QUEUE });
}

/** One approval awaiting HQ on a ship, as the review page shows it. */
export interface AwaitingApproval {
	pendingApprovalId: string;
	heldIn: 'hq' | 'fraud' | 'program';
	reviewerId: string;
	hoursAssigned: number;
	rewardedHoursOverride: number | null;
	feedbackMessage: string;
	justification: string;
}

/**
 * The approvals awaiting HQ on a ship: Sidekick's held rows, or else the
 * program's pending_hq approval (whose upstream copy the page hides when a
 * held row stands for it). Fraud-queue rows this member may not see are left
 * out, as on the page; `hiddenFraudQueued` says whether there were any.
 */
export async function findAwaitingApprovals(
	actor: ReviewActor,
	ship: Ship,
	projectId: string
): Promise<{ approvals: AwaitingApproval[]; hiddenFraudQueued: boolean }> {
	const held = await db.pendingApproval.findMany({
		where: { programId: actor.program.id, shipId: ship.id, status: 'pending' },
		orderBy: { createdAt: 'asc' }
	});
	if (held.length > 0) {
		const visible = held.filter(
			(h) =>
				h.queue !== FRAUD_QUEUE ||
				isFraudQueueReviewer(actor.membership) ||
				h.reviewerId === reviewerIdOf(actor)
		);
		return {
			hiddenFraudQueued: visible.length < held.length,
			approvals: visible.map((h) => ({
				pendingApprovalId: h.id,
				heldIn: h.queue === FRAUD_QUEUE ? 'fraud' : 'hq',
				reviewerId: h.reviewerId,
				hoursAssigned: h.hoursAssigned,
				rewardedHoursOverride: h.rewardedHoursOverride,
				feedbackMessage: h.feedbackMessage,
				justification: h.justification
			}))
		};
	}
	if (ship.status !== 'pending_hq') return { approvals: [], hiddenFraudQueued: false };
	const { events } = await clientOf(actor).fetchProjectTimeline({ projectId });
	const approval = events.findLast(
		(e): e is Extract<typeof e, { type: 'approval' }> =>
			e.type === 'approval' && e.shipId === ship.id
	);
	if (!approval) {
		throw new ReviewActionError(
			404,
			'The program reports the ship as pending_hq but its timeline has no approval for it.'
		);
	}
	return {
		hiddenFraudQueued: false,
		approvals: [
			{
				pendingApprovalId: `hq:${ship.id}`,
				heldIn: 'program',
				reviewerId: approval.actorId,
				hoursAssigned: approval.hoursAssigned,
				rewardedHoursOverride: approval.rewardedHoursOverride ?? null,
				feedbackMessage: approval.feedbackMessage,
				justification: approval.justification
			}
		]
	};
}

export type AuthorizeOutcome =
	| { kind: 'authorized'; success: boolean }
	| { kind: 'sent_to_fraud_queue' };

/**
 * The review page's Authorize (POST /api/programs/[id]/review/authorize).
 * An authorizer routed to the fraud queue moves the approval into the fraud
 * queue instead of authorizing it.
 */
export async function authorizeApproval(
	actor: ReviewActor,
	input: { pendingApprovalId: string; projectId?: string; justification?: string }
): Promise<AuthorizeOutcome> {
	const { program, membership } = actor;
	const { pendingApprovalId, projectId } = input;
	const justification = input.justification?.trim() || DEFAULT_AUTHORIZE_JUSTIFICATION;
	const client = clientOf(actor);

	if (pendingApprovalId.startsWith('hq:')) {
		requireHqAuthorizer(membership);
		const shipId = pendingApprovalId.slice(3);
		await requireNotHeld(program.id, shipId);

		requireNotRouted(membership);

		const reviewerId = reviewerIdOf(actor);
		log.debug('Direct HQ authorization', { shipId, reviewerId });
		const result = await client.submitReviewAction({
			shipId,
			reviewerId,
			action: 'authorize',
			justification
		});

		await audit(actor, 'review_authorize', shipId, {
			pendingApprovalId,
			...(projectId !== undefined && { projectId })
		});

		log.info('HQ authorization completed', { shipId, success: result.success });
		return { kind: 'authorized', success: result.success };
	}

	const pending = await loadHeld(actor, pendingApprovalId);

	// Experiment: a routed authorizer's sign-off moves the approval into the
	// fraud queue instead of sending it upstream.
	if (pending.queue !== FRAUD_QUEUE && isRoutedToFraudQueue(membership)) {
		await db.pendingApproval.update({
			where: { id: pendingApprovalId },
			data: { queue: FRAUD_QUEUE }
		});
		await auditSentToFraudQueue(actor, pending.shipId, {
			projectId: pending.projectId,
			originalReviewerId: pending.reviewerId,
			pendingApprovalId
		});

		log.info('Pending approval sent to fraud review', {
			pendingApprovalId,
			shipId: pending.shipId
		});
		return { kind: 'sent_to_fraud_queue' };
	}

	// A held approval already parked upstream (approved by an earlier
	// authorize that failed on the authorize itself): sync any edits onto
	// that approval rather than stacking a duplicate one. Otherwise a failed
	// approve has to surface: swallowing it left the authorize below to fail
	// with a bare "ship N is pending, not pending_hq".
	if (await isPendingHqUpstream(client, pending)) {
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
				fields: (pending.fields as ReviewFieldValues) ?? undefined
			});
		} catch (e) {
			// The approval is sent as the original reviewer, and a program that
			// records reviews against its own accounts (Crescent) answers 404
			// for a reviewer who has never signed in there. Only the reviewer
			// can fix that, so tell the authorizer who to ask.
			if (!(e instanceof ProtocolError) || e.status !== 404) throw e;
			const { body } = parseProtocolError(e);
			const programName = program.yswsName || program.name;
			log.warn('Original reviewer unknown upstream', {
				pendingApprovalId,
				reviewerId: pending.reviewerId,
				error: body.message
			});
			throw new ReviewActionError(
				404,
				`${body.message} If the reviewer who made this approval has never signed in to ${programName}, ask them to create an account there, then authorize again.`,
				body.error
			);
		}
	}

	const result = await client.submitReviewAction({
		shipId: pending.shipId,
		reviewerId: reviewerIdOf(actor),
		action: 'authorize',
		hoursAssigned: pending.hoursAssigned,
		rewardedHoursOverride: pending.rewardedHoursOverride ?? undefined,
		justification
	});

	await db.pendingApproval.delete({ where: { id: pendingApprovalId } });

	await audit(actor, 'review_authorize', pending.shipId, {
		projectId: pending.projectId,
		hoursAssigned: pending.hoursAssigned,
		originalReviewerId: pending.reviewerId,
		pendingApprovalId,
		queue: pending.queue
	});

	log.info('Pending approval authorized', {
		pendingApprovalId,
		shipId: pending.shipId,
		success: result.success
	});
	return { kind: 'authorized', success: result.success };
}

/**
 * The review page's Deny (DELETE /api/programs/[id]/review/authorize): an
 * approval parked upstream is deauthorized there with `message` for its
 * reviewer; a held row is marked discarded. A held row that was never sent
 * upstream has nowhere to carry the message, so it goes nowhere.
 */
export async function sendBackApproval(
	actor: ReviewActor,
	input: { pendingApprovalId: string; projectId?: string; message?: string }
): Promise<{ success: boolean; deauthorizedUpstream: boolean }> {
	const { program, membership } = actor;
	const { pendingApprovalId, projectId } = input;
	const message = input.message?.trim() || DEFAULT_DEAUTHORIZE_MESSAGE;
	const client = clientOf(actor);

	if (pendingApprovalId.startsWith('hq:')) {
		requireHqAuthorizer(membership);
		const shipId = pendingApprovalId.slice(3);
		await requireNotHeld(program.id, shipId);

		const result = await client.submitReviewAction({
			shipId,
			reviewerId: reviewerIdOf(actor),
			action: 'deauthorize',
			message
		});

		await audit(actor, 'review_discard_pending', shipId, {
			pendingApprovalId,
			...(projectId !== undefined && { projectId })
		});

		log.info('HQ deauthorization completed', { shipId, success: result.success });
		return { success: result.success, deauthorizedUpstream: true };
	}

	const pending = await loadHeld(actor, pendingApprovalId);

	// A held row whose approval is already pending_hq upstream (any of the
	// ways authorizing checks for) has to be sent back upstream too, or the
	// ship would resurface in the HQ queue.
	const upstream = await isPendingHqUpstream(client, pending);
	if (upstream) {
		await client.submitReviewAction({
			shipId: pending.shipId,
			reviewerId: reviewerIdOf(actor),
			action: 'deauthorize',
			message
		});
	}

	await db.pendingApproval.update({
		where: { id: pendingApprovalId },
		data: { status: 'discarded', discardedById: reviewerIdOf(actor) }
	});

	await audit(actor, 'review_discard_pending', pending.shipId, {
		projectId: pending.projectId,
		hoursAssigned: pending.hoursAssigned,
		originalReviewerId: pending.reviewerId,
		pendingApprovalId
	});

	log.info('Pending approval discarded', { pendingApprovalId, shipId: pending.shipId });
	return { success: true, deauthorizedUpstream: upstream };
}

/**
 * The review page's edit of an approval awaiting HQ (PATCH
 * /api/programs/[id]/review/authorize), which its Authorize button saves
 * first when the authorizer changed anything. For `hq:` approvals the program
 * is sent the whole approval, so pass every text; on a held row an omitted
 * value is left as it was. `rewardedHoursOverride`: undefined leaves it,
 * null clears it.
 */
export async function editAwaitingApproval(
	actor: ReviewActor,
	input: {
		pendingApprovalId: string;
		reviewerId?: string;
		feedbackMessage?: string;
		justification?: string;
		hoursAssigned?: number;
		rewardedHoursOverride?: number | null;
	}
): Promise<void> {
	const { pendingApprovalId, reviewerId, feedbackMessage, justification, hoursAssigned } = input;
	const override = input.rewardedHoursOverride;
	if (
		override !== undefined &&
		override !== null &&
		(typeof override !== 'number' || !Number.isFinite(override) || override < 0)
	) {
		throw new ReviewActionError(400, 'rewardedHoursOverride must be a non-negative number or null');
	}

	if (pendingApprovalId.startsWith('hq:')) {
		requireHqAuthorizer(actor.membership);
		if (!reviewerId) {
			throw new ReviewActionError(400, 'reviewerId is required for HQ pending approvals');
		}
		const shipId = pendingApprovalId.slice(3);
		await requireNotHeld(actor.program.id, shipId);

		await clientOf(actor).updateReviewAction({
			shipId,
			reviewerId,
			type: 'approval',
			feedbackMessage: feedbackMessage ?? '',
			justification: justification ?? '',
			hoursAssigned: hoursAssigned != null ? hoursAssigned : undefined,
			rewardedHoursOverride: override
		});
		log.info('HQ pending approval updated via protocol', { shipId });
		return;
	}

	const pending = await loadHeld(actor, pendingApprovalId);
	await db.pendingApproval.update({
		where: { id: pendingApprovalId },
		data: {
			feedbackMessage: feedbackMessage ?? pending.feedbackMessage,
			justification: justification ?? pending.justification,
			hoursAssigned: hoursAssigned != null ? hoursAssigned : pending.hoursAssigned,
			rewardedHoursOverride: override === undefined ? pending.rewardedHoursOverride : override
		}
	});
	log.info('Pending approval updated', { pendingApprovalId });
}
