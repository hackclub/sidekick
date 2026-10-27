// Fraud review queue experiment.
//
// Normally an HQ reviewer's approval goes straight upstream. Members with
// `routeToFraudQueue` instead have their approvals held as a PendingApproval
// in the "fraud" queue, where a member with `canReviewFraudQueue` (someone who
// actually reads heartbeats) authorizes or sends it back. The original
// reviewer keeps the upstream attribution, exactly like a community approval
// authorized by HQ.
//
// Both flags are per-membership and set from the program's manage page, so
// the experiment is switched off per user by unticking "Route approvals to
// fraud review" — no code or data changes needed. Rows already in the fraud
// queue stay actionable by fraud reviewers until cleared.

import type { ProgramMembership } from '@prisma/client';

type QueueMembership = Pick<ProgramMembership, 'routeToFraudQueue' | 'canReviewFraudQueue'>;

export const FRAUD_QUEUE = 'fraud';
export const HQ_QUEUE = 'hq';

// Should this member's approvals be held for fraud review instead of going upstream?
export function isRoutedToFraudQueue(membership: QueueMembership): boolean {
	return membership.routeToFraudQueue;
}

// Can this member see the fraud queue and authorize items in it?
export function isFraudQueueReviewer(membership: QueueMembership): boolean {
	return membership.canReviewFraudQueue;
}
