<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { SvelteMap } from 'svelte/reactivity';
	import type { Snippet } from 'svelte';
	import { ScanSearch, Activity } from 'lucide-svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import FraudReviewBadge from '$lib/components/fraud-review/FraudReviewBadge.svelte';
	import { shortenId } from '$lib/utils/id';
	import type { FraudReviewState } from '$lib/server/fraud-review.js';
	import { QUEUE_FILTERS, filterOf, setFraudQueue, type QueueFilter } from './queue.js';
	import type { LayoutData } from './$types.js';

	interface Props {
		data: LayoutData;
		children: Snippet;
	}

	let { data, children }: Props = $props();

	// The layout stays mounted while the reviewer moves between projects, so
	// the filter and the verdicts recorded since the list loaded live here.
	let filter = $state<QueueFilter>('todo');
	let verdicts = $derived(new SvelteMap<string, FraudReviewState>(Object.entries(data.verdicts)));

	const selectedId = $derived(page.params.projectId ?? null);

	const counts = $derived.by(() => {
		const c: Record<QueueFilter, number> = { todo: 0, skipped: 0, clean: 0 };
		for (const p of data.queue) c[filterOf(verdicts.get(p.id))]++;
		return c;
	});

	const filtered = $derived(data.queue.filter((p) => filterOf(verdicts.get(p.id)) === filter));

	const listHref = () => resolve(`/program/${data.program.id}/fraud-review`);
	const projectHref = (id: string) =>
		resolve(`/program/${data.program.id}/fraud-review/${encodeURIComponent(id)}`);

	setFraudQueue({
		nextHref(projectId) {
			// Read before the verdict is recorded: the project may be about to
			// leave the filtered list, and what follows it is what comes next.
			const list = filtered;
			const i = list.findIndex((p) => p.id === projectId);
			const next = i === -1 ? list[0] : (list[i + 1] ?? list.find((p) => p.id !== projectId));
			return next && next.id !== projectId ? projectHref(next.id) : listHref();
		},
		record(projectId, review) {
			if (review) verdicts.set(projectId, review);
			else verdicts.delete(projectId);
		}
	});

	function fmtHours(h: number): string {
		return `${Math.round(h * 100) / 100}h`;
	}

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}
</script>

<svelte:head>
	<title>Fraud review - {data.program.name} - Sidekick</title>
</svelte:head>

<div class="flex h-full min-h-0">
	<!-- On mobile the list and a selected project take the whole screen in turn. -->
	<aside
		class="w-[340px] shrink-0 border-r border-border-input flex flex-col min-h-0 max-md:w-full max-md:border-r-0 {selectedId
			? 'max-md:hidden'
			: ''}"
	>
		<div class="px-4 pt-4 pb-3 flex flex-col gap-1 border-b border-border-input">
			<div class="flex items-center gap-2">
				<ScanSearch size={18} class="shrink-0" />
				<h1 class="font-bold text-[17px] tracking-[-0.5px]">Fraud review</h1>
				<span class="ml-auto text-xs text-text-secondary tabular-nums"
					>{data.queue.length} pending</span
				>
			</div>
		</div>

		<div class="flex border-b border-border-input" role="tablist" aria-label="Filter">
			{#each QUEUE_FILTERS as f (f.id)}
				<button
					role="tab"
					aria-selected={filter === f.id}
					class="flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 py-2.5 text-[13px] font-medium tracking-[-0.3px] border-b-2 cursor-pointer transition-colors {filter ===
					f.id
						? 'border-accent text-text-primary'
						: 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface/60'}"
					onclick={() => (filter = f.id)}
				>
					<span class="truncate">{f.label}</span>
					<span
						class="text-[11px] tabular-nums rounded-full px-1.5 {filter === f.id
							? 'bg-accent-bg text-accent'
							: 'bg-surface text-text-tertiary'}">{counts[f.id]}</span
					>
				</button>
			{/each}
		</div>

		<div class="flex-1 min-h-0 overflow-y-auto">
			{#each filtered as p (p.id)}
				{@const review = verdicts.get(p.id) ?? null}
				<a
					href={projectHref(p.id)}
					class="flex flex-col gap-1.5 px-4 py-3 border-b border-border-table transition-colors {selectedId ===
					p.id
						? 'bg-accent-bg shadow-[inset_3px_0_0_var(--color-accent)]'
						: 'hover:bg-surface/70'}"
					aria-current={selectedId === p.id ? 'page' : undefined}
				>
					<div class="flex items-baseline gap-2 min-w-0">
						<span class="font-semibold text-sm tracking-[-0.3px] truncate">{p.title}</span>
						<span class="ml-auto shrink-0 text-xs font-medium tabular-nums text-text-dim">
							{p.hoursClaimed > 0 ? fmtHours(p.hoursClaimed) : '?h'}
						</span>
					</div>
					<div class="flex items-center gap-1.5 text-xs text-text-secondary min-w-0">
						<Avatar name={p.author.name} url={p.author.avatarUrl} size="xs" />
						<span class="truncate">{p.author.name}</span>
						<span class="shrink-0 text-text-tertiary">
							· #{shortenId(p.id)} · ship {p.shipNumber} · {fmtDate(p.submittedAt)}
						</span>
					</div>
					{#if p.shipStatus === 'pending_hq' || !p.hasHackatime || review}
						<div class="flex items-center gap-1.5 flex-wrap">
							{#if review}
								<FraudReviewBadge {review} compact />
							{/if}
							{#if p.shipStatus === 'pending_hq'}
								<span
									class="rounded-tag border border-border-input px-1.5 py-0.5 text-[11px] font-medium text-text-dim"
									>Awaiting HQ</span
								>
							{/if}
							{#if !p.hasHackatime}
								<span
									class="inline-flex items-center gap-1 rounded-tag border border-dashed border-border-input px-1.5 py-0.5 text-[11px] font-medium text-text-tertiary"
								>
									<Activity size={11} /> No Hackatime projects
								</span>
							{/if}
						</div>
					{/if}
				</a>
			{:else}
				<p class="px-4 py-10 text-sm text-text-tertiary text-center">
					{filter === 'todo'
						? 'Every pending project has a verdict.'
						: filter === 'skipped'
							? 'Nothing skipped.'
							: 'Nothing marked clean yet.'}
				</p>
			{/each}
		</div>
	</aside>

	<section class="flex-1 min-w-0 min-h-0 {selectedId ? '' : 'max-md:hidden'}">
		{@render children()}
	</section>
</div>
