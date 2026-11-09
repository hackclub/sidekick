import { getContext, setContext } from 'svelte';
import type { FraudReviewState } from '$lib/server/fraud-review.js';

export type QueueFilter = 'todo' | 'skipped' | 'clean';

export const QUEUE_FILTERS: { id: QueueFilter; label: string }[] = [
	{ id: 'todo', label: 'To review' },
	{ id: 'skipped', label: 'Skipped' },
	{ id: 'clean', label: 'Clean' }
];

export function parseFilter(value: string | null): QueueFilter {
	return value === 'skipped' || value === 'clean' ? value : 'todo';
}

/** Which filter a project falls under: a verdict for an earlier ship still needs review. */
export function filterOf(review: FraudReviewState | null | undefined): QueueFilter {
	if (!review || !review.forPendingShip) return 'todo';
	return review.status;
}

/**
 * The list, as the selected project's page sees it. Verdicts are applied to
 * the list in place, so a project leaves "To review" the moment it's
 * marked, without refetching every page of the queue.
 */
export interface FraudQueue {
	/** Where to go after a verdict on this project: the next one in the list as filtered now. */
	nextHref(projectId: string): string;
	record(projectId: string, review: FraudReviewState | null): void;
}

const KEY = Symbol('fraud-review-queue');

export function setFraudQueue(queue: FraudQueue) {
	setContext(KEY, queue);
}

export function getFraudQueue(): FraudQueue {
	return getContext<FraudQueue>(KEY);
}
