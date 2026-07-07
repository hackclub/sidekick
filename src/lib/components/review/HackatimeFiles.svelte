<script lang="ts">
	interface HeartbeatRow {
		time: number;
		entity: string;
		language: string;
		project: string;
	}

	interface Props {
		heartbeats: HeartbeatRow[];
	}

	let { heartbeats }: Props = $props();

	const TIMEOUT_GAP = 120;

	// Same heartbeat-gap model Hackatime uses: time between consecutive heartbeats
	// counts toward the earlier one, capped at TIMEOUT_GAP seconds.
	function computeTrackedTime(hbs: HeartbeatRow[]): number {
		if (hbs.length === 0) return 0;
		const sorted = [...hbs].sort((a, b) => a.time - b.time);
		let total = 0;
		for (let i = 1; i < sorted.length; i++) {
			const gap = (sorted[i].time - sorted[i - 1].time) / 1000;
			total += Math.min(gap, TIMEOUT_GAP);
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

	interface FileEntry {
		entity: string;
		displayName: string;
		language: string;
		heartbeatCount: number;
		seconds: number;
	}

	// Entities are usually absolute paths — keep the tail, which is what
	// distinguishes files, and put the full path in the tooltip.
	function shortenEntity(entity: string): string {
		const parts = entity.split(/[\\/]/).filter(Boolean);
		if (parts.length <= 3) return entity;
		return `…/${parts.slice(-3).join('/')}`;
	}

	const fileData = $derived.by<FileEntry[]>(() => {
		const groups = new Map<string, HeartbeatRow[]>();
		for (const hb of heartbeats) {
			const key = hb.entity || '(unknown)';
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(hb);
		}
		const entries: FileEntry[] = [];
		for (const [entity, hbs] of groups) {
			const langCounts = new Map<string, number>();
			for (const hb of hbs) {
				const lang = hb.language || '';
				langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
			}
			const language = [...langCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
			entries.push({
				entity,
				displayName: shortenEntity(entity),
				language,
				heartbeatCount: hbs.length,
				seconds: computeTrackedTime(hbs)
			});
		}
		return entries.sort((a, b) => b.seconds - a.seconds);
	});

	const totalSeconds = $derived(computeTrackedTime(heartbeats));
</script>

<div class="px-6 py-5">
	<div class="border border-border-card rounded-section overflow-hidden">
		<div class="max-h-[400px] overflow-y-auto scrollbar-thin">
			<table class="w-full text-[12px]">
				<thead class="sticky top-0 z-10">
					<tr class="bg-surface text-text-secondary">
						<th class="text-left font-medium px-3 py-1.5">File</th>
						<th class="text-left font-medium px-3 py-1.5">Language</th>
						<th class="text-right font-medium px-3 py-1.5">Heartbeats</th>
						<th class="text-right font-medium px-3 py-1.5">Time</th>
						<th class="text-right font-medium px-3 py-1.5">%</th>
					</tr>
				</thead>
				<tbody>
					{#each fileData as row, i (row.entity)}
						<tr
							class="{i % 2 === 0
								? 'bg-page'
								: 'bg-surface/30'} hover:bg-accent-bg/50 transition-colors"
						>
							<td
								class="px-3 py-1.5 font-mono text-text-primary max-w-[360px] truncate"
								title={row.entity}>{row.displayName}</td
							>
							<td class="px-3 py-1.5 text-text-secondary">{row.language}</td>
							<td class="px-3 py-1.5 text-right text-text-tertiary">{row.heartbeatCount}</td>
							<td class="px-3 py-1.5 text-right text-text-secondary"
								>{formatDuration(row.seconds)}</td
							>
							<td class="px-3 py-1.5 text-right text-text-tertiary"
								>{formatPct(row.seconds, totalSeconds)}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div
			class="flex items-center justify-between px-3 py-1.5 bg-surface border-t border-border-card text-[12px]"
		>
			<span class="text-text-secondary font-medium"
				>{fileData.length} file{fileData.length === 1 ? '' : 's'}</span
			>
			<span class="text-text-secondary"
				>Total: <span class="font-medium text-text-primary">{formatDuration(totalSeconds)}</span
				></span
			>
		</div>
	</div>
</div>
