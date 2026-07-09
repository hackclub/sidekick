<script lang="ts">
	import TimelineEvent from './TimelineEvent.svelte';
	import type { TimelineEvent as TEvent } from '$lib/server/protocol/types.js';

	interface EditData {
		event: TEvent;
		feedbackMessage: string;
		internalMessage?: string;
		justification?: string;
	}

	interface Props {
		events: TEvent[];
		actors: Record<string, { name: string; avatarUrl: string | null }>;
		shipHours?: Record<string, number>;
		approvedShipHours?: Record<string, number>;
		canAuthorize?: boolean;
		onsave?: (data: EditData) => void;
		onauthorize?: (id: string) => void;
		ondelete?: (id: string) => void;
		oneditpending?: (id: string, reviewerId: string, feedbackMessage: string, justification: string, hoursAssigned: number) => void;
		authorizing?: string | null;
		class?: string;
	}

	let { events, actors, shipHours = {}, approvedShipHours = {}, canAuthorize = false, onsave, onauthorize, ondelete, oneditpending, authorizing = null, class: className = '' }: Props = $props();

	const shipsWithApproval = $derived(new Set(
		events
			.filter((e) => e.type === 'approval' || e.type === 'authorized_approval')
			.map((e) => e.shipId)
	));

	// hoursSubmitted is cumulative per project, so each ship's delta is measured
	// against the last *approved* ship's cumulative hours. Re-ship sequences
	// (several consecutive ships with no review in between) all share that same
	// baseline — only an approval moves it forward.
	const shipHourInfo = $derived.by(() => {
		const info: Record<string, { delta: number; cumulative: number }> = {};
		const approvalInfo: Record<string, { cumulative: number }> = {};
		const rejectedShipIds = new Set(
			events.filter((e) => e.type === 'rejection').map((e) => e.shipId)
		);
		let creditedSum = 0;
		let lastApprovedShipHours = 0;
		const shipEvents = events.filter((e) => e.type === 'ship') as Array<Extract<typeof events[number], { type: 'ship' }>>;

		for (const event of shipEvents) {
			const hours = shipHours[event.shipId] || event.hoursSubmitted || 0;
			const approved = approvedShipHours[event.shipId] ?? hours;
			const hasApproval = shipsWithApproval.has(event.shipId);

			if (rejectedShipIds.has(event.shipId)) {
				info[event.shipId] = { delta: hours, cumulative: hours };
				continue;
			}

			const delta =
				lastApprovedShipHours > 0 && hours > lastApprovedShipHours
					? hours - lastApprovedShipHours
					: hours;
			info[event.shipId] = { delta, cumulative: hours };

			if (hasApproval) {
				lastApprovedShipHours = hours;
				creditedSum += approved;
				approvalInfo[event.shipId] = { cumulative: creditedSum };
			}
		}
		return { ships: info, approvals: approvalInfo };
	});
</script>

<div class="border border-border-card rounded-card shadow-card p-8 flex flex-col gap-4 relative {className}">
	<!-- Vertical stem — aligned to avatar center: p-8(32) + icon(24) + gap(12) + avatar/2(14) = 82px -->
	{#if events.length > 1}
		<div class="absolute left-[81px] top-[46px] bottom-[46px] w-[2px] bg-border-card z-0"></div>
	{/if}

	{#each events as event, i (i)}
		<TimelineEvent {event} {actors} shipHourInfo={shipHourInfo.ships} approvalHourInfo={shipHourInfo.approvals} {canAuthorize} {onsave} {onauthorize} {ondelete} {oneditpending} {authorizing} />
	{/each}
</div>
