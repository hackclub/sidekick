// The MCP's write tools. Each one is a review page action done as the token's
// owner, through the same functions the page calls ($lib/server/review-actions),
// so it does what that person could do on the page and nothing else. This
// layer only finds what the page would have on screen (the pending ship, the
// approval awaiting HQ on it), adds the rules the MCP keeps that the page
// leaves to the reviewer's eye, and says what happened.

import { requirePermission } from '../rbac.js';
import { ProtocolError } from '../protocol/client.js';
import {
	authorizeApproval,
	AWAITING_FRAUD_REVIEW,
	AWAITING_HQ,
	editAwaitingApproval,
	findAwaitingApprovals,
	requireCanAuthorize,
	ReviewActionError,
	sendBackApproval,
	submitReview,
	validateReviewInput,
	type AwaitingApproval,
	type ReviewActor,
	type ReviewInput,
	type ReviewOutcome
} from '../review-actions.js';
import { jsonResult, reviewUrl, ToolError, type McpContext } from './access.js';
import { loadSubject, type Subject } from './subject.js';
import type { ReviewFieldValues, Ship } from '../protocol/types.js';

const HQ_TOOLS = 'authorize_approval, send_back_approval or reject_awaiting_approval';

function actorOf(ctx: McpContext, subject: Subject): ReviewActor {
	return {
		user: ctx.user,
		membership: subject.membership,
		program: subject.program,
		mcp: { tokenId: ctx.tokenId }
	};
}

function pendingShipOf(subject: Subject): Ship {
	if (!subject.pendingShip) throw new ToolError('This project has no pending ship.');
	return subject.pendingShip;
}

// The review page only warns when the hours exceed what is left of the claim;
// over the MCP they are refused outright. A claim of 0 means the program does
// not report hours on pending ships, which leaves nothing to compare against.
function requireWithinClaim(ship: Ship, hours: number) {
	if (ship.hoursSubmitted > 0 && hours > ship.hoursSubmitted + 0.005) {
		throw new ToolError(`${hours}h exceeds the ${ship.hoursSubmitted}h claimed for this ship.`);
	}
}

function requireOverrideSupported(ship: Ship, override: number | null | undefined) {
	if (override !== undefined && !ship.supportsRewardedOverride) {
		throw new ToolError('This ship does not accept `rewarded_hours_override`.');
	}
}

// The verdict refusals the page expresses by hiding its Approve and Reject
// tabs, said with where to go instead.
function explainBlockedVerdict(e: unknown): never {
	if (e instanceof ReviewActionError && e.code === AWAITING_HQ) {
		throw new ToolError(
			`The pending ship has an approval awaiting HQ authorization, so it takes no new approval or rejection. HQ acts on that approval with ${HQ_TOOLS}. Comments are still possible.`
		);
	}
	if (e instanceof ReviewActionError && e.code === AWAITING_FRAUD_REVIEW) {
		throw new ToolError(
			'The pending ship has an approval held for fraud review, so it takes no new approval or rejection. Comments are still possible.'
		);
	}
	throw e;
}

function describeReview(outcome: ReviewOutcome): Record<string, unknown> {
	if (outcome.kind === 'held') {
		return {
			result:
				outcome.queue === 'fraud'
					? "Approval held in Sidekick's fraud review queue; a fraud reviewer authorizes or sends it back."
					: 'Approval held in Sidekick for HQ authorization; it reaches the Unified YSWS DB only once HQ authorizes it.',
			heldIn: outcome.queue === 'fraud' ? 'Sidekick fraud review queue' : 'Sidekick HQ queue'
		};
	}
	const accepted = outcome.success ? {} : { programAnswered: 'success: false' };
	switch (outcome.action) {
		case 'approve':
			return {
				result: outcome.isHq
					? 'Approved: sent to the program as an HQ approval (isHq), which finalizes it with no HQ stage.'
					: 'Approval sent to the program (isHq: false), which holds it as pending_hq until HQ authorizes it.',
				...accepted
			};
		case 'reject':
			return { result: 'Rejected: sent to the program.', isHq: outcome.isHq, ...accepted };
		case 'comment':
			return { result: 'Comment sent to the program, visible to the participant.', ...accepted };
		case 'internal_comment':
			return {
				result: 'Internal comment sent to the program, visible to reviewers only.',
				...accepted
			};
	}
}

export interface SubmitReviewArgs {
	program_id: string;
	project_id: string;
	action: 'approve' | 'reject' | 'comment' | 'internal_comment';
	hours?: number;
	justification?: string;
	feedback?: string;
	rewarded_hours_override?: number;
	internal_note?: string;
	fields?: ReviewFieldValues;
	text?: string;
}

function reviewInput(
	ship: Ship,
	projectId: string,
	args: Omit<SubmitReviewArgs, 'program_id' | 'project_id'>
): ReviewInput {
	return {
		projectId,
		shipId: ship.id,
		action: args.action,
		hoursAssigned: args.hours,
		rewardedHoursOverride: args.rewarded_hours_override,
		feedbackMessage: args.feedback,
		justification: args.justification,
		internalMessage: args.internal_note,
		commentText: args.text,
		fields: args.fields
	};
}

/** The review form on the pending ship (the page's `review` action). */
export async function mcpSubmitReview(ctx: McpContext, args: SubmitReviewArgs) {
	const subject = await loadSubject(ctx, args.program_id, args.project_id, 'canCreateReviews');
	const ship = pendingShipOf(subject);
	if (args.action === 'approve') {
		if (args.hours !== undefined) requireWithinClaim(ship, args.hours);
		requireOverrideSupported(ship, args.rewarded_hours_override);
	}
	let outcome: ReviewOutcome;
	try {
		outcome = await submitReview(
			actorOf(ctx, subject),
			reviewInput(ship, args.project_id, args),
			subject.project
		);
	} catch (e) {
		explainBlockedVerdict(e);
	}
	return jsonResult({
		...describeReview(outcome),
		ship: subject.project.ships.indexOf(ship) + 1,
		reviewUrl: reviewUrl(ctx, args.program_id, args.project_id)
	});
}

// The one approval awaiting HQ on the pending ship, as the review page shows
// it in the timeline.
async function awaitingApproval(
	subject: Subject,
	actor: ReviewActor
): Promise<{ ship: Ship; approval: AwaitingApproval }> {
	const ship = pendingShipOf(subject);
	const { approvals, hiddenFraudQueued } = await findAwaitingApprovals(
		actor,
		ship,
		subject.project.id
	);
	if (approvals.length === 0) {
		if (hiddenFraudQueued) throw new ToolError('This approval is awaiting fraud review.');
		throw new ToolError(
			'The pending ship has no approval awaiting HQ authorization; submit_review gives it a first review.'
		);
	}
	if (approvals.length > 1) {
		throw new ToolError(
			`The pending ship has ${approvals.length} approvals held for HQ; the review page lists each one.`
		);
	}
	return { ship, approval: approvals[0] };
}

function heldInText(approval: AwaitingApproval): string {
	switch (approval.heldIn) {
		case 'fraud':
			return 'Sidekick fraud review queue';
		case 'hq':
			return 'Sidekick HQ queue';
		case 'program':
			return 'program (pending_hq)';
	}
}

export interface AuthorizeArgs {
	program_id: string;
	project_id: string;
	hours?: number;
	feedback?: string;
	justification?: string;
	rewarded_hours_override?: number | null;
}

/**
 * The review page's Authorize on the approval awaiting HQ: edits saved first
 * when any value changes, then the authorization.
 */
export async function mcpAuthorizeApproval(ctx: McpContext, args: AuthorizeArgs) {
	const subject = await loadSubject(ctx, args.program_id, args.project_id, 'canViewReviews');
	const actor = actorOf(ctx, subject);
	const { ship, approval } = await awaitingApproval(subject, actor);
	if (args.hours !== undefined) requireWithinClaim(ship, args.hours);
	requireOverrideSupported(ship, args.rewarded_hours_override);
	// Before the edits are saved, so a refused Authorize leaves nothing changed.
	requireCanAuthorize(actor, approval);

	const edits = {
		hoursAssigned: args.hours ?? approval.hoursAssigned,
		feedbackMessage: args.feedback ?? approval.feedbackMessage,
		justification: args.justification ?? approval.justification
	};
	const overrideChanged =
		args.rewarded_hours_override !== undefined &&
		args.rewarded_hours_override !== approval.rewardedHoursOverride;
	const edited =
		edits.hoursAssigned !== approval.hoursAssigned ||
		edits.feedbackMessage !== approval.feedbackMessage ||
		edits.justification !== approval.justification ||
		overrideChanged;
	if (edited) {
		if (!edits.justification.trim()) throw new ToolError('`justification` cannot be empty.');
		await editAwaitingApproval(actor, {
			pendingApprovalId: approval.pendingApprovalId,
			reviewerId: approval.reviewerId,
			...edits,
			rewardedHoursOverride: overrideChanged ? args.rewarded_hours_override : undefined
		});
	}

	const outcome = await authorizeApproval(actor, {
		pendingApprovalId: approval.pendingApprovalId,
		projectId: args.project_id
	});
	const override = overrideChanged ? args.rewarded_hours_override : approval.rewardedHoursOverride;
	return jsonResult({
		result:
			outcome.kind === 'sent_to_fraud_queue'
				? "Sent to Sidekick's fraud review queue instead of being authorized (this membership routes approvals to fraud review); a fraud reviewer authorizes or sends it back."
				: 'Authorized: the program finalizes the approval with these hours, which go into the Unified YSWS DB, and the participant receives the feedback.',
		...(outcome.kind === 'authorized' && !outcome.success && { programAnswered: 'success: false' }),
		heldIn: heldInText(approval),
		edited,
		hoursAssigned: edits.hoursAssigned,
		...(override != null && { rewardedHoursOverride: override }),
		reviewUrl: reviewUrl(ctx, args.program_id, args.project_id)
	});
}

async function sendBack(
	subject: Subject,
	actor: ReviewActor,
	approval: AwaitingApproval,
	message: string | undefined
) {
	const { deauthorizedUpstream } = await sendBackApproval(actor, {
		pendingApprovalId: approval.pendingApprovalId,
		projectId: subject.project.id,
		message
	});
	return {
		sentBack: deauthorizedUpstream
			? 'The program was told to deauthorize the approval (the ship returns to pending) and sent the message for the reviewer who approved it.'
			: 'The approval Sidekick held was discarded (shown as such on the review page); it had not reached the program, so the message was not sent or stored anywhere.',
		heldIn: heldInText(approval)
	};
}

export interface SendBackArgs {
	program_id: string;
	project_id: string;
	message?: string;
}

/** The review page's Deny on the approval awaiting HQ. */
export async function mcpSendBackApproval(ctx: McpContext, args: SendBackArgs) {
	const subject = await loadSubject(ctx, args.program_id, args.project_id, 'canViewReviews');
	const actor = actorOf(ctx, subject);
	const { approval } = await awaitingApproval(subject, actor);
	const result = await sendBack(subject, actor, approval, args.message);
	return jsonResult({
		...result,
		result: 'The ship awaits a first review again.',
		reviewUrl: reviewUrl(ctx, args.program_id, args.project_id)
	});
}

export interface RejectAwaitingArgs {
	program_id: string;
	project_id: string;
	feedback: string;
	internal_note?: string;
	fields?: ReviewFieldValues;
	send_back_message?: string;
}

/**
 * What HQ does on the page to reject a ship whose approval awaits HQ: Deny
 * the approval, then reject the ship from the review form.
 */
export async function mcpRejectAwaitingApproval(ctx: McpContext, args: RejectAwaitingArgs) {
	const subject = await loadSubject(ctx, args.program_id, args.project_id, 'canCreateReviews');
	// Both halves' permissions up front, so a refusal never leaves the
	// approval sent back with the ship unrejected.
	await requirePermission(ctx.user.id, args.program_id, 'canViewReviews', {
		isSuperAdmin: ctx.user.isSuperAdmin
	});
	const actor = actorOf(ctx, subject);
	const { ship, approval } = await awaitingApproval(subject, actor);
	const rejection = {
		action: 'reject' as const,
		feedback: args.feedback,
		internal_note: args.internal_note,
		fields: args.fields
	};
	validateReviewInput(ship, reviewInput(ship, args.project_id, rejection));

	const sentBack = await sendBack(subject, actor, approval, args.send_back_message);

	// The page reloads the project after Deny before its form offers Reject.
	const project = await subject.client.fetchProjectDetail({ projectId: args.project_id });
	const current = project.ships.find((s) => s.id === ship.id) ?? ship;
	let outcome: ReviewOutcome;
	try {
		outcome = await submitReview(actor, reviewInput(current, args.project_id, rejection), project);
	} catch (e) {
		// The send-back stands either way, so the answer has to say so.
		const reason =
			e instanceof ReviewActionError
				? e.message
				: e instanceof ProtocolError
					? `the program's master endpoint refused: ${e.displayMessage}`
					: `unexpected ${e instanceof Error ? e.name : 'error'}`;
		throw new ToolError(`${sentBack.sentBack} The rejection then failed: ${reason}`);
	}
	return jsonResult({
		...sentBack,
		...describeReview(outcome),
		reviewUrl: reviewUrl(ctx, args.program_id, args.project_id)
	});
}
