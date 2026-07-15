<script lang="ts">
	import { Hourglass, Asterisk, BotOff, Ship, Anchor, AlertTriangle } from 'lucide-svelte';

	interface PreviousShip {
		programName: string;
		date: string;
		hours: number;
		url?: string;
	}

	interface Props {
		aggregatedSeconds: number;
		/** Heartbeat fetching hit its safety cap; all figures are lower bounds. */
		truncated?: boolean;
		shippedHours?: number;
		aiSeconds: number;
		previousShips: PreviousShip[];
		loading?: boolean;
		class?: string;
	}

	let { aggregatedSeconds, truncated = false, shippedHours, aiSeconds, previousShips, loading = false, class: className = '' }: Props = $props();

	function fmt(seconds: number): string {
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}

	function fmtDelta(seconds: number): string {
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		return `-${m > 0 ? `${h}h ${m}m` : `${h}h`}`;
	}

	const shippedSeconds = $derived(shippedHours != null && shippedHours > 0 ? shippedHours * 3600 : null);
	const hasShippedCap = $derived(shippedSeconds != null && shippedSeconds < aggregatedSeconds);

	// The funnel base: use shipped hours if it caps aggregated, otherwise use aggregated
	const baseSeconds = $derived(hasShippedCap ? shippedSeconds! : aggregatedSeconds);

	// Scale AI deduction proportionally if we're capping to shipped hours
	const scaledAiSeconds = $derived(
		aggregatedSeconds > 0 ? Math.round(aiSeconds * (baseSeconds / aggregatedSeconds)) : 0
	);
	const afterAi = $derived(baseSeconds - scaledAiSeconds);

	const previousTotal = $derived(previousShips.reduce((sum, s) => sum + s.hours * 3600, 0));
	const remaining = $derived(Math.max(0, afterAi - previousTotal));
</script>

<div class="border border-border-card rounded-card shadow-card p-8 flex flex-col gap-4 {className}">
	<div class="flex items-center justify-between w-full">
		<div class="flex gap-2 items-center">
			<Hourglass size={14} class="text-text-primary" />
			<span class="font-bold text-[15px] text-text-primary tracking-[-0.4px]">Hour breakdown</span>
		</div>
	</div>

	{#if !loading && truncated}
		<div class="flex items-start gap-2 px-3 py-2 rounded-section bg-amber-400/10 border border-amber-400/40 text-xs text-amber-700 tracking-[-0.2px]">
			<AlertTriangle size={14} class="shrink-0 mt-0.5" />
			<span>Hackatime returned more activity than could be fetched, so these figures are a lower bound, not the full total.</span>
		</div>
	{/if}

	{#if loading}
		<div class="flex flex-col gap-3 w-full animate-pulse">
			<!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
			{#each Array(3) as _, i (i)}
				<div class="flex items-center justify-between w-full">
					<div class="flex gap-2 items-center">
						<div class="w-[14px] h-[14px] rounded-sm bg-surface"></div>
						<div class="h-3.5 w-24 rounded bg-surface"></div>
					</div>
					<div class="h-3.5 w-12 rounded bg-surface"></div>
				</div>
			{/each}
		</div>
	{:else}
	<div class="flex flex-col gap-3 w-full relative">
		<div class="absolute left-[6px] top-[7px] bottom-[7px] w-[18px] border-l-2 border-b-2 border-border-card rounded-bl-[8px] z-0"></div>

		<div class="flex items-center justify-between w-full">
			<div class="flex gap-2 items-center">
				<span class="relative z-10 flex items-center justify-center w-[14px] rounded-sm bg-white"><Asterisk size={14} class="text-text-primary" /></span>
				<span class="text-sm text-text-primary tracking-[-0.3px]">Aggregated time</span>
			</div>
			<span class="font-bold text-sm text-text-primary tracking-[-0.3px]">{fmt(aggregatedSeconds)}</span>
		</div>

		{#if hasShippedCap}
			{@const cappedBy = aggregatedSeconds - shippedSeconds!}
			<div class="flex items-center justify-between w-full">
				<div class="flex gap-2 items-center">
					<span class="relative z-10 flex items-center justify-center w-[14px] rounded-sm bg-white"><Anchor size={14} class="text-text-primary" /></span>
					<span class="text-sm text-text-primary tracking-[-0.3px]">Shipped hours</span>
				</div>
				<span class="text-sm text-text-primary tracking-[-0.3px]">
					<span class="font-bold">{fmt(shippedSeconds!)}</span>
					<span class="text-xs"> ({fmtDelta(cappedBy)})</span>
				</span>
			</div>
		{/if}

		{#if scaledAiSeconds > 0}
			<div class="flex items-center justify-between w-full">
				<div class="flex gap-2 items-center">
					<span class="relative z-10 flex items-center justify-center w-[14px] rounded-sm bg-white"><BotOff size={14} class="text-text-primary" /></span>
					<span class="text-sm text-text-primary tracking-[-0.3px]">Excluding AI</span>
				</div>
				<span class="text-sm text-text-primary tracking-[-0.3px]">
					<span class="font-bold">{fmt(afterAi)}</span>
					<span class="text-xs"> ({fmtDelta(scaledAiSeconds)})</span>
				</span>
			</div>
		{/if}

		{#each previousShips as ship, i (i)}
			{@const deducted = ship.hours * 3600}
			{@const priorDeductions = previousShips.slice(0, i).reduce((s, p) => s + p.hours * 3600, 0)}
			<div class="flex items-center justify-between w-full">
				<div class="flex gap-2 items-center">
					<span class="relative z-10 flex items-center justify-center w-[14px] rounded-sm bg-white"><Ship size={14} class="text-text-primary" /></span>
					<span class="text-sm text-text-primary tracking-[-0.3px]">
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						Ship to {#if ship.url}<a href={ship.url} target="_blank" rel="noopener noreferrer" class="text-link underline">{ship.programName}</a>{:else}<span class="text-link underline">{ship.programName}</span>{/if}{#if ship.date} on {ship.date}{/if}
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</span>
				</div>
				<span class="text-sm text-text-primary tracking-[-0.3px]">
					<span class="font-bold">{fmt(afterAi - priorDeductions - deducted)}</span>
					<span class="text-xs"> ({fmtDelta(deducted)})</span>
				</span>
			</div>
		{/each}

		<div class="flex items-center justify-between w-full">
			<div class="flex gap-2 items-center">
				<span class="w-[14px]"></span>
				<span class="font-bold text-sm text-text-primary tracking-[-0.3px]">Total remaining</span>
			</div>
			<span class="font-bold text-sm text-text-primary tracking-[-0.3px]">{fmt(remaining)}</span>
		</div>
	</div>
	{/if}
</div>
