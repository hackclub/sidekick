<script lang="ts">
	import type { EChartsType } from 'echarts';
	import {
		type FlaggedRange,
		type HistoryMark
	} from '$lib/review/localHistory.js';
	import { HISTORY_KIND_STYLE } from '$lib/review/localHistoryStyle.js';
	import { Code } from 'lucide-svelte';

	export interface CommitMark {
		key: string;
		time: number;
		title: string;
		subtitle?: string;
		avatarUrl?: string;
	}

	interface HeartbeatPoint {
		time: number;
		lineno: number;
		cursorpos: number;
		lines: number;
		editor: string;
	}

	interface Props {
		heartbeats: HeartbeatPoint[];
		hoveredTimeRange?: [number, number] | null;
		timezone?: string;
		onfocuschange?: (timestamp: number) => void;
		/** VS Code local history snapshots to pin above the plot. */
		historyMarks?: HistoryMark[];
		/** Stretches of coding with no local history behind them. */
		flaggedRanges?: FlaggedRange[];
		onhistoryclick?: (key: string) => void;
		/** Git commits to pin above the plot. */
		commitMarks?: CommitMark[];
	}

	let {
		heartbeats,
		hoveredTimeRange = null,
		timezone = 'UTC',
		onfocuschange,
		historyMarks = [],
		flaggedRanges = [],
		onhistoryclick,
		commitMarks = []
	}: Props = $props();

	const GRID = { left: 50, right: 30, bottom: 80 };
	const COMMIT_COLOR = '#8b5cf6';

	// Icon rows between the legend and the plot: commits on top, local history below.
	const hasHistoryRow = $derived(historyMarks.length > 0 || flaggedRanges.length > 0);
	const hasCommitRow = $derived(commitMarks.length > 0);
	const commitRowTop = 26;
	const historyRowTop = $derived(hasCommitRow ? 48 : 30);
	const gridTop = $derived(
		hasCommitRow && hasHistoryRow ? 90 : hasCommitRow || hasHistoryRow ? 84 : 50
	);

	// Bumped whenever the chart's x mapping changes (render, zoom, resize) so the
	// HTML overlays get repositioned.
	let layoutTick = $state(0);
	let plotWidth = $state(0);

	let plotRoot: HTMLDivElement;
	let chart: EChartsType;
	let overlayCanvas: HTMLCanvasElement;
	let overlayCtx: CanvasRenderingContext2D | null;
	let unsubscribe: (() => void) | undefined;

	type AxisPointerEvent = {
		seriesIndex?: number;
		dataIndex?: number;
	};

	$effect(() => {
		void heartbeats;
		void gridTop;

		(async () => {
			const echarts = await import('echarts');

			// @ts-expect-error echarts-gl lacks type definitions
			await import('echarts-gl');

			if (heartbeats.length === 0)
				return;

			const totalLines: [number, number][] = [];
			const lines: [number, number][] = [];
			const cols: [number, number][] = [];

			for (const hb of heartbeats) {
				totalLines.push([hb.time, hb.lines]);
				lines.push([hb.time, hb.lineno]);
				cols.push([hb.time, hb.cursorpos]);
			}

			const pointCount = heartbeats.length;
			const seriesType = pointCount < 5000 ? 'scatter' : 'scatterGL';

			if (chart) {
				chart.dispose();
			}
			chart = echarts.init(plotRoot);

			const option = {
				tooltip: {
					trigger: 'axis',
					formatter: (params: Array<{ seriesName: string; value: [number, number]; color: string }>) => {
						if (!params.length) return '';
						const time = new Date(params[0].value[0]).toLocaleTimeString('en-US', {
							hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: timezone
						});
						const lines = params.map((p) => `<span style="color:${p.color}">\u25CF</span> ${p.seriesName}: ${p.value[1]}`);
						return `${time}<br/>${lines.join('<br/>')}`;
					}
				},
				xAxis: {
					type: 'time',
					axisLabel: {
						color: '#737373',
						formatter: (value: number) =>
							new Date(value).toLocaleTimeString('en-US', {
								hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone
							})
					},
					axisLine: { lineStyle: { color: '#e2e2e2' } },
					splitLine: { show: false }
				},
				yAxis: [
					{
						type: 'value',
						name: 'line num',
						nameTextStyle: { color: '#06b6d4' },
						axisLabel: { color: '#06b6d4' },
						splitLine: { lineStyle: { color: '#f0f0f0' } }
					},
					{
						type: 'value',
						name: 'cursor pos',
						nameTextStyle: { color: '#e33062' },
						axisLabel: { color: '#e33062' },
						splitLine: { show: false }
					}
				],
				series: [
					{
						name: 'total lines',
						type: seriesType,
						data: totalLines,
						yAxisIndex: 0,
						itemStyle: { color: '#7c3aed' },
							emphasis: {
							itemStyle: { borderColor: '#000', borderWidth: 2, color: '#7c3aed' }
						}
					},
					{
						name: 'line num',
						type: seriesType,
						data: lines,
						yAxisIndex: 0,
						itemStyle: { color: '#06b6d4' },
							emphasis: {
							itemStyle: { borderColor: '#000', borderWidth: 2, color: '#06b6d4' }
						}
					},
					{
						name: 'cursor pos',
						type: seriesType,
						data: cols,
						yAxisIndex: 1,
						itemStyle: { color: '#e33062' },
							emphasis: {
							itemStyle: { borderColor: '#000', borderWidth: 2, color: '#e33062' }
						}
					}
				],
				grid: { ...GRID, top: gridTop },
				backgroundColor: 'transparent',
				legend: {
					show: true,
					top: 0,
					textStyle: { color: '#737373' },
					selectedMode: true
				},
				dataZoom: [
					{ type: 'inside', xAxisIndex: 0 },
					{
						type: 'slider',
						xAxisIndex: 0,
						height: 24,
						bottom: 28,
						handleSize: '200%',
						labelFormatter: (_: number, value: string) =>
							new Date(value).toLocaleTimeString('en-US', {
								hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone
							}),
						handleStyle: { borderWidth: 1, borderRadius: 4 },
						moveHandleSize: 14,
						emphasis: { handleStyle: { borderWidth: 1 } }
					}
				]
			};

			let highlightedItem: { seriesName: string; value: [number, number]; dataIndex: number } | null = null;

			chart.setOption(option);
			chart.on('updateAxisPointer', (...args: unknown[]) => {
				const [event] = args;
				if (!event || typeof event !== 'object')
					return;

				const pe = event as AxisPointerEvent;
				if (typeof pe.seriesIndex === 'number' && typeof pe.dataIndex === 'number') {
					const series = option.series[pe.seriesIndex];
					highlightedItem = {
						seriesName: series.name,
						value: series.data[pe.dataIndex],
						dataIndex: pe.dataIndex
					};
				}
			});

			chart.on('datazoom', () => {
				layoutTick++;
			});
			layoutTick++;

			chart.getZr().on('click', () => {
				if (highlightedItem) {
					onfocuschange?.(highlightedItem.value[0]);
				}
			});

			if (unsubscribe) {
				unsubscribe();
			}

			const resizeListener = () => { chart.resize(); updateOverlay(); layoutTick++; };
			window.addEventListener('resize', resizeListener);
			unsubscribe = () => window.removeEventListener('resize', resizeListener);

			if (overlayCanvas) {
				overlayCtx = overlayCanvas.getContext('2d');
				updateOverlay();
			}
		})();
	});

	function toPx(t: number): number | null {
		if (!chart) return null;
		const px = chart.convertToPixel({ xAxisIndex: 0 }, t) as number;
		return Number.isFinite(px) ? px : null;
	}

	interface MarkCluster {
		x: number;
		marks: HistoryMark[];
		kind: HistoryMark['kind'];
	}

	interface CommitCluster {
		x: number;
		marks: CommitMark[];
	}

	const overlay = $derived.by(() => {
		void layoutTick;
		const clusters: MarkCluster[] = [];
		const lines: { x: number; kind: HistoryMark['kind'] }[] = [];
		const bands: (FlaggedRange & { x1: number; x2: number })[] = [];
		const commitClusters: CommitCluster[] = [];
		const commitLines: number[] = [];
		if (!chart || plotWidth === 0) return { clusters, lines, bands, commitClusters, commitLines };

		const minX = GRID.left;
		const maxX = plotWidth - GRID.right;

		for (const m of [...historyMarks].sort((a, b) => a.time - b.time)) {
			const x = toPx(m.time);
			if (x === null || x < minX - 1 || x > maxX + 1) continue;
			lines.push({ x, kind: m.kind });
			const last = clusters[clusters.length - 1];
			if (last && x - last.x < 16) last.marks.push(m);
			else clusters.push({ x, marks: [m], kind: m.kind });
		}
		for (const c of clusters) {
			c.kind = c.marks.some((m) => m.kind === 'ai')
				? 'ai'
				: c.marks.some((m) => m.kind === 'save')
					? 'save'
					: 'other';
		}

		for (const r of flaggedRanges) {
			const a = toPx(r.start);
			const b = toPx(r.end);
			if (a === null || b === null) continue;
			const x1 = Math.max(minX, a);
			const x2 = Math.min(maxX, Math.max(b, a + 2));
			if (x2 > x1) bands.push({ ...r, x1, x2 });
		}

		for (const m of [...commitMarks].sort((a, b) => a.time - b.time)) {
			const x = toPx(m.time);
			if (x === null || x < minX - 1 || x > maxX + 1) continue;
			commitLines.push(x);
			const last = commitClusters[commitClusters.length - 1];
			if (last && x - last.x < 16) last.marks.push(m);
			else commitClusters.push({ x, marks: [m] });
		}

		return { clusters, lines, bands, commitClusters, commitLines };
	});

	let hoveredCluster = $state<MarkCluster | null>(null);
	let hoveredCommits = $state<CommitCluster | null>(null);

	function formatMarkTime(t: number): string {
		return new Date(t).toLocaleTimeString('en-US', {
			hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: timezone
		});
	}

	function updateOverlay() {
		void hoveredTimeRange;
		if (!chart || !overlayCanvas || !overlayCtx)
			return;

		const width = plotRoot.offsetWidth;
		const height = plotRoot.offsetHeight;
		overlayCanvas.width = width;
		overlayCanvas.height = height;
		overlayCtx.clearRect(0, 0, width, height);

		if (!hoveredTimeRange)
			return;

		const [startTime, endTime] = hoveredTimeRange;
		const startPixel = chart.convertToPixel({ xAxisIndex: 0 }, startTime);
		const endPixel = chart.convertToPixel({ xAxisIndex: 0 }, endTime);
		overlayCtx.fillStyle = 'rgba(212, 126, 47, 0.12)';
		overlayCtx.fillRect(startPixel - 2, 0, endPixel - startPixel + 4, height);
	}

	$effect(() => {
		void hoveredTimeRange;
		updateOverlay();
		if (!chart || heartbeats.length === 0)
			return;

		if (heartbeats.length > 5000)
			return;

		chart.dispatchAction({ type: 'downplay', seriesIndex: [0, 1, 2] });

		if (hoveredTimeRange) {
			const [startTime, endTime] = hoveredTimeRange;
			const indices: number[] = [];
			
			for (let i = 0; i < heartbeats.length; i++) {
				if (heartbeats[i].time >= startTime && heartbeats[i].time <= endTime) {
					indices.push(i);
				}
			}

			chart.dispatchAction({
				type: 'highlight',
				batch: [
					{ seriesIndex: 0, dataIndex: indices },
					{ seriesIndex: 1, dataIndex: indices },
					{ seriesIndex: 2, dataIndex: indices }
				]
			});
		}
	});
</script>

<div class="relative h-96 w-full shrink-0" bind:clientWidth={plotWidth}>
	<div bind:this={plotRoot} class="absolute inset-0"></div>
	<canvas bind:this={overlayCanvas} class="pointer-events-none absolute inset-0"></canvas>

	{#each overlay.bands as band, i (i)}
		<div
			class="pointer-events-none absolute flex justify-center {band.severity === 'missing'
				? 'band-missing'
				: 'band-uncertain'}"
			style="left: {band.x1}px; width: {band.x2 - band.x1}px; top: {gridTop}px; bottom: {GRID.bottom}px;"
		>
			<span class="band-label">{band.label}</span>
		</div>
	{/each}

	{#each overlay.lines as line, i (i)}
		<div
			class="pointer-events-none absolute w-px opacity-40"
			style="left: {line.x}px; top: {historyRowTop + 16}px; bottom: {GRID.bottom}px; background: {HISTORY_KIND_STYLE[
				line.kind
			].color};"
		></div>
	{/each}

	{#each overlay.clusters as cluster, i (i)}
		{@const kindStyle = HISTORY_KIND_STYLE[cluster.kind]}
		<button
			type="button"
			class="absolute -translate-x-1/2 z-10 flex items-center gap-0.5 rounded-full h-4 px-1 shadow-sm cursor-pointer ring-1 ring-page/60"
			style="left: {cluster.x}px; top: {historyRowTop}px; background-color: {kindStyle.color};"
			aria-label="{cluster.marks.length} local history entr{cluster.marks.length === 1 ? 'y' : 'ies'}"
			onmouseenter={() => (hoveredCluster = cluster)}
			onmouseleave={() => (hoveredCluster = null)}
			onclick={() => onhistoryclick?.(cluster.marks[0].key)}
		>
			<kindStyle.icon size={10} color="white" strokeWidth={2.5} />
			{#if cluster.marks.length > 1}
				<span class="text-[8px] font-bold text-white leading-none">{cluster.marks.length}</span>
			{/if}
		</button>
	{/each}

	{#each overlay.commitLines as x, i (i)}
		<div
			class="pointer-events-none absolute border-l border-dashed opacity-70"
			style="left: {x}px; top: {commitRowTop + 16}px; bottom: {GRID.bottom}px; border-color: {COMMIT_COLOR};"
		></div>
	{/each}

	{#each overlay.commitClusters as cluster, i (i)}
		<button
			type="button"
			class="absolute -translate-x-1/2 z-10 flex items-center gap-0.5 rounded-full h-4 px-1 shadow-sm cursor-pointer ring-1 ring-page/60"
			style="left: {cluster.x}px; top: {commitRowTop}px; background-color: {COMMIT_COLOR};"
			aria-label="{cluster.marks.length} commit{cluster.marks.length === 1 ? '' : 's'}"
			onmouseenter={() => (hoveredCommits = cluster)}
			onmouseleave={() => (hoveredCommits = null)}
			onclick={() => onfocuschange?.(cluster.marks[0].time)}
		>
			<Code size={10} color="white" strokeWidth={2.5} />
			{#if cluster.marks.length > 1}
				<span class="text-[8px] font-bold text-white leading-none">{cluster.marks.length}</span>
			{/if}
		</button>
	{/each}

	{#if hoveredCommits}
		<div
			class="pointer-events-none absolute z-20 w-64 -translate-x-1/2 rounded-tag border border-border-card bg-page px-2.5 py-2 shadow-card"
			style="left: {Math.min(Math.max(hoveredCommits.x, 130), plotWidth - 130)}px; top: {gridTop}px;"
		>
			{#each hoveredCommits.marks.slice(0, 6) as mark (mark.key)}
				<div class="flex flex-col gap-0.5 py-0.5">
					<span class="text-[12px] text-text-primary leading-snug line-clamp-2">{mark.title}</span>
					<div class="flex items-center gap-1.5 min-w-0">
						{#if mark.avatarUrl}
							<img src={mark.avatarUrl} alt="" class="w-3.5 h-3.5 rounded-full shrink-0 object-cover" />
						{/if}
						{#if mark.subtitle}
							<span class="text-[11px] text-text-secondary truncate">{mark.subtitle}</span>
						{/if}
						<span class="ml-auto text-[10px] font-mono text-text-tertiary shrink-0"
							>{formatMarkTime(mark.time)}</span
						>
					</div>
				</div>
			{/each}
			{#if hoveredCommits.marks.length > 6}
				<span class="text-[11px] text-text-tertiary italic">+{hoveredCommits.marks.length - 6} more</span>
			{/if}
			<div class="text-[10px] text-text-tertiary mt-1">Click to jump to it in the table</div>
		</div>
	{/if}

	{#if hoveredCluster}
		<div
			class="pointer-events-none absolute z-20 w-64 -translate-x-1/2 rounded-tag border border-border-card bg-page px-2.5 py-2 shadow-card"
			style="left: {Math.min(Math.max(hoveredCluster.x, 130), plotWidth - 130)}px; top: {gridTop}px;"
		>
			{#each hoveredCluster.marks.slice(0, 6) as mark (mark.key)}
				{@const ms = HISTORY_KIND_STYLE[mark.kind]}
				<div class="flex flex-col py-0.5">
					<div class="flex items-center gap-1.5 min-w-0">
						<ms.icon size={11} color={ms.color} class="shrink-0" />
						<span class="text-[12px] text-text-primary truncate">{mark.title}</span>
						<span class="ml-auto text-[10px] font-mono text-text-tertiary shrink-0"
							>{formatMarkTime(mark.time)}</span
						>
					</div>
					{#if mark.subtitle}
						<span class="text-[11px] text-text-secondary line-clamp-2 pl-[17px]">{mark.subtitle}</span>
					{/if}
				</div>
			{/each}
			{#if hoveredCluster.marks.length > 6}
				<span class="text-[11px] text-text-tertiary italic">+{hoveredCluster.marks.length - 6} more</span>
			{/if}
			<div class="text-[10px] text-text-tertiary mt-1">Click to open in Local history</div>
		</div>
	{/if}
</div>

<style>
	.band-missing {
		background: repeating-linear-gradient(
			135deg,
			rgba(191, 0, 0, 0.06) 0 6px,
			rgba(191, 0, 0, 0.12) 6px 12px
		);
		border-left: 1px solid rgba(191, 0, 0, 0.35);
		border-right: 1px solid rgba(191, 0, 0, 0.35);
	}

	.band-uncertain {
		background: repeating-linear-gradient(
			135deg,
			rgba(245, 158, 11, 0.06) 0 6px,
			rgba(245, 158, 11, 0.12) 6px 12px
		);
		border-left: 1px solid rgba(245, 158, 11, 0.35);
		border-right: 1px solid rgba(245, 158, 11, 0.35);
	}

	.band-label {
		margin-top: 4px;
		height: fit-content;
		max-width: 100%;
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--color-page, #fff);
		font-size: 10px;
		font-weight: 600;
		line-height: 1.25;
		text-align: center;
		overflow: hidden;
	}

	.band-missing .band-label {
		color: var(--color-check-fail);
	}

	.band-uncertain .band-label {
		color: #b45309;
	}
</style>
