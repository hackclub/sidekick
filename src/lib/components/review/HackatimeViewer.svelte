<script lang="ts">
	import { Activity, LoaderCircle, FolderCode } from 'lucide-svelte';
	import HeartbeatFrequencyBar from './HeartbeatFrequencyBar.svelte';
	import HeartbeatScatter from './HeartbeatScatter.svelte';
	import HeartbeatTable from './HeartbeatTable.svelte';

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

	interface DayActivity {
		date: string;
		count: number;
		totalSeconds: number;
		lineNoPath: string;
		cursorPath: string;
	}

	interface Props {
		hackatimeUser: string;
		hackatimeProjectKeys: string[];
		programId: string;
		defaultDate?: string;
		class?: string;
	}

	let { hackatimeUser, hackatimeProjectKeys, programId, defaultDate, class: className = '' }: Props = $props();

	let currentDate = $state(defaultDate || new Date().toISOString().split('T')[0]);
	let heartbeats = $state<HeartbeatRow[] | null>(null);
	let loading = $state(false);
	let hasSelectedInitialDay = false;
	let error = $state<string | null>(null);

	let focusedTimestamp = $state<number | undefined>(undefined);
	let animationKey = $state(0);
	let hoveredTimeRange = $state<[number, number] | null>(null);
	let visibleRange = $state<[number, number] | null>(null);

	let activityCache = $state<Record<string, DayActivity[]>>({});
	let overviewLoading = $state(false);
	let showLineNo = $state(true);
	let showCursor = $state(true);
	let scrollContainer = $state<HTMLElement | null>(null);

	function monthKey(dateStr: string): string {
		return dateStr.slice(0, 7);
	}

	function formatDateLabel(dateStr: string): string {
		const d = new Date(dateStr + 'T12:00:00Z');
		return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
	}

	function formatDuration(seconds: number): string {
		if (seconds < 60)
			return `${Math.round(seconds)}s`;

		const m = Math.floor(seconds / 60);
		if (m < 60)
			return `${m}m`;

		const h = Math.floor(m / 60);
		const rm = m % 60;
		return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
	}

	function shiftMonthKey(ym: string, delta: number): string {
		const [y, m] = ym.split('-').map(Number);
		const d = new Date(Date.UTC(y, m - 1 + delta, 1));
		return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
	}

	function monthsBetween(startYm: string, endYm: string): string[] {
		const months: string[] = [];
		let cur = startYm;

		while (cur <= endYm) {
			months.push(cur);
			cur = shiftMonthKey(cur, 1);
		}

		return months;
	}

	async function fetchActivity(ym: string): Promise<DayActivity[]> {
		if (activityCache[ym])
			return activityCache[ym];

		const [y, m] = ym.split('-');

		const params = new URLSearchParams({
			userId: hackatimeUser,
			projects: hackatimeProjectKeys.join(','),
			year: y,
			month: m
		});

		try {
			const res = await fetch(`/api/programs/${programId}/hackatime/activity?${params}`);
			if (!res.ok)
				return [];
			const data = await res.json();
			activityCache[ym] = data.days;
			return data.days;
		}
		catch {
			return [];
		}
	}

	async function loadOverview() {
		overviewLoading = true;
		try {
			const params = new URLSearchParams({
				userId: hackatimeUser,
				projects: hackatimeProjectKeys.join(',')
			});

			let months: string[];
			try {
				const res = await fetch(`/api/programs/${programId}/hackatime/date-range?${params}`);
				const data = res.ok ? await res.json() : null;

				if (data?.range) {
					const startYm = monthKey(data.range.firstDate);
					const endYm = monthKey(data.range.lastDate);
					months = monthsBetween(startYm, endYm);
				}
				else {
					months = fallbackMonths();
				}
			}
			catch {
				months = fallbackMonths();
			}

			await Promise.all(months.map((ym) => fetchActivity(ym)));

			if (!hasSelectedInitialDay) {
				hasSelectedInitialDay = true;
				const days: DayActivity[] = [];

				for (const entries of Object.values(activityCache)) {
					for (const d of entries) {
						if (d.count > 0) {
							days.push(d);
						}
					}
				}

				if (days.length > 0) {
					days.sort((a, b) => b.date.localeCompare(a.date));
					currentDate = days[0].date;
				}
			}

			requestAnimationFrame(() => scrollToSelected());
		}
		finally {
			overviewLoading = false;
		}
	}

	function fallbackMonths(): string[] {
		const base = currentDate || new Date().toISOString().split('T')[0];
		const ym = monthKey(base);
		return [shiftMonthKey(ym, -2), shiftMonthKey(ym, -1), ym, shiftMonthKey(ym, 1)];
	}

	$effect(() => {
		void hackatimeUser;
		void hackatimeProjectKeys;
		if (!hackatimeUser || hackatimeProjectKeys.length === 0) 
			return;

		loadOverview();
	});

	const allActiveDays = $derived.by(() => {
		const days: DayActivity[] = [];
		for (const entries of Object.values(activityCache)) {
			for (const d of entries) {
				if (d.count > 0) {
					days.push(d);
				}
			}
		}

		return days.sort((a, b) => b.date.localeCompare(a.date));
	});

	const monthGroups = $derived.by(() => {
		const groups: { ym: string; label: string; startIdx: number; days: DayActivity[] }[] = [];
		let idx = 0;
		let curYm = '';

		for (const day of allActiveDays) {
			const ym = monthKey(day.date);
			if (ym !== curYm) {
				const [y, m] = ym.split('-').map(Number);
				const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
				groups.push({ ym, label, startIdx: idx, days: [] });
				curYm = ym;
			}

			groups[groups.length - 1].days.push(day);
			idx++;
		}

		return groups;
	});

	function selectDay(date: string) {
		currentDate = date;
	}

	function scrollToSelected() {
		if (!scrollContainer)
			return;

		const el = scrollContainer.querySelector('[data-selected="true"]') as HTMLElement | null;
		if (!el)
			return;

		const left = el.offsetLeft - scrollContainer.offsetWidth / 2 + el.offsetWidth / 2;
		scrollContainer.scrollTo({ left, behavior: 'smooth' });
	}

	$effect(() => {
		const date = currentDate;
		const user = hackatimeUser;
		const keys = hackatimeProjectKeys;
		if (!user || keys.length === 0)
			return;

		loading = true;
		error = null;

		const params = new URLSearchParams({ userId: user, projects: keys.join(','), date });

		fetch(`/api/programs/${programId}/hackatime/heartbeats?${params}`)
			.then(async (res) => {
				if (!res.ok)
					throw new Error(`HTTP ${res.status}`);

				const data = await res.json();
				if (date !== currentDate)
					return;

				heartbeats = data.heartbeats;
			})
			.catch((e) => {
				if (date !== currentDate)
					return;

				heartbeats = null;
				error = e.message;
			})
			.finally(() => {
				if (date !== currentDate)
					return;

				loading = false;
			});
	});

	const codingHeartbeats = $derived(
		heartbeats?.filter((hb) => hb.editor !== 'lapse' && !hb.user_agent.toLowerCase().includes('lapse')) ?? null
	);

	function handleFocusChange(timestamp: number) {
		focusedTimestamp = timestamp;
		animationKey++;
	}
</script>

<div class="border border-border-card rounded-card shadow-card overflow-hidden flex flex-col {className}">
	<div class="flex items-center px-6 py-4 border-b border-border-card">
		<div class="flex items-center gap-2.5">
			<Activity size={18} class="text-text-secondary" />
			<div class="flex flex-col gap-0.5">
				<h2 class="font-bold text-[15px] text-text-primary tracking-[-0.45px]">Hackatime Details</h2>
				<p class="text-[12px] text-text-secondary tracking-[-0.24px] flex items-center gap-1.5">
					{#if codingHeartbeats}
						{codingHeartbeats.length} heartbeat{codingHeartbeats.length === 1 ? '' : 's'}
					{:else}
						No data
					{/if}
					{#if loading}
						<LoaderCircle size={12} class="animate-spin text-text-tertiary" />
					{/if}
				</p>
			</div>
		</div>

	</div>

	<div class="flex items-center justify-between px-6 py-2.5 border-b border-border-card bg-surface/30">
		<div class="flex items-center gap-2">
			<FolderCode size={14} class="text-text-tertiary shrink-0" />
			<span class="text-[12px] text-text-tertiary shrink-0">Projects:</span>
			<div class="flex flex-wrap gap-1.5">
				{#each hackatimeProjectKeys as key (key)}
					<span class="text-[12px] font-medium text-text-primary bg-page border border-border-card rounded-tag px-2 py-0.5">{key}</span>
				{/each}
			</div>
		</div>
		<div class="flex items-center gap-1.5 shrink-0 ml-4">
			<button
				class="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-tag cursor-pointer transition-colors {showLineNo ? 'bg-page border border-border-card font-medium' : 'text-text-tertiary hover:text-text-secondary'}"
				onclick={() => (showLineNo = !showLineNo)}
			>
				<span class="inline-block size-1.5 rounded-full" style="background: #06b6d4"></span>
				Line
			</button>
			<button
				class="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-tag cursor-pointer transition-colors {showCursor ? 'bg-page border border-border-card font-medium' : 'text-text-tertiary hover:text-text-secondary'}"
				onclick={() => (showCursor = !showCursor)}
			>
				<span class="inline-block size-1.5 rounded-full" style="background: #e33062"></span>
				Cursor
			</button>
		</div>
	</div>

	<div class="border-b border-border-card bg-surface/20 relative">
		{#if allActiveDays.length > 0}
			<div bind:this={scrollContainer} class="overflow-x-auto scrollbar-thin">
				<div class="flex px-4 py-3 gap-0" style="min-width: max-content;">
					{#each monthGroups as group (group.ym)}
						<div class="flex flex-col shrink-0">
							<div class="text-[10px] font-bold text-text-tertiary uppercase tracking-wide px-1 pb-1.5 sticky left-0">
								{group.label}
							</div>
							<div class="flex gap-1.5">
								{#each group.days as day (day.date)}
									<button
										class="flex flex-col gap-0.5 rounded-section p-1 cursor-pointer transition-all border w-[140px] shrink-0
											{day.date === currentDate
												? 'border-accent bg-accent-bg ring-1 ring-accent'
												: 'border-transparent hover:border-border-card hover:bg-surface/50'}"
										data-selected={day.date === currentDate}
										onclick={() => selectDay(day.date)}
									>
										<svg viewBox="0 0 400 100" class="w-full aspect-[4/1] bg-surface rounded-tag">
											{#if showLineNo}
												<path d={day.lineNoPath} stroke="#06b6d4" stroke-width="10" stroke-linecap="round" fill="none" />
											{/if}
											{#if showCursor}
												<path d={day.cursorPath} stroke="#e33062" stroke-width="10" stroke-linecap="round" fill="none" />
											{/if}
										</svg>
										<div class="flex items-center justify-between px-0.5">
											<span class="text-[10px] text-text-secondary">
												{new Date(day.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
											</span>
											<span class="text-[10px] font-mono text-text-tertiary">
												{formatDuration(day.totalSeconds)}
											</span>
										</div>
									</button>
								{/each}
							</div>
						</div>
						<div class="w-3 shrink-0"></div>
					{/each}
				</div>
			</div>
		{:else if overviewLoading}
			<div class="flex gap-1.5 px-4 py-3">
				<!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
				{#each Array(6) as _, i (i)}
					<div class="animate-pulse w-[140px] shrink-0">
						<div class="w-full aspect-[4/1] bg-surface rounded-tag"></div>
						<div class="flex justify-between mt-1 px-0.5">
							<div class="h-2.5 w-10 bg-surface rounded"></div>
							<div class="h-2.5 w-6 bg-surface rounded"></div>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="px-6 py-4 text-[12px] text-text-tertiary text-center">
				No activity found for these projects.
			</div>
		{/if}
	</div>

	{#if error}
		<div class="px-6 py-8">
			<div class="border border-check-fail/30 bg-check-fail/5 rounded-section px-4 py-3 text-sm text-check-fail">
				Failed to load heartbeats: {error}
			</div>
		</div>
	{:else if codingHeartbeats && codingHeartbeats.length > 0}
		<HeartbeatFrequencyBar
			heartbeats={codingHeartbeats}
			{visibleRange}
			onhover={(range) => (hoveredTimeRange = range)}
			onclick={(timestamp) => handleFocusChange(timestamp)}
		/>
		
		<HeartbeatScatter
			heartbeats={codingHeartbeats}
			{hoveredTimeRange}
			onfocuschange={(timestamp) => handleFocusChange(timestamp)}
		/>

		<div class="flex flex-col min-h-[300px] max-h-[500px] border-t border-border-card">
			<HeartbeatTable
				heartbeats={codingHeartbeats}
				{focusedTimestamp}
				{animationKey}
				onrangechange={(range) => (visibleRange = range)}
			/>
		</div>
	{:else if codingHeartbeats}
		<div class="flex items-center justify-center py-16 text-sm text-text-tertiary">
			No heartbeats found for {formatDateLabel(currentDate)}.
		</div>
	{:else if loading}
		<div class="flex flex-col items-center justify-center py-20 gap-3 text-text-tertiary">
			<LoaderCircle size={24} class="animate-spin" />
			<span class="text-sm">Loading heartbeats...</span>
		</div>
	{/if}
</div>
