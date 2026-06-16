<script lang="ts">
	import * as d3 from 'd3';

	interface HeartbeatPoint {
		time: number;
	}

	interface Props {
		heartbeats: HeartbeatPoint[];
		visibleRange?: [number, number] | null;
		timezone?: string;
		onhover?: (timeRange: [number, number] | null) => void;
		onclick?: (timestamp: number) => void;
	}

	let { heartbeats, visibleRange = null, timezone = 'UTC', onhover, onclick }: Props = $props();

	const BUCKET_SIZE_MS = 2 * 60 * 1000;
	const HEIGHT = 48;

	const frequencyData = $derived.by(() => {
		if (heartbeats.length === 0)
			return [];

		const groups: Record<number, number> = {};
		for (const hb of heartbeats) {
			const bucket = Math.floor(hb.time / BUCKET_SIZE_MS) * BUCKET_SIZE_MS;
			groups[bucket] = (groups[bucket] || 0) + 1;
		}

		return Object.keys(groups)
			.map(Number)
			.sort((a, b) => a - b)
			.map((key) => ({ time: key, count: groups[key] }));
	});

	const gapMarkers = $derived.by(() => {
		if (frequencyData.length < 2)
			return [];

		const markers: number[] = [];
		for (let i = 0; i < frequencyData.length - 1; i++) {
			if (frequencyData[i + 1].time - frequencyData[i].time > BUCKET_SIZE_MS + 1000) {
				markers.push(i + 0.5);
			}
		}

		return markers;
	});

	const maxCount = $derived(Math.max(...frequencyData.map((d) => d.count), 1));

	const visibleOverlay = $derived.by(() => {
		if (!visibleRange || frequencyData.length === 0)
			return null;

		const [rangeStart, rangeEnd] = visibleRange;
		const startX = frequencyData.findIndex((b) => b.time + BUCKET_SIZE_MS > rangeStart);
		if (startX === -1)
			return null;

		const firstAfter = frequencyData.findIndex((b) => b.time >= rangeEnd);
		const endX = firstAfter === -1 ? frequencyData.length - 1 : firstAfter - 1;
		if (endX < startX)
			return null;

		return { x: startX, width: Math.max(0.5, endX - startX + 1) };
	});

	let container = $state<HTMLDivElement>();
	let hoveredBucket = $state<number | null>(null);
	let tooltipX = $state(0);

	const tooltipContent = $derived.by(() => {
		if (hoveredBucket === null || hoveredBucket >= frequencyData.length)
			return null;

		const bucket = frequencyData[hoveredBucket];
		const time = new Date(bucket.time);
		const timeStr = time.toLocaleTimeString('en-US', {
			hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: timezone
		});

		return { time: timeStr, count: bucket.count };
	});

	$effect(() => {
		void frequencyData;
		void visibleOverlay;
		if (!container)
			return;

		draw();
	});

	function draw() {
		if (!container || frequencyData.length === 0)
			return;

		const totalWidth = container.clientWidth || 600;
		const n = frequencyData.length;

		d3.select(container).selectAll('svg').remove();

		const svg = d3.select(container)
			.append('svg')
			.attr('width', totalWidth)
			.attr('height', HEIGHT)
			.attr('viewBox', `0 0 ${totalWidth} ${HEIGHT}`)
			.style('cursor', 'pointer');

		const xScale = d3.scaleLinear().domain([0, n]).range([0, totalWidth]);
		const yScale = d3.scaleLinear().domain([0, maxCount]).range([HEIGHT, 0]);

		if (visibleOverlay) {
			svg.append('rect')
				.attr('x', xScale(visibleOverlay.x))
				.attr('y', 0)
				.attr('width', xScale(visibleOverlay.width) - xScale(0))
				.attr('height', HEIGHT)
				.attr('fill', '#d47e2f')
				.attr('opacity', 0.1)
				.attr('pointer-events', 'none');
		}

		const hoverRect = svg.append('rect')
			.attr('y', 0)
			.attr('width', xScale(1) - xScale(0))
			.attr('height', HEIGHT)
			.attr('fill', '#d47e2f')
			.attr('opacity', 0)
			.attr('pointer-events', 'none');

		svg.append('path')
			.datum(frequencyData)
			.attr('fill', 'none')
			.attr('stroke', '#000')
			.attr('stroke-width', 1.5)
			.attr('d', d3.line<{ time: number; count: number }>()
				.x((_, i) => xScale(i + 0.5))
				.y((d) => yScale(d.count))
				.curve(d3.curveLinear)(frequencyData) ?? '');

		for (const gapX of gapMarkers) {
			svg.append('line')
				.attr('x1', xScale(gapX)).attr('x2', xScale(gapX))
				.attr('y1', 0).attr('y2', HEIGHT)
				.attr('stroke', '#a3a3a3')
				.attr('stroke-opacity', 0.5)
				.attr('stroke-width', 1)
				.attr('stroke-dasharray', '3,3')
				.attr('pointer-events', 'none');
		}

		svg.append('rect')
			.attr('width', totalWidth).attr('height', HEIGHT)
			.attr('fill', 'none').attr('pointer-events', 'all')
			.on('mousemove', function (event) {
				const [mx] = d3.pointer(event);
				const idx = Math.floor((mx / totalWidth) * n);

				if (idx >= 0 && idx < n) {
					hoveredBucket = idx;
					tooltipX = event.clientX;
					hoverRect.attr('x', xScale(idx)).attr('opacity', 0.15);
					const bucket = frequencyData[idx];
					onhover?.([bucket.time, bucket.time + BUCKET_SIZE_MS]);
				}
			})
			.on('mouseleave', function () {
				hoveredBucket = null;
				hoverRect.attr('opacity', 0);
				onhover?.(null);
			})
			.on('click', function () {
				if (hoveredBucket === null || hoveredBucket >= frequencyData.length)
					return;

				const bucket = frequencyData[hoveredBucket];
				const targetTime = bucket.time + BUCKET_SIZE_MS / 2;
				let low = 0, high = heartbeats.length - 1;

				while (low <= high) {
					const mid = Math.floor((low + high) / 2);
					if (heartbeats[mid].time < targetTime) {
						low = mid + 1;
					}
					else if (heartbeats[mid].time > targetTime) {
						high = mid - 1;
					}
					else {
						low = mid;
						break;
					}
				}

				const nearest = Math.min(low, heartbeats.length - 1);
				onclick?.(heartbeats[nearest].time);
			});
	}
</script>

{#if heartbeats.length > 0 && frequencyData.length > 0}
	<div class="relative h-12 w-full shrink-0 border-b border-border-card bg-surface/30" bind:this={container}>
		{#if tooltipContent !== null}
			<div
				class="pointer-events-none fixed z-50 -translate-x-1/2 rounded-tag border border-border-card bg-page px-2 py-1 text-xs shadow-card"
				style="left: {tooltipX}px; top: 3.5rem;"
			>
				<div class="font-mono text-text-primary">{tooltipContent.time}</div>
				<div class="text-text-tertiary">{tooltipContent.count} hb</div>
			</div>
		{/if}
	</div>
{:else}
	<div class="h-12 w-full shrink-0 border-b border-border-card bg-surface/30 animate-pulse"></div>
{/if}
