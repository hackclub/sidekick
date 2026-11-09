import { db } from './db.js';
import { resolveActorIds } from './actors.js';
import type { Project } from './protocol/types.js';

// The fraud-review flag: a person's call, from the Fraud Review page, on
// whether a ship's Hackatime heartbeats were inflated with fraud tooling.
// See the FraudReview model for what "clean" does and does not mean.

export const FRAUD_REVIEW_STATUSES = ['clean', 'skipped'] as const;
export type FraudReviewStatus = (typeof FRAUD_REVIEW_STATUSES)[number];

export const FRAUD_REVIEW_NOTE_MAX = 2000;

export function isFraudReviewStatus(value: unknown): value is FraudReviewStatus {
	return FRAUD_REVIEW_STATUSES.includes(value as FraudReviewStatus);
}

/** The verdict a project shows: the one for its pending ship, or else its most recent. */
export interface FraudReviewState {
	status: FraudReviewStatus;
	shipId: string;
	/** False when the verdict was recorded for a ship before the pending one. */
	forPendingShip: boolean;
	note: string | null;
	by: { name: string; avatarUrl: string | null };
	at: string;
}

/** The ship a verdict lands on: the most recent pending one, as on the review page. */
export function fraudReviewShip(project: Pick<Project, 'ships'>) {
	return project.ships.findLast((s) => s.status === 'pending' || s.status === 'pending_hq') ?? null;
}

/**
 * Each project's verdict, keyed by project id. `pendingShipIds` maps a
 * project to the ship a current verdict would be for (null when none is
 * pending); projects with no verdict at all are absent from the result.
 */
export async function loadFraudReviewStates(
	programId: string,
	pendingShipIds: Map<string, string | null>
): Promise<Map<string, FraudReviewState>> {
	const out = new Map<string, FraudReviewState>();
	if (pendingShipIds.size === 0) return out;

	const rows = await db.fraudReview.findMany({
		where: { programId, projectId: { in: [...pendingShipIds.keys()] } },
		orderBy: { updatedAt: 'desc' },
		include: { user: { select: { name: true, avatarUrl: true, slackId: true, hcaId: true } } }
	});

	// The verdict for the pending ship wins; otherwise the newest one stands in,
	// flagged as being for an earlier ship.
	const chosen = new Map<string, (typeof rows)[number]>();
	for (const row of rows) {
		const pendingShipId = pendingShipIds.get(row.projectId);
		const current = chosen.get(row.projectId);
		if (!current || (row.shipId === pendingShipId && current.shipId !== pendingShipId)) {
			chosen.set(row.projectId, row);
		}
	}

	// Reviewers appear as everywhere else in Sidekick: by their Slack name.
	const actorId = (u: (typeof rows)[number]['user']) => u.slackId || u.hcaId;
	const actors = await resolveActorIds([
		...new Set([...chosen.values()].map((r) => actorId(r.user)))
	]);

	for (const [projectId, row] of chosen) {
		const actor = actors.get(actorId(row.user));
		out.set(projectId, {
			status: isFraudReviewStatus(row.status) ? row.status : 'skipped',
			shipId: row.shipId,
			forPendingShip: row.shipId === pendingShipIds.get(projectId),
			note: row.note,
			by: { name: actor?.name ?? row.user.name, avatarUrl: actor?.avatarUrl ?? row.user.avatarUrl },
			at: row.updatedAt.toISOString()
		});
	}
	return out;
}

export async function loadFraudReviewState(
	programId: string,
	project: Pick<Project, 'id' | 'ships'>
): Promise<FraudReviewState | null> {
	const states = await loadFraudReviewStates(
		programId,
		new Map([[project.id, fraudReviewShip(project)?.id ?? null]])
	);
	return states.get(project.id) ?? null;
}

/** Records (or overwrites) the verdict for a ship, audit-logged like other review actions. */
export async function setFraudReview(input: {
	programId: string;
	projectId: string;
	shipId: string;
	userId: string;
	status: FraudReviewStatus;
	note: string | null;
}) {
	const { programId, projectId, shipId, userId, status, note } = input;
	await db.fraudReview.upsert({
		where: { programId_projectId_shipId: { programId, projectId, shipId } },
		create: { programId, projectId, shipId, userId, status, note },
		update: { userId, status, note }
	});
	await db.auditLog.create({
		data: {
			programId,
			userId,
			action: `fraud_review_${status}`,
			entityType: 'ship',
			entityId: shipId,
			metadata: { projectId, note }
		}
	});
}

/** Removes the verdict for a ship, so the project counts as unreviewed again. */
export async function clearFraudReview(input: {
	programId: string;
	projectId: string;
	shipId: string;
	userId: string;
}) {
	const { programId, projectId, shipId, userId } = input;
	const removed = await db.fraudReview.deleteMany({ where: { programId, projectId, shipId } });
	if (removed.count === 0) return;
	await db.auditLog.create({
		data: {
			programId,
			userId,
			action: 'fraud_review_cleared',
			entityType: 'ship',
			entityId: shipId,
			metadata: { projectId }
		}
	});
}
