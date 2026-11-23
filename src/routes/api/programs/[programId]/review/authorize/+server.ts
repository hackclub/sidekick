import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolError } from '$lib/server/protocol/client.js';
import { createLogger } from '$lib/server/logger.js';
import { FRAUD_QUEUE } from '$lib/server/experiments/fraud-queue.js';
import {
	authorizeApproval,
	editAwaitingApproval,
	parseProtocolError,
	ReviewActionError,
	sendBackApproval,
	type ReviewActor
} from '$lib/server/review-actions.js';
import type { RequestEvent } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:review:authorize');

// The review page's actions on an approval awaiting HQ. The work, and the
// permission checks past canViewReviews, live in $lib/server/review-actions
// so the MCP does exactly the same; this only reads the request and shapes
// the answer.

async function actorFor({ params, locals }: RequestEvent): Promise<ReviewActor> {
	const user = locals.user;
	if (!user) throw error(401);
	const programId = params.programId!;
	const membership = await requirePermission(user.id, programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});
	const program = await db.program.findUniqueOrThrow({ where: { id: programId } });
	return { user, membership, program };
}

// A refusal from the shared actions, or the program's own error, as the page
// reads it: `message` is shown to the reviewer.
function answerFailure(e: unknown, what: string, pendingApprovalId: string): Response {
	if (e instanceof ReviewActionError) {
		if (!e.code) throw error(e.status, e.message);
		return json({ error: e.code, message: e.message }, { status: e.status });
	}
	if (e instanceof ProtocolError) {
		const { status, body } = parseProtocolError(e);
		logger.warn(`${what} protocol error`, { pendingApprovalId, status, error: body.message });
		return json(body, { status });
	}
	throw e;
}

export const POST: RequestHandler = async (event) => {
	const actor = await actorFor(event);
	const { pendingApprovalId, justification, projectId } = await event.request.json();
	if (!pendingApprovalId) throw error(400, 'pendingApprovalId is required');

	logger.info('POST authorize', { programId: event.params.programId, pendingApprovalId });

	try {
		const outcome = await authorizeApproval(actor, {
			pendingApprovalId,
			projectId: typeof projectId === 'string' ? projectId : undefined,
			justification: typeof justification === 'string' ? justification : undefined
		});
		return json(
			outcome.kind === 'sent_to_fraud_queue'
				? { success: true, queue: FRAUD_QUEUE }
				: { success: outcome.success }
		);
	} catch (e) {
		return answerFailure(e, 'Authorization', pendingApprovalId);
	}
};

export const DELETE: RequestHandler = async (event) => {
	const actor = await actorFor(event);
	const { pendingApprovalId, message, projectId } = await event.request.json();
	if (!pendingApprovalId) throw error(400, 'pendingApprovalId is required');

	logger.info('DELETE discard pending', { programId: event.params.programId, pendingApprovalId });

	try {
		const { success } = await sendBackApproval(actor, {
			pendingApprovalId,
			projectId: typeof projectId === 'string' ? projectId : undefined,
			message: typeof message === 'string' ? message : undefined
		});
		return json({ success });
	} catch (e) {
		return answerFailure(e, 'Discard', pendingApprovalId);
	}
};

export const PATCH: RequestHandler = async (event) => {
	const actor = await actorFor(event);
	const {
		pendingApprovalId,
		reviewerId,
		feedbackMessage,
		justification,
		hoursAssigned,
		rewardedHoursOverride
	} = await event.request.json();
	if (!pendingApprovalId) throw error(400, 'pendingApprovalId is required');

	logger.debug('PATCH pending approval', { programId: event.params.programId, pendingApprovalId });

	try {
		await editAwaitingApproval(actor, {
			pendingApprovalId,
			reviewerId,
			feedbackMessage,
			justification,
			hoursAssigned,
			rewardedHoursOverride
		});
		return json({ success: true });
	} catch (e) {
		return answerFailure(e, 'Edit', pendingApprovalId);
	}
};
