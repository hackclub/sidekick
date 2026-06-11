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
		onauthorize?: (id: string, hoursAssigned?: number) => void;
		ondelete?: (id: string) => void;
		oneditpending?: (id: string, feedbackMessage: string, justification: string, hoursAssigned: number) => void;
		authorizing?: string | null;
		class?: string;
	}

	let { events, actors, shipHours = {}, approvedShipHours = {}, canAuthorize = false, onsave, onauthorize, ondelete, oneditpending, authorizing = null, class: className = '' }: Props = $props();

	const shipsWithApproval = $derived(new Set(
		events
			.filter((e) => e.type === 'approval' || e.type === 'authorized_approval')
			.map((e) => e.shipId)
	));

	const shipHourInfo = $derived.by(() => {
		const info: Record<string, { delta: number; cumulative: number }> = {};
		const approvalInfo: Record<string, { cumulative: number }> = {};
		const rejectedShipIds = new Set(
			events.filter((e) => e.type === 'rejection').map((e) => e.shipId)
		);
		let runningSum = 0;
		const shipEvents = events.filter((e) => e.type === 'ship') as Array<Extract<typeof events[number], { type: 'ship' }>>;
		const lastShipId = shipEvents.length > 0 ? shipEvents[shipEvents.length - 1].shipId : null;

		for (const event of shipEvents) {
			const hours = shipHours[event.shipId] || event.hoursSubmitted || 0;
			const approved = approvedShipHours[event.shipId] ?? hours;
			const hasApproval = shipsWithApproval.has(event.shipId);
			const isLast = event.shipId === lastShipId;

			if (rejectedShipIds.has(event.shipId)) {
				info[event.shipId] = { delta: hours, cumulative: hours };
				continue;
			}

			if (isLast && runningSum > 0 && hours > runningSum) {
				const delta = Math.max(0, hours - runningSum);
				info[event.shipId] = { delta, cumulative: hasApproval ? delta : hours };
				if (hasApproval) {
					approvalInfo[event.shipId] = { cumulative: runningSum + approved };
				}
			} else {
				runningSum += approved;
				info[event.shipId] = { delta: hours, cumulative: hasApproval ? hours : runningSum };
				if (hasApproval) {
					approvalInfo[event.shipId] = { cumulative: runningSum };
				}
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
