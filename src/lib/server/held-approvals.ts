// Approvals Sidekick holds for HQ or fraud review (PendingApproval rows).
//
// By default a held approval exists only here, and the program first hears of
// it when it is authorized (approve with isHq: false, then authorize). A program
// with `mirrorHeldApprovals` hears of it the moment it is made instead, as a
// parked approval it reports as pending_hq, so its own tools can tell a ship
// that is waiting on authorization from one nobody has reviewed. Authorizing
// then edits and authorizes that parked approval, and discarding deauthorizes
// it (see the authorize endpoint).

import type { PendingApproval } from '@prisma/client';
import { ProtocolClient, ProtocolError } from '$lib/server/protocol/client.js';
import { createLogger } from '$lib/server/logger.js';

const log = createLogger('held-approvals');

type Held = Pick<
	PendingApproval,
	| 'projectId'
	| 'shipId'
	| 'reviewerId'
	| 'hoursAssigned'
	| 'rewardedHoursOverride'
	| 'feedbackMessage'
	| 'justification'
	| 'fields'
>;

// Is the ship already parked upstream (pending_hq), so a held row mirrors an
// approval the program has rather than one only Sidekick knows about?
export async function isPendingHqUpstream(
	client: ProtocolClient,
	pending: Pick<PendingApproval, 'projectId' | 'shipId'>
): Promise<boolean> {
	const { ships } = await client.fetchProjectDetail({ projectId: pending.projectId });
	return ships.some((s) => s.id === pending.shipId && s.status === 'pending_hq');
}

// Best effort: the local row is the record of the hold, and authorizing sends
// the approval upstream anyway if this never landed, so a program that is down
// or refuses (say, another reviewer's approval is already parked on the ship)
// only means it learns of the approval later.
export async function mirrorHeldApproval(client: ProtocolClient, held: Held): Promise<void> {
	try {
		if (await isPendingHqUpstream(client, held)) {
			await client.updateReviewAction({
				shipId: held.shipId,
				reviewerId: held.reviewerId,
				type: 'approval',
				feedbackMessage: held.feedbackMessage,
				justification: held.justification,
				hoursAssigned: held.hoursAssigned,
				rewardedHoursOverride: held.rewardedHoursOverride
			});
		} else {
			await client.submitReviewAction({
				shipId: held.shipId,
				reviewerId: held.reviewerId,
				action: 'approve',
				hoursAssigned: held.hoursAssigned,
				rewardedHoursOverride: held.rewardedHoursOverride ?? undefined,
				feedbackMessage: held.feedbackMessage,
				justification: held.justification,
				isHq: false,
				fields: (held.fields as Record<string, string | number | boolean>) ?? undefined
			});
		}
	} catch (e) {
		if (!(e instanceof ProtocolError)) throw e;
		log.warn('could not mirror held approval upstream', {
			shipId: held.shipId,
			error: e.displayMessage
		});
	}
}
