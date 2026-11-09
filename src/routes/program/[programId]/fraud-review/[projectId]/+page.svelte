<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		AlertTriangle,
		ChevronLeft,
		Eraser,
		ExternalLink,
		LoaderCircle,
		ShieldCheck,
		SkipForward,
		X
	} from 'lucide-svelte';
	import UserCard from '$lib/components/ui/UserCard.svelte';
	import HourBreakdown from '$lib/components/review/HourBreakdown.svelte';
	import HackatimeViewer from '$lib/components/review/HackatimeViewer.svelte';
	import FraudReviewBadge from '$lib/components/fraud-review/FraudReviewBadge.svelte';
	import { isUuid, shortenId } from '$lib/utils/id';
	import { createLogger } from '$lib/logger.js';
	import type { FraudReviewState } from '$lib/server/fraud-review.js';
	import { getFraudQueue } from '../queue.js';
	import type { PageData } from './$types.js';

	const log = createLogger('FraudReviewPage');

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	const queue = getFraudQueue();

	// undefined while the streamed Hackatime totals are still loading.
	let hackatime = $state<Awaited<typeof data.hackatimeData> | undefined>(undefined);
	let commits = $state<Awaited<typeof data.commitsData>>([]);

	$effect(() => {
		hackatime = undefined;
		data.hackatimeData.then((v) => {
			hackatime = v;
		});
	});
	$effect(() => {
		commits = [];
		data.commitsData.then((v) => {
			commits = v;
		});
	});

	// Writable deriveds: they follow the loaded project, and take the saved
	// verdict (or the reviewer's typing) in between.
	let review = $derived<FraudReviewState | null>(data.fraudReview);
	let note = $derived(data.fraudReview?.forPendingShip ? (data.fraudReview.note ?? '') : '');
	let saving = $state<'clean' | 'skipped' | 'clear' | null>(null);
	let saveError = $state<string | null>(null);

	const staleShipNumber = $derived.by(() => {
		if (!review || review.forPendingShip) return null;
		const i = data.project.ships.findIndex((s) => s.id === review!.shipId);
		return i === -1 ? null : i + 1;
	});

	function fmtHrs(hours: number): string {
		return `${Math.round(hours * 100) / 100}`;
	}

	// As on the review page: the claim is cumulative, so an update's new hours
	// are what it claims beyond the last approved ship. Programs that send 0 on
	// pending ships leave the claim unknown.
	const shippedDeltaHours = $derived.by(() => {
		const ship = data.pendingShip;
		if (!ship) return undefined;
		const lastApprovedCumulative = data.project.ships
			.filter((s) => s.id !== ship.id && s.status === 'approved')
			.reduce((max, s) => Math.max(max, s.hoursSubmitted), 0);
		if (ship.hoursSubmitted <= 0) {
			if (lastApprovedCumulative <= 0 || !hackatime) return undefined;
			return Math.max(0, hackatime.totalSeconds / 3600 - lastApprovedCumulative);
		}
		return Math.max(0, ship.hoursSubmitted - lastApprovedCumulative);
	});

	const isUpdate = $derived(data.project.ships.some((s) => s.status === 'approved'));

	// The day markers the review page draws, minus the ones that need the
	// timeline: ships come from the project itself, commits from GitHub.
	const markers = $derived([
		...data.project.ships.map((s) => ({
			type: 'ship' as const,
			timestamp: s.submittedAt,
			title: `${data.author.name} shipped`,
			subtitle: `${fmtHrs(s.hoursSubmitted)}h submitted`,
			avatarUrl: data.author.avatarUrl ?? undefined
		})),
		...commits.map((c) => ({
			type: 'commit' as const,
			timestamp: c.date,
			title: c.message.split('\n')[0],
			subtitle: c.author,
			avatarUrl: c.authorAvatarUrl ?? undefined,
			authorKey: c.authorLogin ?? c.author
		}))
	]);

	const apiUrl = $derived(
		`/api/programs/${data.program.id}/fraud-review/${encodeURIComponent(data.project.id)}`
	);

	async function save(method: 'PUT' | 'DELETE', body: Record<string, unknown>) {
		const res = await fetch(apiUrl, {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const json = await res.json().catch(() => null);
		if (!res.ok) throw new Error(json?.message ?? `Failed to save (HTTP ${res.status})`);
		return json.fraudReview as FraudReviewState | null;
	}

	async function decide(status: 'clean' | 'skipped') {
		if (!data.pendingShip || saving) return;
		saving = status;
		saveError = null;
		const next = queue.nextHref(data.project.id);
		try {
			const saved = await save('PUT', {
				shipId: data.pendingShip.id,
				status,
				note: note.trim() || null
			});
			log.info('Fraud review saved', { projectId: data.project.id, status });
			queue.record(data.project.id, saved);
			review = saved;
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- built with resolve() in the layout
			await goto(next);
		} catch (e) {
			saveError =
				e instanceof Error ? e.message : 'Failed to save. Check your connection and try again.';
			log.error('Fraud review save failed', { error: e });
		} finally {
			saving = null;
		}
	}

	async function clear() {
		if (!data.pendingShip || saving) return;
		saving = 'clear';
		saveError = null;
		try {
			const remaining = await save('DELETE', { shipId: data.pendingShip.id });
			queue.record(data.project.id, remaining);
			review = remaining;
			note = '';
		} catch (e) {
			saveError =
				e instanceof Error ? e.message : 'Failed to clear. Check your connection and try again.';
			log.error('Fraud review clear failed', { error: e });
		} finally {
			saving = null;
		}
	}
</script>

<svelte:head>
	<title>{data.project.title} - Fraud review - {data.program.name} - Sidekick</title>
</svelte:head>

<div class="flex flex-col h-full min-h-0">
	<div
		class="border-b border-border-input flex h-11 items-center justify-between gap-3 px-4 shrink-0 min-w-0"
	>
		<div class="flex gap-3 items-center min-w-0 flex-1">
			<a
				href={resolve(`/program/${data.program.id}/fraud-review`)}
				class="md:hidden shrink-0 border border-border-button rounded-md flex gap-1.5 h-8 items-center justify-center px-3 hover:bg-surface transition-colors"
			>
				<ChevronLeft size={14} />
				<span class="font-medium text-sm text-text-subtle tracking-[-0.3px]">List</span>
			</a>
			<div class="flex gap-1.5 items-center text-sm tracking-[-0.4px] min-w-0 truncate">
				<span
					class="text-text-secondary shrink-0"
					title={isUuid(data.project.id) ? data.project.id : undefined}
					>#{shortenId(data.project.id)}</span
				>
				<span class="font-bold truncate">{data.project.title}</span>
				<span class="shrink-0 max-md:hidden">by</span>
				<div class="flex gap-1 items-center shrink-0 max-md:hidden">
					{#if data.author.avatarUrl}
						<img src={data.author.avatarUrl} alt="" class="size-[18px] rounded-full object-cover" />
					{/if}
					<span class="font-bold">{data.author.name}</span>
				</div>
			</div>
		</div>
		<div class="flex items-center gap-3 shrink-0">
			{#if data.pendingShip}
				<span class="text-sm tracking-[-0.3px] max-lg:hidden">
					Ship {data.pendingShip.number} ·
					<span class="font-bold"
						>{data.pendingShip.hoursSubmitted > 0
							? `${fmtHrs(data.pendingShip.hoursSubmitted)}h`
							: 'No hours'}</span
					> claimed
				</span>
			{/if}
			{#if data.canOpenReview}
				<a
					href={resolve(
						`/program/${data.program.id}/review/${encodeURIComponent(data.project.id)}`
					)}
					target="_blank"
					rel="noopener"
					class="border border-border-button rounded-md flex gap-1.5 h-8 items-center justify-center px-3 hover:bg-surface transition-colors"
					title="The full review page, in a new tab"
				>
					<span class="font-medium text-sm text-text-subtle tracking-[-0.3px]">Open review</span>
					<ExternalLink size={13} class="text-text-subtle" />
				</a>
			{/if}
		</div>
	</div>

	<div class="flex-1 min-h-0 overflow-auto px-6 max-md:px-3 wide:px-12 py-6 max-md:py-4">
		<div class="fraud-top gap-3 mb-3">
			<div
				class="border border-border-card rounded-card shadow-card p-6 max-md:p-4 flex flex-col gap-3 text-sm tracking-[-0.3px]"
			>
				{#if data.pendingShip}
					<p class="text-text-secondary">
						Ship {data.pendingShip.number} of {data.project.ships.length} ·
						{data.pendingShip.status === 'pending_hq' ? 'awaiting HQ' : 'pending review'} · submitted
						{new Date(data.pendingShip.submittedAt).toLocaleDateString('en-US', {
							month: 'short',
							day: 'numeric',
							year: 'numeric'
						})}
					</p>
					<p class="text-[22px] font-bold tracking-[-0.66px] leading-none">
						{data.pendingShip.hoursSubmitted > 0
							? `${fmtHrs(data.pendingShip.hoursSubmitted)}h`
							: 'No hours'}
						<span class="text-sm font-normal tracking-[-0.3px] text-text-secondary">
							claimed{#if isUpdate && shippedDeltaHours != null}, {fmtHrs(shippedDeltaHours)}h since
								the last approved ship{/if}
						</span>
					</p>
				{:else}
					<p class="text-text-secondary">
						This project has no pending ship any more, so there's nothing to mark.
					</p>
				{/if}
			</div>

			<UserCard
				name={data.author.name}
				avatarUrl={data.author.avatarUrl}
				joinDate=""
				slackId={data.author.slackId}
				hackatimeId={data.author.hackatimeId}
				trustLevel={data.trustLevel}
				trustLogs={hackatime?.trustLogs ?? []}
				loading={hackatime === undefined}
			/>

			<HourBreakdown
				aggregatedSeconds={hackatime?.totalSeconds ?? 0}
				truncated={hackatime?.truncated ?? false}
				shippedHours={shippedDeltaHours}
				aiSeconds={hackatime?.aiSeconds ?? 0}
				browserSeconds={hackatime?.browserSeconds ?? 0}
				aiAndBrowserSeconds={hackatime?.aiAndBrowserSeconds ?? 0}
				previousShips={[]}
				loading={hackatime === undefined}
			/>
		</div>

		{#if data.hackatimeUser}
			<!-- Remounted per project: the viewer keeps its selected day and tabs
			     in its own state, which would otherwise carry over. -->
			{#key data.project.id}
				<HackatimeViewer
					hackatimeUser={data.hackatimeUser}
					hackatimeProjectKeys={data.project.hackatimeProjectKeys}
					programId={data.program.id}
					canViewHeartbeats={true}
					defaultDate={data.pendingShip?.submittedAt
						? new Date(data.pendingShip.submittedAt).toLocaleDateString('sv-SE', {
								timeZone: data.authorTimezone
							})
						: undefined}
					projectBreakdown={hackatime?.projectBreakdown ?? []}
					{markers}
					authorTimezone={data.authorTimezone}
					hackatimeStartDate={data.project.hackatimeStartDate}
				/>
			{/key}
		{:else}
			<div
				class="border border-dashed border-border-input rounded-card px-6 py-10 text-center text-sm text-text-secondary"
			>
				This project links no Hackatime projects, so there are no heartbeats to check.
			</div>
		{/if}
	</div>

	<div
		class="shrink-0 border-t border-border-input bg-page px-6 max-md:px-3 py-3 flex flex-col gap-2"
	>
		{#if saveError}
			<div
				class="flex items-start gap-2 px-3 py-2 rounded-tag bg-check-fail/10 border border-check-fail/30 text-sm text-check-fail"
			>
				<AlertTriangle size={15} class="shrink-0 mt-0.5" />
				<span class="flex-1">{saveError}</span>
				<button
					class="shrink-0 cursor-pointer hover:opacity-70"
					onclick={() => (saveError = null)}
					aria-label="Dismiss"
				>
					<X size={14} />
				</button>
			</div>
		{/if}
		<div class="flex items-center gap-3 max-md:flex-col max-md:items-stretch">
			<FraudReviewBadge
				{review}
				{staleShipNumber}
				class="shrink-0 max-w-[40%] max-md:max-w-full max-md:self-start"
			/>
			<input
				bind:value={note}
				maxlength={2000}
				disabled={!data.pendingShip}
				placeholder="Note (optional): what you saw, or why you're skipping"
				aria-label="Note"
				class="flex-1 min-w-0 border border-border-input rounded-tag px-3 py-1.5 text-sm text-text-input placeholder:text-text-placeholder outline-none focus:border-border-active disabled:opacity-50"
			/>
			<div class="flex items-center gap-2 shrink-0 max-md:[&>button]:flex-1">
				{#if review?.forPendingShip}
					<button
						class="flex items-center justify-center gap-1.5 h-8 px-3 rounded-tag border border-border-input text-sm font-medium text-text-secondary hover:text-check-fail hover:bg-surface cursor-pointer disabled:opacity-50 disabled:cursor-default"
						onclick={clear}
						disabled={!!saving}
						title="Remove the verdict, so the project needs review again"
					>
						{#if saving === 'clear'}<LoaderCircle size={14} class="animate-spin" />{:else}<Eraser
								size={14}
							/>{/if}
						Clear
					</button>
				{/if}
				<button
					class="flex items-center justify-center gap-1.5 h-8 px-3 rounded-tag border border-border-button text-sm font-medium text-text-primary hover:bg-surface cursor-pointer disabled:opacity-50 disabled:cursor-default"
					onclick={() => decide('skipped')}
					disabled={!data.pendingShip || !!saving}
					title="Not sure: leave it for later or for someone else. Still counts as not reviewed."
				>
					{#if saving === 'skipped'}<LoaderCircle
							size={14}
							class="animate-spin"
						/>{:else}<SkipForward size={14} />{/if}
					Skip
				</button>
				<button
					class="flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-tag bg-check-pass text-white text-sm font-semibold hover:bg-check-pass/90 cursor-pointer disabled:opacity-50 disabled:cursor-default"
					onclick={() => decide('clean')}
					disabled={!data.pendingShip || !!saving}
				>
					{#if saving === 'clean'}<LoaderCircle size={14} class="animate-spin" />{:else}<ShieldCheck
							size={14}
						/>{/if}
					Heartbeats clean
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	/* Each card keeps its own height: the ship card is short and would
	   otherwise stretch into an empty box beside the taller ones. */
	.fraud-top {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-items: start;
	}

	@media (min-width: 768px) {
		.fraud-top {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}

		.fraud-top > :first-child {
			grid-column: 1 / -1;
		}
	}

	@media (min-width: 1280px) {
		.fraud-top {
			grid-template-columns: minmax(0, 1fr) minmax(0, 360px) minmax(0, 360px);
		}

		.fraud-top > :first-child {
			grid-column: auto;
		}
	}
</style>
