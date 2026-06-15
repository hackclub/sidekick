<script lang="ts">
	import { createLogger } from '$lib/logger.js';
	import { isQuirkHeartbeat } from '$lib/heartbeat-quirks.js';
	import { Activity, LoaderCircle, FolderCode, ExternalLink, Check } from 'lucide-svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
	import HeartbeatFrequencyBar from './HeartbeatFrequencyBar.svelte';
	import HeartbeatScatter from './HeartbeatScatter.svelte';
	import HeartbeatTable from './HeartbeatTable.svelte';

	const log = createLogger('HackatimeViewer');

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

	interface ProjectBreakdown {
		name: string;
		totalSeconds: number;
	}

	interface Props {
		hackatimeUser: string;
		hackatimeProjectKeys: string[];
		programId: string;
		defaultDate?: string;
		projectBreakdown?: ProjectBreakdown[];
		class?: string;
	}

	let { hackatimeUser, hackatimeProjectKeys, programId, defaultDate, projectBreakdown = [], class: className = '' }: Props = $props();

	const MAX_VISIBLE_PROJECTS = 4;

	const sortedProjects = $derived.by(() => {
		const timeMap = new Map(projectBreakdown.map((p) => [p.name, p.totalSeconds]));
		return [...hackatimeProjectKeys]
			.map((key) => ({ name: key, totalSeconds: timeMap.get(key) ?? 0 }))
			.sort((a, b) => b.totalSeconds - a.totalSeconds);
	});

	const visibleProjects = $derived(sortedProjects.slice(0, MAX_VISIBLE_PROJECTS));
	const overflowProjects = $derived(sortedProjects.slice(MAX_VISIBLE_PROJECTS));

	function formatHours(seconds: number): string {
		const h = seconds / 3600;
		if (h < 0.1) return '<0.1h';
		return h < 10 ? `${h.toFixed(1)}h` : `${Math.round(h)}h`;
	}

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
	let overflowTooltip = $state<{ x: number; y: number } | null>(null);
	let scrollContainer = $state<HTMLElement | null>(null);
	let joeCopied = $state(false);
	let showQuirks = $state(false);

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
		if (activityCache[ym]) {
			log.trace('Activity cache hit', { ym });
			return activityCache[ym];
		}

		const [y, m] = ym.split('-');

		const params = new URLSearchParams({
			userId: hackatimeUser,
			projects: hackatimeProjectKeys.join(','),
			year: y,
			month: m
		});

		log.debug('Fetching activity data', { ym });
		const t = log.time(`fetchActivity:${ym}`);

		try {
			const res = await fetch(`/api/programs/${programId}/hackatime/activity?${params}`);
			t.end('status', res.status);
			if (!res.ok) {
				log.warn('Activity fetch returned non-ok', { ym, status: res.status });
				return [];
			}
			const data = await res.json();
			activityCache[ym] = data.days;
			log.debug('Activity data fetched', { ym, dayCount: data.days?.length ?? 0 });
			return data.days;
		}
		catch (e) {
			log.error('Failed to fetch activity data', { ym }, e);
			return [];
		}
	}

	async function loadOverview() {
		overviewLoading = true;
		log.info('Loading hackatime overview', { hackatimeUser, projectCount: hackatimeProjectKeys.length });
		const t = log.time('loadOverview');
		try {
			const params = new URLSearchParams({
				userId: hackatimeUser,
				projects: hackatimeProjectKeys.join(',')
			});

			let months: string[];
			try {
				log.debug('Fetching date range');
				const res = await fetch(`/api/programs/${programId}/hackatime/date-range?${params}`);
				log.debug('Date range response', { status: res.status });
				const data = res.ok ? await res.json() : null;

				if (data?.range) {
					const startYm = monthKey(data.range.firstDate);
					const endYm = monthKey(data.range.lastDate);
					months = monthsBetween(startYm, endYm);
					log.debug('Date range resolved', { startYm, endYm, monthCount: months.length });
				}
				else {
					log.debug('No date range returned, using fallback months');
					months = fallbackMonths();
				}
			}
			catch (e) {
				log.warn('Date range fetch failed, using fallback months', e);
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
					log.debug('Auto-selected initial day', { date: currentDate });
				}
			}

			t.end('months loaded', months.length);
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
		log.debug('Day selected', { date });
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

		log.debug('Fetching heartbeats', { date, user });
		const t = log.time(`fetchHeartbeats:${date}`);
		const params = new URLSearchParams({ userId: user, projects: keys.join(','), date });

		fetch(`/api/programs/${programId}/hackatime/heartbeats?${params}`)
			.then(async (res) => {
				if (!res.ok)
					throw new Error(`HTTP ${res.status}`);

				const data = await res.json();
				if (date !== currentDate) {
					log.debug('Heartbeat response discarded (date changed)', { requestedDate: date, currentDate });
					return;
				}

				heartbeats = data.heartbeats;
				t.end('heartbeats', data.heartbeats?.length ?? 0);
			})
			.catch((e) => {
				if (date !== currentDate) {
					log.debug('Heartbeat error discarded (date changed)', { requestedDate: date, currentDate });
					return;
				}

				heartbeats = null;
				error = e.message;
				log.error('Failed to fetch heartbeats', { date }, e);
			})
			.finally(() => {
				if (date !== currentDate)
					return;

				loading = false;
			});
	});

	const codingHeartbeats = $derived.by(() => {
		if (!heartbeats) return null;
		const noLapse = heartbeats.filter((hb) => hb.editor !== 'lapse' && !hb.user_agent.toLowerCase().includes('lapse'));
		if (showQuirks) return noLapse;
		return noLapse.filter((hb) => !isQuirkHeartbeat(hb));
	});

	const quirkCount = $derived(
		heartbeats?.filter((hb) =>
			hb.editor !== 'lapse' && !hb.user_agent.toLowerCase().includes('lapse') &&
			isQuirkHeartbeat(hb)
		).length ?? 0
	);

	const dayProjectKeys = $derived.by(() => {
		if (!codingHeartbeats) return hackatimeProjectKeys;
		const keySet = new Set(hackatimeProjectKeys.map((k) => k.toLowerCase()));
		const present = new Set<string>();
		for (const hb of codingHeartbeats) {
			if (keySet.has(hb.project.toLowerCase())) present.add(hb.project);
		}
		return present.size > 0 ? [...present] : hackatimeProjectKeys;
	});

	function buildJoeUrl(): string {
		const params = new URLSearchParams({
			u: hackatimeUser,
			d: currentDate,
			p: dayProjectKeys.join(',')
		});
		return `https://joe.fraud.hackclub.com/billy?${params}`;
	}

	async function copyJoeLink() {
		await navigator.clipboard.writeText(buildJoeUrl());
		joeCopied = true;
		setTimeout(() => (joeCopied = false), 2000);
	}

	function handleFocusChange(timestamp: number) {
		focusedTimestamp = timestamp;
		animationKey++;
	}
</script>

<div class="border border-border-card rounded-card shadow-card overflow-hidden flex flex-col {className}">
	<div class="flex items-center justify-between px-6 py-4 border-b border-border-card">
		<div class="flex items-center gap-2.5">
			<Activity size={18} class="text-text-secondary" />
			<div class="flex flex-col gap-0.5">
				<h2 class="font-bold text-[15px] text-text-primary tracking-[-0.45px]">Hackatime Details</h2>
				<p class="text-[12px] text-text-secondary tracking-[-0.24px] flex items-center gap-1.5">
					{#if codingHeartbeats}
						{codingHeartbeats.length} heartbeat{codingHeartbeats.length === 1 ? '' : 's'}
						{#if !showQuirks && quirkCount > 0}
							<span class="text-text-tertiary">({quirkCount} quirk{quirkCount === 1 ? '' : 's'} hidden)</span>
						{/if}
					{:else}
						No data
					{/if}
					{#if loading}
						<LoaderCircle size={12} class="animate-spin text-text-tertiary" />
					{/if}
				</p>
			</div>
		</div>

		{#if quirkCount > 0}
			<Checkbox checked={showQuirks} onchange={() => (showQuirks = !showQuirks)}>
				<div class="flex flex-col gap-0.5">
					<span class="text-sm text-text-primary tracking-[-0.3px]">Quirk heartbeats</span>
					<span class="text-[11px] text-text-tertiary tracking-[-0.2px]">Show heartbeats that are probably caused by WakaTime plugin quirks</span>
				</div>
			</Checkbox>
		{/if}
	</div>

	<div class="flex items-center justify-between px-6 py-2.5 border-b border-border-card bg-surface/30">
		<div class="flex items-center gap-2 min-w-0">
			<FolderCode size={14} class="text-text-tertiary shrink-0" />
			<span class="text-[12px] text-text-tertiary shrink-0">Projects:</span>
			<div class="flex flex-wrap gap-1.5 min-w-0">
				{#each visibleProjects as proj (proj.name)}
					<span class="text-[12px] font-medium text-text-primary bg-page border border-border-card rounded-tag px-2 py-0.5 truncate">
						{proj.name} <span class="text-text-tertiary font-normal">{formatHours(proj.totalSeconds)}</span>
					</span>
				{/each}
				{#if overflowProjects.length > 0}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<span
						class="overflow-pill text-[12px] font-medium text-text-secondary bg-page border border-border-card rounded-tag px-2 py-0.5 cursor-default"
						onmouseenter={(e) => {
							const rect = e.currentTarget.getBoundingClientRect();
							overflowTooltip = { x: rect.left + rect.width / 2, y: rect.top };
						}}
						onmouseleave={() => (overflowTooltip = null)}
					>
						+{overflowProjects.length}
					</span>
				{/if}
			</div>
		</div>
		<button
			class="flex items-center gap-1 text-[11px] px-2 py-1 rounded-tag cursor-pointer transition-colors shrink-0 ml-4 {joeCopied ? 'bg-check-pass/10 text-check-pass border border-check-pass/30' : 'bg-page border border-border-card text-text-secondary hover:text-text-primary'}"
			onclick={copyJoeLink}
		>
			{#if joeCopied}
				<Check size={12} />
				Copied
			{:else}
				<ExternalLink size={12} />
				Copy Joe link
			{/if}
		</button>
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
											<path d={day.lineNoPath} stroke="#06b6d4" stroke-width="10" stroke-linecap="round" fill="none" />
											<path d={day.cursorPath} stroke="#e33062" stroke-width="10" stroke-linecap="round" fill="none" />
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

{#if overflowTooltip}
	<div
		class="overflow-tooltip"
		style="left: {overflowTooltip.x}px; top: {overflowTooltip.y}px;"
	>
		{#each overflowProjects as proj (proj.name)}
			<span class="whitespace-nowrap text-[12px] text-text-primary">{proj.name} <span class="text-text-tertiary">{formatHours(proj.totalSeconds)}</span></span>
		{/each}
	</div>
{/if}

<style>
	.overflow-tooltip {
		position: fixed;
		transform: translate(-50%, calc(-100% - 6px));
		background: var(--color-page, #fff);
		border: 1px solid var(--color-border-card);
		border-radius: 8px;
		padding: 6px 10px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		z-index: 50;
		pointer-events: none;
	}
</style>
