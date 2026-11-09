<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy, onMount, tick } from 'svelte';
	import HackatimeViewer from '$lib/components/review/HackatimeViewer.svelte';
	import type { PageData } from './$types.js';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	// The review page's Hackatime section alone, rendered for a snapshot. Once
	// every fetch has settled, the requested day and tab are open and the
	// charts have drawn, the wrapper gets data-ready="true"; the capture
	// client waits on that so a screenshot is never taken mid-load.

	// No fetch for this long counts as settled: the viewer chains requests
	// (date range, then months, then the newest day's heartbeats), and the
	// gaps between them are a few frames, not this.
	const QUIET_MS = 500;
	// ECharts emits `finished` when a render (animation included) is done, but
	// not again for a chart that already finished, so this bounds the wait.
	const CHART_SETTLE_MS = 1500;
	// How long a chart's container may sit empty before it counts as having
	// no chart coming.
	const CHART_APPEAR_MS = 300;
	const TAB_LABELS: Record<string, string> = { breakdown: 'Breakdown', files: 'Files' };

	let projectBreakdown = $state<Awaited<PageData['projectBreakdown']> | null>(null);
	let commits = $state<Awaited<PageData['commits']> | null>(null);

	$effect(() => {
		projectBreakdown = null;
		data.projectBreakdown.then((v) => (projectBreakdown = v));
	});
	$effect(() => {
		commits = null;
		data.commits.then((v) => (commits = v));
	});

	function fmtHrs(hours: number): string {
		return `${Math.round(hours * 100) / 100}`;
	}

	// The subset of the review page's reviewMarkers that needs no timeline:
	// ships and commits, built the same way so the day pills and the
	// scatter's commit row match.
	const markers = $derived([
		...data.ships.map((s) => ({
			type: 'ship' as const,
			timestamp: s.submittedAt,
			title: `${data.author.name} shipped`,
			subtitle: `${fmtHrs(s.hoursSubmitted)}h submitted`,
			avatarUrl: data.author.avatarUrl ?? undefined
		})),
		...(commits ?? []).map((c) => ({
			type: 'commit' as const,
			timestamp: c.date,
			title: c.message.split('\n')[0],
			subtitle: c.author,
			avatarUrl: c.authorAvatarUrl ?? undefined,
			authorKey: c.authorLogin ?? c.author
		}))
	]);

	let root = $state<HTMLElement | null>(null);
	let readyState = $state<'ready' | 'date-not-found' | null>(null);

	// The viewer exposes nothing about its loading, so in-flight fetches are
	// counted here. A request only counts as done once its body is read: the
	// viewer renders after `res.json()`, and a big day of heartbeats takes a
	// while to arrive after the headers do.
	let pendingFetches = 0;
	let fetchCount = 0;
	let lastFetchAt = 0;
	if (browser) {
		const nativeFetch = window.fetch;
		window.fetch = async (...args: Parameters<typeof fetch>) => {
			pendingFetches++;
			fetchCount++;
			try {
				const res = await nativeFetch(...args);
				await res
					.clone()
					.arrayBuffer()
					.catch(() => {});
				return res;
			} finally {
				pendingFetches--;
				lastFetchAt = performance.now();
			}
		};
		onDestroy(() => (window.fetch = nativeFetch));
	}

	function settled(): boolean {
		if (!root || projectBreakdown === null || commits === null) return false;
		// Every path through the viewer fetches the date range first.
		if (data.hackatimeUser && fetchCount === 0) return false;
		if (pendingFetches > 0 || performance.now() - lastFetchAt < QUIET_MS) return false;
		// Skeletons and spinners: the day strip, the frequency bar, "Loading heartbeats…".
		return !root.querySelector('.animate-pulse, .animate-spin');
	}

	async function untilSettled() {
		while (!settled()) await new Promise((r) => setTimeout(r, 100));
	}

	// The day buttons carry no date, only the labels the viewer formats, so
	// a day is found by its month group's label and its own, computed with
	// the viewer's exact formatting (author's timezone included).
	function findDayButton(date: string): HTMLButtonElement | null {
		const [y, m] = date.split('-').map(Number);
		const tz = data.authorTimezone;
		const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
			month: 'short',
			year: 'numeric',
			timeZone: tz
		});
		const dayLabel = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			timeZone: tz
		});
		for (const btn of root?.querySelectorAll<HTMLButtonElement>('button[data-selected]') ?? []) {
			// button → its .relative wrapper → the group's day row → the month group
			const group = btn.parentElement?.parentElement?.parentElement;
			if (
				btn.querySelector('span')?.textContent?.trim() === dayLabel &&
				group?.firstElementChild?.textContent?.trim() === monthLabel
			) {
				return btn;
			}
		}
		return null;
	}

	// Charts are created a beat after their tab renders (each one imports
	// ECharts first), so this keeps looking until a round turns up no new
	// instance, waiting for each to finish drawing.
	async function chartsDrawn() {
		const echarts = await import('echarts');
		const seen = new WeakSet<Element>();
		for (;;) {
			await new Promise((r) => setTimeout(r, CHART_APPEAR_MS));
			const fresh = [...(root?.querySelectorAll<HTMLElement>('[_echarts_instance_]') ?? [])].filter(
				(el) => !seen.has(el)
			);
			if (fresh.length === 0) return;
			await Promise.all(
				fresh.map(
					(el) =>
						new Promise<void>((resolve) => {
							seen.add(el);
							const chart = echarts.getInstanceByDom(el);
							if (!chart) return resolve();
							const done = () => {
								clearTimeout(timer);
								chart.off('finished', done);
								resolve();
							};
							const timer = setTimeout(done, CHART_SETTLE_MS);
							chart.on('finished', done);
						})
				)
			);
		}
	}

	async function prepare() {
		await untilSettled();
		if (!root) return;

		if (data.hackatimeUser && data.date) {
			const btn = findDayButton(data.date);
			if (!btn) {
				readyState = 'date-not-found';
				return;
			}
			if (btn.dataset.selected !== 'true') {
				btn.click();
				await tick();
				await untilSettled();
			}
		}

		const tabLabel = TAB_LABELS[data.tab];
		if (tabLabel) {
			const tabButton = [...root.querySelectorAll('button')].find(
				(b) => b.textContent?.trim() === tabLabel
			);
			tabButton?.click();
			await tick();
			await untilSettled();
		}

		// Centre the selected day in its strip, as the viewer does after
		// loading, but at once rather than mid smooth-scroll.
		root
			.querySelector('button[data-selected="true"]')
			?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });

		await document.fonts.ready;
		await Promise.all(
			[...root.querySelectorAll('img')].map((img) =>
				img.complete ? null : new Promise((r) => img.addEventListener('loadend', r, { once: true }))
			)
		);
		await chartsDrawn();
		// Let the last frame paint.
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		readyState = 'ready';
	}

	onMount(() => {
		void prepare();
	});
</script>

<svelte:head>
	<title>Hackatime · {data.projectId}</title>
</svelte:head>

<div class="min-h-screen bg-page p-6">
	<div
		bind:this={root}
		data-hackatime-export
		data-ready={readyState ? 'true' : undefined}
		data-state={readyState ?? 'loading'}
		style:width={data.width ? `${data.width}px` : undefined}
	>
		{#if data.hackatimeUser}
			<HackatimeViewer
				hackatimeUser={data.hackatimeUser}
				hackatimeProjectKeys={data.hackatimeProjectKeys}
				programId={data.programId}
				canViewHeartbeats={true}
				defaultDate={data.defaultDate}
				projectBreakdown={projectBreakdown ?? []}
				{markers}
				authorTimezone={data.authorTimezone}
				hackatimeStartDate={data.hackatimeStartDate}
				commitAuthorFilter={null}
			/>
		{:else}
			<p class="text-[15px] text-text-secondary">This project has no Hackatime projects linked.</p>
		{/if}
	</div>
</div>
