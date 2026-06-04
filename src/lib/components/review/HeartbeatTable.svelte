<script lang="ts">
	import { Virtualizer } from 'virtua/svelte';
	import { SvelteSet } from 'svelte/reactivity';

	interface HeartbeatRow {
		time: number;
		lineno: number;
		cursorpos: number;
		is_write: boolean;
		project: string;
		language: string;
		entity: string;
		branch: string;
		category: string;
		editor: string;
		machine: string;
		user_agent: string;
		ip: string;
		lines: number;
		source_type: number | string;
	}

	interface Props {
		heartbeats: HeartbeatRow[];
		focusedTimestamp?: number;
		animationKey?: number;
		onrangechange?: (range: [number, number] | null) => void;
	}

	let { heartbeats, focusedTimestamp, animationKey, onrangechange }: Props = $props();
	void animationKey;

	let scrollRef = $state<HTMLElement | undefined>();

	const filtered = $derived(heartbeats);
	const data = $derived(Array.from({ length: filtered.length }, (_, i) => i));

	const sourceTypeMap: Record<number | string, string> = { 0: 'Hackatime', 1: 'Wakapi', 2: 'Test data' };

	interface ColDef {
		key: string;
		label: string;
		minWidth: number;
		getValue: (hb: HeartbeatRow) => string;
		mono?: boolean;
		highlightKey?: string;
	}

	const columns: ColDef[] = [
		{ key: 'time', label: 'Time', minWidth: 65, mono: true, getValue: (hb) => new Date(hb.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) },
		{ key: 'project', label: 'Project', minWidth: 55, highlightKey: 'project', getValue: (hb) => hb.project },
		{ key: 'language', label: 'Lang', minWidth: 40, highlightKey: 'language', getValue: (hb) => hb.language },
		{ key: 'editor', label: 'Editor', minWidth: 45, getValue: (hb) => hb.editor },
		{ key: 'entity', label: 'File Path', minWidth: 80, mono: true, highlightKey: 'entity', getValue: (hb) => hb.entity },
		{ key: 'lineno', label: 'Line', minWidth: 40, mono: true, getValue: (hb) => String(hb.lineno) },
		{ key: 'cursorpos', label: 'Col', minWidth: 35, mono: true, getValue: (hb) => String(hb.cursorpos) },
		{ key: 'lines', label: 'Lines', minWidth: 42, mono: true, getValue: (hb) => String(hb.lines) },
		{ key: 'isWrite', label: 'Write', minWidth: 40, getValue: (hb) => hb.is_write ? '✓' : '✗' },
		{ key: 'sourceType', label: 'Source', minWidth: 55, getValue: (hb) => sourceTypeMap[hb.source_type] ?? String(hb.source_type) },
		{ key: 'branch', label: 'Branch', minWidth: 50, highlightKey: 'branch', getValue: (hb) => hb.branch },
		{ key: 'category', label: 'Category', minWidth: 55, getValue: (hb) => hb.category },
		{ key: 'machine', label: 'Machine', minWidth: 55, highlightKey: 'machine', getValue: (hb) => hb.machine },
		{ key: 'userAgent', label: 'User Agent', minWidth: 70, highlightKey: 'user_agent', getValue: (hb) => hb.user_agent },
		{ key: 'ip', label: 'IP', minWidth: 50, highlightKey: 'ip', getValue: (hb) => hb.ip },
	];

	const CHAR_WIDTH = 6.6;
	const CELL_PAD = 20;
	const MAX_COL_WIDTH = 400;
	const GAP = 12;

	// Auto-computed base widths from data
	const autoWidths = $derived.by(() => {
		const widths: number[] = columns.map((col) => Math.max(col.minWidth, col.label.length * CHAR_WIDTH + CELL_PAD));
		const sampleSize = Math.min(filtered.length, 200);
		const step = filtered.length > sampleSize ? Math.floor(filtered.length / sampleSize) : 1;
		for (let i = 0; i < filtered.length; i += step) {
			const hb = filtered[i];
			for (let c = 0; c < columns.length; c++) {
				const val = columns[c].getValue(hb);
				const charW = columns[c].mono ? 7.2 : CHAR_WIDTH;
				const needed = Math.min(MAX_COL_WIDTH, val.length * charW + CELL_PAD);
				if (needed > widths[c]) {
					widths[c] = needed;
				}
			}
		}
		return widths.map((w) => Math.ceil(w));
	});

	// User overrides from drag resizing
	let userWidths = $state<Record<number, number>>({});

	// Reset overrides when data changes
	$effect(() => {
		void autoWidths;
		userWidths = {};
	});

	const colWidths = $derived(autoWidths.map((w, i) => userWidths[i] ?? w));
	const totalWidth = $derived(colWidths.reduce((acc, w) => acc + w, 0) + (columns.length - 1) * GAP + 24);

	// Column resize dragging
	let resizingCol = $state(-1);

	function startColResize(colIndex: number, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		resizingCol = colIndex;
		const startX = e.clientX;
		const startW = colWidths[colIndex];

		function onMove(ev: MouseEvent) {
			const newW = Math.max(columns[colIndex].minWidth, startW + (ev.clientX - startX));
			userWidths = { ...userWidths, [colIndex]: newW };
		}
		function onUp() {
			resizingCol = -1;
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		}
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	const focusedIndex = $derived.by(() => {
		if (focusedTimestamp === undefined || filtered.length === 0)
			return -1;
		let low = 0, high = filtered.length - 1;
		while (low <= high) {
			const mid = Math.floor((low + high) / 2);
			if (filtered[mid].time < focusedTimestamp) {
				low = mid + 1;
			} else if (filtered[mid].time > focusedTimestamp) {
				high = mid - 1;
			} else
				return mid;
		}
		if (low >= filtered.length)
			return filtered.length - 1;
		if (high < 0)
			return 0;
		return Math.abs(filtered[low].time - focusedTimestamp) < Math.abs(filtered[high].time - focusedTimestamp) ? low : high;
	});

	let virtualizer = $state<Virtualizer<number> | undefined>();
	let startIndex = $state(0);
	let endIndex = $state(0);

	const visibleRange = $derived.by(() => {
		if (filtered.length === 0 || startIndex > endIndex)
			return null;
		const s = Math.max(0, Math.min(startIndex, filtered.length - 1));
		const e = Math.max(s, Math.min(endIndex, filtered.length - 1));
		return [filtered[s].time, filtered[e].time] as [number, number];
	});

	let lastReportedRange = $state<[number, number] | null>(null);

	$effect(() => {
		const range = visibleRange;
		const changed = range === null
			? lastReportedRange !== null
			: !lastReportedRange || range[0] !== lastReportedRange[0] || range[1] !== lastReportedRange[1];
		if (!changed)
			return;
		lastReportedRange = range;
		onrangechange?.(range);
	});

	$effect(() => {
		void focusedIndex;
		virtualizer?.scrollToIndex(focusedIndex, { align: 'center' });
	});

	const tooltip = $state({ show: false, x: '0px', y: '0px', text: '' });
	let highlightText = $state<string | null>(null);
	let highlightKey = $state<string | null>(null);

	const highlightedIndices = $derived.by(() => {
		if (!highlightText || !highlightKey || filtered.length === 0)
			return new SvelteSet<number>();
		const s = new SvelteSet<number>();
		const lo = Math.max(0, startIndex - 25);
		const hi = Math.min(filtered.length - 1, endIndex + 25);
		for (let i = lo; i <= hi; i++) {
			const hb = filtered[i];
			const val = (hb as unknown as Record<string, unknown>)[highlightKey];
			if (val === highlightText) {
				s.add(i);
			}
		}
		return s;
	});

	function tooltipAction(node: HTMLElement, config: { text: string; key: string }) {
		const mouseOver = (event: MouseEvent) => {
			highlightKey = config.key;
			highlightText = config.text;
			tooltip.show = true;
			tooltip.text = config.text;
			tooltip.x = `${event.pageX + 10}px`;
			tooltip.y = `${event.pageY + 10}px`;
		};
		const mouseMove = (event: MouseEvent) => {
			tooltip.x = `${event.pageX + 10}px`;
			tooltip.y = `${event.pageY + 10}px`;
		};
		const mouseOut = () => {
			tooltip.show = false;
			highlightText = null;
			highlightKey = null;
		};
		node.addEventListener('mouseover', mouseOver);
		node.addEventListener('mousemove', mouseMove);
		node.addEventListener('mouseout', mouseOut);
		return {
			destroy() {
				node.removeEventListener('mouseover', mouseOver);
				node.removeEventListener('mousemove', mouseMove);
				node.removeEventListener('mouseout', mouseOut);
			}
		};
	}
</script>

{#if tooltip.show}
	<div
		class="pointer-events-none fixed z-50 max-w-[300px] break-words rounded-tag border border-border-card bg-page/90 px-2 py-1 font-mono text-[11px] shadow-card backdrop-blur-sm"
		style:left={tooltip.x}
		style:top={tooltip.y}
	>
		{tooltip.text}
	</div>
{/if}

{#if filtered.length > 0}
	<div bind:this={scrollRef} class="flex-1 overflow-auto min-h-0 {resizingCol >= 0 ? 'select-none' : ''}">
		<div style:min-width="{totalWidth}px">
			<div class="sticky top-0 z-10 flex h-8 items-center gap-3 bg-page px-3 text-[11px] font-bold text-text-secondary border-b border-border-card">
				{#each columns as col, i (col.key)}
					<div class="shrink-0 px-1 relative" style:width="{colWidths[i]}px">
						{col.label}
						{#if i < columns.length - 1}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-accent/30 z-20"
								onmousedown={(e) => startColResize(i, e)}
							></div>
						{/if}
					</div>
				{/each}
			</div>

			<Virtualizer
				bind:this={virtualizer}
				{data}
				getKey={(_, i) => i}
				itemSize={28}
				onscroll={() => {
					if (!virtualizer || typeof virtualizer.findStartIndex !== 'function')
						return;
					startIndex = virtualizer.findStartIndex();
					endIndex = virtualizer.findEndIndex();
				}}
				{scrollRef}
			>
				<!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
				{#snippet children(_, index)}
					{@const hb = filtered[index]}
					{@const isSelected = hb.time === focusedTimestamp}

					<div class="data-row flex h-7 items-center gap-3 px-3 text-[11px] leading-7" data-selected={isSelected}>
						{#each columns as col, i (col.key)}
							{@const val = col.getValue(hb)}
							{@const hk = col.highlightKey}
							{#if hk}
								<div
									class="cell {col.mono ? 'font-mono' : ''}"
									style:width="{colWidths[i]}px"
									use:tooltipAction={{ text: val, key: hk }}
									data-highlighted={highlightKey === hk && highlightedIndices.has(index)}
								>
									{val}
								</div>
							{:else}
								<div
									class="cell {col.mono ? 'font-mono' : ''}"
									style:width="{colWidths[i]}px"
								>
									{val}
								</div>
							{/if}
						{/each}
					</div>
				{/snippet}
			</Virtualizer>
		</div>
	</div>
{:else}
	<div class="flex-1 flex items-center justify-center text-sm text-text-tertiary py-8">
		No heartbeat rows to display.
	</div>
{/if}

<style>
	.cell {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex-shrink: 0;
		padding-left: 0.25rem;
		padding-right: 0.25rem;
	}

	.data-row[data-selected='true'] {
		animation: highlight 1s ease-in-out forwards;
	}

	.cell[data-highlighted='true'] {
		background: rgba(212, 126, 47, 0.15);
	}

	@keyframes highlight {
		0% { background-color: rgba(212, 126, 47, 0.3); }
		100% { background-color: transparent; }
	}
</style>
