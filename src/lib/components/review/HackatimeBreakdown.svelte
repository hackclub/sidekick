<script lang="ts">
	import type { EChartsType } from 'echarts';

	interface HeartbeatRow {
		time: number;
		editor: string;
		machine: string;
		user_agent: string;
		ip: string;
	}

	interface Props {
		heartbeats: HeartbeatRow[];
	}

	let { heartbeats }: Props = $props();

	const TIMEOUT_GAP = 120;

	function computeTrackedTime(hbs: HeartbeatRow[]): number {
		if (hbs.length === 0) return 0;
		const sorted = [...hbs].sort((a, b) => a.time - b.time);
		let total = 0;
		for (let i = 1; i < sorted.length; i++) {
			const gap = (sorted[i].time - sorted[i - 1].time) / 1000;
			if (gap <= TIMEOUT_GAP) total += gap;
		}
		return total;
	}

	function formatDuration(seconds: number): string {
		if (seconds < 60) return `${Math.round(seconds)}s`;
		const m = Math.floor(seconds / 60);
		if (m < 60) return `${m}m`;
		const h = Math.floor(m / 60);
		const rm = m % 60;
		return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
	}

	function formatPct(value: number, total: number): string {
		if (total === 0) return '0%';
		return `${((value / total) * 100).toFixed(1)}%`;
	}

	const COLORS = [
		'#D47E2F', '#0085B5', '#007706', '#BF0000', '#8B5CF6',
		'#D946EF', '#0EA5E9', '#F59E0B', '#10B981', '#EC4899',
		'#6366F1', '#14B8A6',
	];

	interface AggEntry {
		name: string;
		seconds: number;
	}

	function aggregate(field: keyof HeartbeatRow): AggEntry[] {
		const groups = new Map<string, HeartbeatRow[]>();
		for (const hb of heartbeats) {
			const key = String(hb[field]) || '(unknown)';
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(hb);
		}
		const entries: AggEntry[] = [];
		for (const [name, hbs] of groups) {
			entries.push({ name, seconds: computeTrackedTime(hbs) });
		}
		return entries.sort((a, b) => b.seconds - a.seconds);
	}

	const editorData = $derived(aggregate('editor'));
	const userAgentData = $derived(aggregate('user_agent'));
	const ipData = $derived(aggregate('ip'));
	const machineData = $derived(aggregate('machine'));

	const totalSeconds = $derived(computeTrackedTime(heartbeats));

	let editorChartEl = $state<HTMLDivElement | undefined>(undefined);
	let uaChartEl = $state<HTMLDivElement | undefined>(undefined);
	let editorChart: EChartsType | undefined;
	let uaChart: EChartsType | undefined;

	function shortName(name: string): string {
		const parts = name.trim().split(/\s+/);
		return parts[parts.length - 1];
	}

	function buildPieOption(data: AggEntry[], title: string) {
		const nameMap = new Map(data.map((d) => [shortName(d.name), d.name]));
		return {
			title: {
				text: title,
				left: 'center',
				textStyle: { fontSize: 13, fontWeight: 600, fontFamily: 'Inter', color: '#000' },
			},
			tooltip: {
				trigger: 'item' as const,
				appendToBody: true,
				formatter: (params: { name: string; value: number; percent: number }) => {
					const full = nameMap.get(params.name) ?? params.name;
					return `${full}<br/>${formatDuration(params.value)} (${params.percent}%)`;
				},
			},
			legend: {
				orient: 'vertical' as const,
				right: 10,
				top: 'middle' as const,
				textStyle: { fontSize: 11, fontFamily: 'Inter', color: '#737373' },
			},
			series: [
				{
					type: 'pie',
					radius: ['40%', '70%'],
					center: ['35%', '55%'],
					avoidLabelOverlap: true,
					itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
					label: {
						show: true,
						position: 'inside',
						formatter: (params: { percent: number }) => `${Math.round(params.percent)}%`,
						fontSize: 9,
						fontWeight: 600,
						fontFamily: 'Inter',
						color: '#fff',
					},
					emphasis: {
						label: { show: true, fontSize: 12, fontWeight: 600, fontFamily: 'Inter', color: '#fff' },
					},
					data: data.map((d, i) => ({
						value: d.seconds,
						name: shortName(d.name),
						itemStyle: { color: COLORS[i % COLORS.length] },
					})),
				},
			],
		};
	}

	$effect(() => {
		if (!editorChartEl) return;
		const data = editorData;

		(async () => {
			const echarts = await import('echarts');
			if (editorChart) {
				editorChart.setOption(buildPieOption(data, 'Editors'));
				return;
			}
			editorChart = echarts.init(editorChartEl, undefined, { renderer: 'canvas' });
			editorChart.setOption(buildPieOption(data, 'Editors'));
		})();
	});

	$effect(() => {
		if (!uaChartEl) return;
		const data = userAgentData;

		(async () => {
			const echarts = await import('echarts');
			if (uaChart) {
				uaChart.setOption(buildPieOption(data, 'User Agents'));
				return;
			}
			uaChart = echarts.init(uaChartEl, undefined, { renderer: 'canvas' });
			uaChart.setOption(buildPieOption(data, 'User Agents'));
		})();
	});

	$effect(() => {
		const onResize = () => {
			editorChart?.resize();
			uaChart?.resize();
		};
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});

	$effect(() => {
		return () => {
			editorChart?.dispose();
			uaChart?.dispose();
		};
	});
</script>

<div class="flex flex-col gap-5 px-6 py-5 overflow-y-auto">
	<div class="grid grid-cols-2 gap-4">
		<div class="border border-border-card rounded-section bg-surface/40">
			<div bind:this={editorChartEl} class="w-full h-[220px]"></div>
		</div>
		<div class="border border-border-card rounded-section bg-surface/40">
			<div bind:this={uaChartEl} class="w-full h-[220px]"></div>
		</div>
	</div>

	<div class="grid grid-cols-2 gap-4">
		<section>
			<h3 class="text-[13px] font-bold text-text-primary tracking-[-0.39px] mb-2">IPs</h3>
			<div class="border border-border-card rounded-section overflow-hidden">
				<table class="w-full text-[12px]">
					<thead>
						<tr class="bg-surface text-text-secondary">
							<th class="text-left font-medium px-3 py-1.5">IP</th>
							<th class="text-right font-medium px-3 py-1.5">Time</th>
							<th class="text-right font-medium px-3 py-1.5">%</th>
						</tr>
					</thead>
					<tbody>
						{#each ipData as row, i (row.name)}
							<tr class="{i % 2 === 0 ? 'bg-page' : 'bg-surface/30'} hover:bg-accent-bg/50 transition-colors">
								<td class="px-3 py-1.5 font-mono text-text-primary">{row.name}</td>
								<td class="px-3 py-1.5 text-right text-text-secondary">{formatDuration(row.seconds)}</td>
								<td class="px-3 py-1.5 text-right text-text-tertiary">{formatPct(row.seconds, totalSeconds)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section>
			<h3 class="text-[13px] font-bold text-text-primary tracking-[-0.39px] mb-2">Machines</h3>
			<div class="border border-border-card rounded-section overflow-hidden">
				<table class="w-full text-[12px]">
					<thead>
						<tr class="bg-surface text-text-secondary">
							<th class="text-left font-medium px-3 py-1.5">Machine</th>
							<th class="text-right font-medium px-3 py-1.5">Time</th>
							<th class="text-right font-medium px-3 py-1.5">%</th>
						</tr>
					</thead>
					<tbody>
						{#each machineData as row, i (row.name)}
							<tr class="{i % 2 === 0 ? 'bg-page' : 'bg-surface/30'} hover:bg-accent-bg/50 transition-colors">
								<td class="px-3 py-1.5 font-mono text-text-primary truncate max-w-[200px]">{row.name}</td>
								<td class="px-3 py-1.5 text-right text-text-secondary">{formatDuration(row.seconds)}</td>
								<td class="px-3 py-1.5 text-right text-text-tertiary">{formatPct(row.seconds, totalSeconds)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	</div>
</div>
