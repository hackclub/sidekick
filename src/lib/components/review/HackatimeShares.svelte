<script lang="ts" module>
	export type ShareField = 'language' | 'editor' | 'category';
	/** Per field, each value's share (0–1) of coding time. */
	export type Shares = Record<ShareField, Record<string, number>>;
</script>

<script lang="ts">
	interface Props {
		/** Label for the selected day, e.g. "Fri, Jan 31". */
		dayLabel: string | null;
		day: Shares | null;
		allTime: Shares | null;
	}

	let { dayLabel, day, allTime }: Props = $props();

	const SECTIONS: { field: ShareField; title: string }[] = [
		{ field: 'language', title: 'Languages' },
		{ field: 'editor', title: 'Editors' },
		{ field: 'category', title: 'Categories' }
	];

	// Same palette as HackatimeBreakdown's pies.
	const COLORS = ['#D47E2F', '#0085B5', '#007706', '#BF0000', '#8B5CF6', '#D946EF'];
	const OTHER_COLOR = '#A3A3A3';
	const OTHER = 'Other';

	const RADIUS = 30;
	const STROKE = 12;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

	interface Row {
		name: string;
		color: string;
		day: number;
		allTime: number;
	}

	// Top values by all-time share keep their own colour in both donuts; the
	// rest fold into "Other" so the colours line up across day and all time.
	function rows(field: ShareField): Row[] {
		const d = day?.[field] ?? {};
		const a = allTime?.[field] ?? {};
		const names = [...new Set([...Object.keys(a), ...Object.keys(d)])].sort(
			(x, y) => (a[y] ?? 0) - (a[x] ?? 0) || (d[y] ?? 0) - (d[x] ?? 0)
		);

		const named = names.slice(0, COLORS.length);
		const out: Row[] = named.map((name, i) => ({
			name,
			color: COLORS[i],
			day: d[name] ?? 0,
			allTime: a[name] ?? 0
		}));

		const rest = names.slice(COLORS.length);
		if (rest.length > 0) {
			out.push({
				name: OTHER,
				color: OTHER_COLOR,
				day: rest.reduce((sum, n) => sum + (d[n] ?? 0), 0),
				allTime: rest.reduce((sum, n) => sum + (a[n] ?? 0), 0)
			});
		}
		return out;
	}

	function segments(values: { value: number; color: string }[]) {
		const total = values.reduce((sum, v) => sum + v.value, 0);
		let offset = 0;
		const out: { length: number; offset: number; color: string }[] = [];
		for (const v of values) {
			if (v.value <= 0 || total === 0) continue;
			const length = (v.value / total) * CIRCUMFERENCE;
			out.push({ length, offset, color: v.color });
			offset += length;
		}
		return out;
	}

	function pct(value: number): string {
		if (value <= 0) return '—';
		return value < 0.01 ? '<1%' : `${Math.round(value * 100)}%`;
	}
</script>

{#snippet donut(values: { value: number; color: string }[], caption: string)}
	{@const segs = segments(values)}
	<div class="flex flex-col items-center gap-1 min-w-0">
		<svg viewBox="0 0 80 80" class="w-[76px] h-[76px] -rotate-90">
			<circle cx="40" cy="40" r={RADIUS} fill="none" stroke="var(--color-surface, #f4f4f4)" stroke-width={STROKE} />
			{#each segs as seg, i (i)}
				<circle
					cx="40"
					cy="40"
					r={RADIUS}
					fill="none"
					stroke={seg.color}
					stroke-width={STROKE}
					stroke-dasharray="{Math.max(seg.length - (segs.length > 1 ? 1 : 0), 0.5)} {CIRCUMFERENCE}"
					stroke-dashoffset={-seg.offset}
				/>
			{/each}
		</svg>
		<span class="text-[10px] text-text-tertiary truncate max-w-full">{caption}</span>
	</div>
{/snippet}

<div class="flex flex-col gap-5 px-5 py-4">
	{#each SECTIONS as section (section.field)}
		{@const sectionRows = rows(section.field)}
		<section class="flex flex-col gap-2">
			<h3 class="text-[10px] font-bold text-text-tertiary uppercase tracking-wide">
				{section.title}
			</h3>
			{#if sectionRows.length === 0}
				<p class="text-[12px] text-text-tertiary">No data.</p>
			{:else}
				<div class="grid grid-cols-2 gap-2">
					{@render donut(
						sectionRows.map((r) => ({ value: r.day, color: r.color })),
						dayLabel ?? 'Selected day'
					)}
					{@render donut(
						sectionRows.map((r) => ({ value: r.allTime, color: r.color })),
						'All time'
					)}
				</div>
				<table class="w-full text-[11px]">
					<thead>
						<tr class="text-text-tertiary">
							<th class="text-left font-normal pb-1"></th>
							<th class="text-right font-normal pb-1 w-12">Day</th>
							<th class="text-right font-normal pb-1 w-14">All time</th>
						</tr>
					</thead>
					<tbody>
						{#each sectionRows as row (row.name)}
							<tr>
								<td class="py-0.5 max-w-0">
									<span class="flex items-center gap-1.5 min-w-0">
										<span class="w-2 h-2 rounded-full shrink-0" style="background-color: {row.color}"></span>
										<span class="truncate text-text-primary" title={row.name}>{row.name}</span>
									</span>
								</td>
								<td class="py-0.5 text-right font-mono text-text-secondary">{pct(row.day)}</td>
								<td class="py-0.5 text-right font-mono text-text-secondary">{pct(row.allTime)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>
	{/each}
</div>
