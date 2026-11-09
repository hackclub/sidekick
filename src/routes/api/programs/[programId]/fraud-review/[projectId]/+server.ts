import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient, ProtocolError } from '$lib/server/protocol/client.js';
import {
	FRAUD_REVIEW_NOTE_MAX,
	clearFraudReview,
	fraudReviewShip,
	isFraudReviewStatus,
	loadFraudReviewState,
	loadFraudReviewStates,
	setFraudReview
} from '$lib/server/fraud-review.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:fraud-review');

// Sets the fraud-review verdict for the project's pending ship. The caller
// names the ship it was looking at, and the verdict is refused if the
// project has shipped again since, so a verdict on one set of heartbeats
// can't land on a newer ship the reviewer never saw.
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canViewHeartbeats', {
		isSuperAdmin: user.isSuperAdmin
	});

	const { shipId, status, note } = await request.json();
	if (typeof shipId !== 'string' || !shipId) throw error(400, 'shipId is required');
	if (!isFraudReviewStatus(status)) throw error(400, "status must be 'clean' or 'skipped'");
	if (note != null && typeof note !== 'string') throw error(400, 'note must be a string or null');
	const trimmed = typeof note === 'string' ? note.trim() : '';
	if (trimmed.length > FRAUD_REVIEW_NOTE_MAX) {
		throw error(400, `note must be at most ${FRAUD_REVIEW_NOTE_MAX} characters`);
	}

	const program = await db.program.findUniqueOrThrow({ where: { id: params.programId } });
	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);

	let project;
	try {
		project = await client.fetchProjectDetail({ projectId: params.projectId });
	} catch (e) {
		if (e instanceof ProtocolError) {
			logger.warn('project lookup failed', { projectId: params.projectId, status: e.status });
			throw error(502, `Upstream error: ${e.displayMessage}`);
		}
		throw e;
	}

	if (fraudReviewShip(project)?.id !== shipId) {
		throw error(409, 'This project has a newer ship (or none pending). Reload to review it.');
	}

	logger.info('set fraud review', {
		programId: params.programId,
		projectId: project.id,
		shipId,
		status
	});
	await setFraudReview({
		programId: params.programId,
		projectId: project.id,
		shipId,
		userId: user.id,
		status,
		note: trimmed || null
	});

	return json({ fraudReview: await loadFraudReviewState(params.programId, project) });
};

// Clears the verdict for a ship, putting the project back among the unreviewed.
export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canViewHeartbeats', {
		isSuperAdmin: user.isSuperAdmin
	});

	const { shipId } = await request.json();
	if (typeof shipId !== 'string' || !shipId) throw error(400, 'shipId is required');

	logger.info('clear fraud review', {
		programId: params.programId,
		projectId: params.projectId,
		shipId
	});
	await clearFraudReview({
		programId: params.programId,
		projectId: params.projectId,
		shipId,
		userId: user.id
	});

	// What the project shows now: nothing, or a verdict for an earlier ship.
	const states = await loadFraudReviewStates(
		params.programId,
		new Map([[params.projectId, shipId]])
	);
	return json({ fraudReview: states.get(params.projectId) ?? null });
};
