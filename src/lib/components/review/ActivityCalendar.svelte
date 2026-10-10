<script lang="ts">
	interface Props {
		/** Active days only, as YYYY-MM-DD in the author's timezone. */
		days: { date: string; totalSeconds: number }[];
		/** YYYY-MM-DD; days before it are drawn faded, like the day cards. */
		cutoffDate?: string;
		formatTime: (seconds: number) => string;
		/** YYYY-MM-DD of the selected day. */
		selected?: string;
		onselect?: (date: string) => void;
	}

	let { days, cutoffDate, formatTime, selected, onselect }: Props = $props();

	const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

	const byDate = $derived(new Map(days.map((d) => [d.date, d.totalSeconds])));

	function shiftMonth(ym: string, delta: number): string {
		const [y, m] = ym.split('-').map(Number);
		const d = new Date(Date.UTC(y, m - 1 + delta, 1));
		return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
	}

	// Every month from the newest active one back to the oldest, empty months
	// included so gaps in activity show. Newest first, matching the day cards.
	const months = $derived.by(() => {
		if (days.length === 0) return [];
		const sorted = days.map((d) => d.date.slice(0, 7)).sort();
		const out: string[] = [];
		for (let ym = sorted[sorted.length - 1]; ym >= sorted[0]; ym = shiftMonth(ym, -1)) out.push(ym);
		return out;
	});

	function monthLabel(ym: string): string {
		const [y, m] = ym.split('-').map(Number);
		return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		});
	}

	// Leading nulls pad the first week so the 1st lands on its weekday (Monday-first).
	function monthCells(ym: string): (string | null)[] {
		const [y, m] = ym.split('-').map(Number);
		const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
		const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
		return [
			...Array<null>(lead).fill(null),
			...Array.from({ length: count }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)
		];
	}

	function intensityClass(seconds: number): string {
		if (seconds >= 4 * 3600) return 'bg-accent text-white';
		if (seconds >= 2 * 3600) return 'bg-accent/70 text-white';
		if (seconds >= 3600) return 'bg-accent/45 text-text-primary';
		return 'bg-accent/20 text-text-primary';
	}

	// Cells are too narrow for "~7h 15m"; the tooltip carries the full form.
	function cellTime(seconds: number): string {
		const m = Math.round(seconds / 60);
		if (m < 15) return '<15m';
		if (m < 60) return `${m}m`;
		const h = Math.floor(m / 60);
		const rm = m % 60;
		return rm > 0 ? `${h}h${String(rm).padStart(2, '0')}` : `${h}h`;
	}

	function dayTitle(date: string, seconds: number): string {
		const label = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
		const cutoff = cutoffDate && date < cutoffDate ? " — before the cutoff, doesn't count" : '';
		return `${label} · ${formatTime(seconds)}${cutoff}`;
	}
</script>

<div class="flex flex-wrap gap-x-8 gap-y-6">
	{#each months as ym (ym)}
		<div class="flex flex-col gap-1.5">
			<div class="text-[10px] font-bold text-text-tertiary uppercase tracking-wide">
				{monthLabel(ym)}
			</div>
			<div class="grid grid-cols-7 gap-1">
				{#each WEEKDAYS as wd, i (i)}
					<div class="w-11 text-center text-[10px] text-text-tertiary">{wd}</div>
				{/each}
				{#each monthCells(ym) as date, i (date ?? `pad-${i}`)}
					{#if date === null}
						<div class="w-11 h-11"></div>
					{:else}
						{@const seconds = byDate.get(date)}
						{#if seconds === undefined}
							<div
								class="w-11 h-11 rounded-tag p-1 tabular-nums bg-surface/60 text-text-tertiary
									{cutoffDate && date < cutoffDate ? 'opacity-45' : ''}"
							>
								<span class="text-[10px] leading-none">{Number(date.slice(8))}</span>
							</div>
						{:else}
							<button
								class="w-11 h-11 rounded-tag flex flex-col justify-between p-1 tabular-nums cursor-pointer text-left
									{intensityClass(seconds)}
									{date === selected
									? 'ring-2 ring-offset-1 ring-text-primary'
									: 'hover:ring-1 hover:ring-text-primary/40'}
									{cutoffDate && date < cutoffDate && date !== selected ? 'opacity-45' : ''}"
								title={dayTitle(date, seconds)}
								onclick={() => onselect?.(date)}
							>
								<span class="text-[10px] leading-none">{Number(date.slice(8))}</span>
								<span class="text-[9px] font-mono leading-none self-end whitespace-nowrap"
									>{cellTime(seconds)}</span
								>
							</button>
						{/if}
					{/if}
				{/each}
			</div>
		</div>
	{/each}
</div>
