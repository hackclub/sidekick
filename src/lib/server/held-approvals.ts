// Approvals Sidekick holds for HQ or fraud review (PendingApproval rows).
//
// A held approval exists only here, and the program first hears of it when it
// is authorized (approve with isHq: false, then authorize). A program with
// `programHoldsApprovals` is the holder itself instead and Sidekick holds
// nothing for it, so a ship's waiting approval is never in both places.

import type { PendingApproval } from '@prisma/client';
import type { ProtocolClient } from '$lib/server/protocol/client.js';

// Is the ship already parked upstream (pending_hq)? A held row can be, when an
// earlier authorize sent the approval but failed on the authorize itself.
export async function isPendingHqUpstream(
	client: ProtocolClient,
	pending: Pick<PendingApproval, 'projectId' | 'shipId'>
): Promise<boolean> {
	const { ships } = await client.fetchProjectDetail({ projectId: pending.projectId });
	return ships.some((s) => s.id === pending.shipId && s.status === 'pending_hq');
}
