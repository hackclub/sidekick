<script lang="ts">
	import type { EChartsType } from 'echarts';

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
	}

	let { heartbeats, hoveredTimeRange = null, timezone = 'UTC', onfocuschange }: Props = $props();

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
				grid: { left: 50, right: 30, top: 50, bottom: 80 },
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

			chart.getZr().on('click', () => {
				if (highlightedItem) {
					onfocuschange?.(highlightedItem.value[0]);
				}
			});

			if (unsubscribe) {
				unsubscribe();
			}

			const resizeListener = () => { chart.resize(); updateOverlay(); };
			window.addEventListener('resize', resizeListener);
			unsubscribe = () => window.removeEventListener('resize', resizeListener);

			if (overlayCanvas) {
				overlayCtx = overlayCanvas.getContext('2d');
				updateOverlay();
			}
		})();
	});

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

<div class="relative h-96 w-full shrink-0">
	<div bind:this={plotRoot} class="absolute inset-0"></div>
	<canvas bind:this={overlayCanvas} class="pointer-events-none absolute inset-0"></canvas>
</div>
