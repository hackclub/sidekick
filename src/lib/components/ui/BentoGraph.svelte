<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';

	interface VolumePoint {
		date: string;
		count: number;
		estimated: boolean;
	}

	interface Props {
		title: string;
		description: string;
		count: number | string;
		icon?: Snippet;
		data?: VolumePoint[];
		class?: string;
	}

	let {
		title,
		description,
		count,
		icon,
		data = [],
		class: className = ''
	}: Props = $props();

	const WINDOW = 12;

	/** How many days back from the latest data point the visible window is panned. */
	let offset = $state(0);
	let chartEl = $state<HTMLDivElement | null>(null);
	let dragStartX = 0;
	let dragStartOffset = 0;
	let dragging = $state(false);

	const maxOffset = $derived(Math.max(data.length - WINDOW, 0));
	const visible = $derived.by(() => {
		const clamped = Math.min(offset, maxOffset);
		const start = data.length - WINDOW - clamped;
		const points: Array<VolumePoint | null> = data.slice(Math.max(start, 0), start + WINDOW);
		while (points.length < WINDOW) points.unshift(null);
		return points;
	});
	const maxVal = $derived(Math.max(...visible.map((p) => p?.count ?? 0), 1));
	const rangeLabel = $derived.by(() => {
		const shown = visible.filter((p) => p !== null);
		if (shown.length === 0) return '';
		return `${shortDate(shown[0].date)} – ${shortDate(shown[shown.length - 1].date)}`;
	});

	function shortDate(iso: string): string {
		const d = new Date(iso);
		return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
	}

	function dayLabel(point: VolumePoint): string {
		const d = new Date(point.date);
		const day = d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' });
		return `${day}: ${point.count}${point.estimated ? ' (carried from last recorded day)' : ''}`;
	}

	function pan(days: number) {
		offset = Math.min(Math.max(offset + days, 0), maxOffset);
	}

	function onPointerDown(e: PointerEvent) {
		if (maxOffset === 0) return;
		dragging = true;
		dragStartX = e.clientX;
		dragStartOffset = Math.min(offset, maxOffset);
		chartEl?.setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging || !chartEl) return;
		const slotWidth = chartEl.clientWidth / WINDOW;
		const shift = Math.round((e.clientX - dragStartX) / slotWidth);
		offset = Math.min(Math.max(dragStartOffset + shift, 0), maxOffset);
	}

	function onPointerUp() {
		dragging = false;
	}
</script>

<div
	class="bg-surface flex flex-col items-start overflow-clip px-6 py-5 rounded-bento h-[280px] {className}"
>
	<div class="flex gap-2.5 items-center w-full">
		<div class="flex flex-1 gap-2.5 items-center min-w-0">
			{#if icon}
				<div class="shrink-0 text-text-secondary">
					{@render icon()}
				</div>
			{/if}
			<div class="flex flex-col gap-0.5 min-w-0">
				<p class="font-bold text-[15px] text-text-primary tracking-[-0.45px] truncate">{title}</p>
				<p class="text-[12px] text-text-secondary tracking-[-0.24px] truncate">{description}</p>
			</div>
		</div>
		<p class="font-bold text-[28px] text-text-primary shrink-0">{count}</p>
	</div>

	<div class="flex items-center justify-between w-full mt-2">
		<span class="text-[11px] text-text-tertiary tabular-nums tracking-[-0.22px]">{rangeLabel}</span>
		<div class="flex gap-1">
			<button
				type="button"
				aria-label="Pan to older days"
				disabled={offset >= maxOffset}
				onclick={() => pan(WINDOW)}
				class="size-6 flex items-center justify-center rounded-tag border border-border-card text-text-secondary hover:bg-white transition-colors disabled:opacity-35 disabled:pointer-events-none"
			>
				<ChevronLeft size={14} />
			</button>
			<button
				type="button"
				aria-label="Pan to newer days"
				disabled={offset === 0}
				onclick={() => pan(-WINDOW)}
				class="size-6 flex items-center justify-center rounded-tag border border-border-card text-text-secondary hover:bg-white transition-colors disabled:opacity-35 disabled:pointer-events-none"
			>
				<ChevronRight size={14} />
			</button>
		</div>
	</div>

	<!-- Drag-to-pan is a convenience; the chevron buttons above are the accessible control. -->
	<div
		bind:this={chartEl}
		role="presentation"
		class="flex flex-col flex-1 min-h-0 w-full mt-1 select-none touch-pan-y {maxOffset > 0
			? dragging
				? 'cursor-grabbing'
				: 'cursor-grab'
			: ''}"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
	>
		<div class="flex items-end gap-1 flex-1 min-h-0 border-b-2 border-border-card">
			{#each visible as point, i (point?.date ?? `pad-${i}`)}
				<div
					class="flex flex-col flex-1 min-w-0 h-full items-center justify-end gap-1"
					title={point ? dayLabel(point) : undefined}
				>
					{#if point}
						<span
							class="text-[11px] tracking-[-0.22px] tabular-nums {point.count > 0
								? 'font-medium text-text-secondary'
								: 'text-text-faint'}"
						>
							{point.count}
						</span>
						{#if point.count > 0}
							<div
								class="rounded-t-section w-full max-w-[28px] {point.estimated
									? 'bg-accent/45'
									: 'bg-accent'}"
								style="height: {Math.max((point.count / maxVal) * 82, 4)}%"
							></div>
						{/if}
					{/if}
				</div>
			{/each}
		</div>
		<div class="flex gap-1 pt-1.5">
			{#each visible as point, i (point?.date ?? `pad-${i}`)}
				<span
					class="flex-1 min-w-0 text-center text-[10px] text-text-tertiary tabular-nums tracking-[-0.2px] truncate"
				>
					{point ? shortDate(point.date) : ''}
				</span>
			{/each}
		</div>
	</div>
</div>
