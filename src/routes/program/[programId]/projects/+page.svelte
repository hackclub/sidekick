<script lang="ts">
	import type { PageData } from './$types.js';
	import type { Project, Ship } from '$lib/server/protocol/types.js';
	import type { ProjectStatusFilter, ProjectsPage } from '$lib/server/projects.js';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { FolderGit2, Hourglass, ExternalLink, Loader2 } from 'lucide-svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const FILTERS: { value: ProjectStatusFilter; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'pending', label: 'Pending' },
		{ value: 'pending_hq', label: 'HQ Review' },
		{ value: 'approved', label: 'Approved' },
		{ value: 'rejected', label: 'Rejected' }
	];

	// Local, growable view of the catalogue. Seeded from the server-loaded first
	// page and reset whenever a new page loads (e.g. the status filter changes).
	let projects = $state<Project[]>(data.projects);
	let nextCursor = $state<string | null>(data.nextCursor);
	let loadingMore = $state(false);
	let loadError = $state<string | null>(null);

	// Merge actor maps across pages so authors from "Load more" resolve too.
	let actors = $state<Record<string, { name: string; avatarUrl: string | null }>>(data.actors);

	$effect(() => {
		// data is replaced wholesale on navigation (status change) — re-seed.
		projects = data.projects;
		nextCursor = data.nextCursor;
		actors = data.actors;
		loadError = null;
	});

	function selectStatus(status: ProjectStatusFilter) {
		if (status === data.status) return;
		const target =
			status === 'all'
				? `/program/${data.program.id}/projects`
				: `/program/${data.program.id}/projects?status=${status}`;
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(target);
	}

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		loadingMore = true;
		loadError = null;
		try {
			const query = `cursor=${encodeURIComponent(nextCursor)}${data.status !== 'all' ? `&status=${data.status}` : ''}`;
			const res = await fetch(`/program/${data.program.id}/projects/list?${query}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const page: ProjectsPage = await res.json();
			projects = [...projects, ...page.projects];
			actors = { ...actors, ...page.actors };
			nextCursor = page.nextCursor;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load more projects';
		} finally {
			loadingMore = false;
		}
	}

	function latestShip(project: Project): Ship | undefined {
		// Ships are ordered oldest-first; the last one is the project's current state.
		return project.ships[project.ships.length - 1];
	}

	function statusStyle(status: Ship['status']): { label: string; class: string } {
		switch (status) {
			case 'pending':
				return { label: 'Pending', class: 'bg-amber-100 text-amber-700' };
			case 'pending_hq':
				return { label: 'HQ Review', class: 'bg-violet-100 text-violet-700' };
			case 'approved':
				return { label: 'Approved', class: 'bg-check-pass/10 text-check-pass' };
			case 'rejected':
				return { label: 'Rejected', class: 'bg-check-fail/10 text-check-fail' };
		}
	}

	function formatHours(hours: number): string {
		if (hours < 0.1) return '0h';
		if (hours < 10) return `${hours.toFixed(1)}h`;
		return `${Math.round(hours)}h`;
	}
</script>

<svelte:head>
	<title>Projects - {data.program.name} - Sidekick</title>
</svelte:head>

<div class="px-6 lg:px-12 xl:px-16 py-10 flex flex-col gap-8 max-w-full overflow-hidden">
	<div class="flex items-center gap-3">
		<div class="size-9 bg-surface rounded-lg flex items-center justify-center shrink-0">
			<FolderGit2 size={18} class="text-text-secondary" />
		</div>
		<div class="flex-1">
			<h1 class="font-bold text-[17px] tracking-[-0.51px]">Projects</h1>
			<p class="text-[13px] text-text-secondary tracking-[-0.3px]">
				Browse every project submitted to {data.program.name}.
				{#if data.totalCount > 0}
					<span class="text-text-tertiary">&middot; {data.totalCount} total</span>
				{/if}
			</p>
		</div>
	</div>

	<!-- Status filter -->
	<div class="flex items-center gap-1.5 flex-wrap">
		{#each FILTERS as filter (filter.value)}
			<button
				class="px-3 py-1 rounded-tag text-sm font-medium transition-colors cursor-pointer
					{data.status === filter.value
					? 'bg-text-primary text-white'
					: 'border border-border-input text-text-secondary hover:bg-surface'}"
				onclick={() => selectStatus(filter.value)}
			>
				{filter.label}
			</button>
		{/each}
	</div>

	{#if projects.length === 0}
		<div class="flex items-center justify-center h-32 text-text-tertiary text-sm">
			No projects found.
		</div>
	{:else}
		<div class="flex flex-col gap-2">
			{#each projects as project (project.id)}
				{@const ship = latestShip(project)}
				{@const actor = actors[project.authorId]}
				{@const approvedHours = project.ships
					.filter((s) => s.status === 'approved')
					.reduce((max, s) => Math.max(max, s.hoursSubmitted), 0)}
				<a
					href={resolve(`/program/${data.program.id}/review/${project.id}`)}
					class="border border-border-card rounded-section p-4 flex items-center gap-4 hover:border-accent hover:bg-accent-bg transition-colors"
				>
					{#if project.screenshotUrl}
						<img
							src={project.screenshotUrl}
							alt=""
							class="w-16 h-10 rounded-tag object-cover shrink-0"
						/>
					{:else}
						<div class="w-16 h-10 rounded-tag bg-surface shrink-0"></div>
					{/if}
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-1.5 mb-0.5">
							<span class="text-text-tertiary text-xs font-mono">#{project.id}</span>
							<span class="font-bold text-sm tracking-[-0.3px] truncate">{project.title}</span>
							{#if ship}
								{@const badge = statusStyle(ship.status)}
								<span
									class="text-[10px] font-semibold px-1.5 py-0.5 rounded-tag shrink-0 {badge.class}"
								>
									{badge.label}
								</span>
							{/if}
						</div>
						<div class="flex items-center gap-1.5 text-xs text-text-secondary tracking-[-0.24px]">
							<Avatar name={actor?.name ?? project.authorId} url={actor?.avatarUrl} size="xs" />
							<span class="truncate">
								{actor?.name ?? project.authorId}
								{#if ship}
									<span class="text-text-tertiary"
										>&middot; {new Date(ship.submittedAt).toLocaleDateString()}</span
									>
								{/if}
								{#if project.ships.length > 1}
									<span class="text-text-tertiary">&middot; {project.ships.length} ships</span>
								{/if}
							</span>
						</div>
					</div>
					<div class="flex items-center gap-4 shrink-0 text-xs text-text-secondary">
						{#if approvedHours > 0}
							<div class="flex items-center gap-1" title="Approved hours">
								<Hourglass size={12} class="text-text-tertiary" />
								<span>{formatHours(approvedHours)}</span>
							</div>
						{:else if ship}
							<div class="flex items-center gap-1" title="Reported hours (latest ship)">
								<Hourglass size={12} class="text-text-tertiary" />
								<span>{formatHours(ship.hoursSubmitted)}</span>
							</div>
						{/if}
						<ExternalLink size={14} class="text-text-tertiary" />
					</div>
				</a>
			{/each}
		</div>

		{#if loadError}
			<p class="text-center text-xs text-check-fail">{loadError}</p>
		{/if}

		{#if nextCursor}
			<div class="flex justify-center">
				<button
					class="border border-border-input rounded-tag flex gap-1.5 items-center px-4 py-1.5 cursor-pointer hover:bg-surface text-sm font-medium text-text-secondary disabled:opacity-50"
					onclick={loadMore}
					disabled={loadingMore}
				>
					{#if loadingMore}
						<Loader2 size={14} class="animate-spin" />
						<span>Loading…</span>
					{:else}
						<span>Load more</span>
					{/if}
				</button>
			</div>
		{/if}
	{/if}
</div>
