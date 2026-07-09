<script lang="ts">
	import { FolderGit2, LoaderCircle, Hourglass, CheckCircle } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import { isUuid, shortenId } from '$lib/utils/id';
	import type { Project, Ship } from '$lib/server/protocol/types.js';

	interface Props {
		programId: string;
		projects: Project[];
		loading?: boolean;
		class?: string;
	}

	let { programId, projects, loading = false, class: className = '' }: Props = $props();

	// A project's headline status is its most recent ship's status — for re-ship
	// sequences that's the ship actually being (or last) acted on.
	function latestShip(project: Project): Ship | null {
		return project.ships.length > 0 ? project.ships[project.ships.length - 1] : null;
	}

	function approvedHours(project: Project): number {
		return project.ships
			.filter((s) => s.status === 'approved')
			.reduce((max, s) => Math.max(max, s.hoursSubmitted), 0);
	}

	function formatHours(hours: number): string {
		return `${Math.round(hours * 10) / 10}h`;
	}

	const STATUS_CONFIG: Record<Ship['status'], { label: string; classes: string }> = {
		pending: { label: 'Pending', classes: 'bg-amber-50 border-amber-200 text-amber-700' },
		pending_hq: { label: 'HQ review', classes: 'bg-violet-50 border-violet-200 text-violet-700' },
		approved: {
			label: 'Approved',
			classes: 'bg-check-pass/10 border-check-pass/30 text-check-pass'
		},
		rejected: {
			label: 'Rejected',
			classes: 'bg-check-fail/10 border-check-fail/30 text-check-fail'
		}
	};

	const sortedProjects = $derived(
		[...projects].sort((a, b) => {
			const aDate = latestShip(a)?.submittedAt ?? '';
			const bDate = latestShip(b)?.submittedAt ?? '';
			return bDate.localeCompare(aDate);
		})
	);
</script>

<div
	class="border border-border-card rounded-card shadow-card overflow-hidden flex flex-col {className}"
>
	<div class="flex items-center px-6 py-4 border-b border-border-card">
		<div class="flex items-center gap-2.5">
			<FolderGit2 size={18} class="text-text-secondary" />
			<div class="flex flex-col gap-0.5">
				<h2 class="font-bold text-[15px] text-text-primary tracking-[-0.45px]">Other Projects</h2>
				<p class="text-[12px] text-text-secondary tracking-[-0.24px]">
					{#if loading}
						Loading...
					{:else}
						{sortedProjects.length} other project{sortedProjects.length === 1 ? '' : 's'} by this author
					{/if}
				</p>
			</div>
		</div>
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-10 gap-3 text-text-tertiary">
			<LoaderCircle size={20} class="animate-spin" />
			<span class="text-[12px]">Loading other projects...</span>
		</div>
	{:else if sortedProjects.length === 0}
		<div class="flex items-center justify-center py-10 text-sm text-text-tertiary">
			No other projects by this author.
		</div>
	{:else}
		<div
			class="flex flex-col divide-y divide-border-card max-h-[360px] overflow-y-auto scrollbar-thin"
		>
			{#each sortedProjects as project (project.id)}
				{@const ship = latestShip(project)}
				{@const hours = approvedHours(project)}
				{@const status = ship ? STATUS_CONFIG[ship.status] : null}
				<a
					href={resolve(`/program/${programId}/review/${project.id}`)}
					class="flex items-center gap-4 px-6 py-3 hover:bg-surface/50 transition-colors"
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
							<span
								class="text-text-tertiary text-xs font-mono"
								title={isUuid(project.id) ? project.id : undefined}>#{shortenId(project.id)}</span
							>
							<span class="font-bold text-sm tracking-[-0.3px] truncate">{project.title}</span>
							{#if status}
								<span
									class="shrink-0 px-1.5 py-0.5 rounded-tag border text-[11px] font-medium {status.classes}"
									>{status.label}</span
								>
							{/if}
						</div>
						<p class="text-xs text-text-secondary tracking-[-0.24px] truncate">
							{project.description}
						</p>
					</div>
					<div class="flex items-center gap-4 shrink-0 text-xs text-text-secondary">
						{#if ship}
							<div class="flex items-center gap-1" title="Last shipped">
								<Hourglass size={12} class="text-text-tertiary" />
								<span>{new Date(ship.submittedAt).toLocaleDateString()}</span>
							</div>
						{/if}
						{#if hours > 0}
							<div class="flex items-center gap-1" title="Approved hours">
								<CheckCircle size={12} class="text-check-pass" />
								<span>{formatHours(hours)}</span>
							</div>
						{/if}
						<span class="text-text-tertiary"
							>{project.ships.length} ship{project.ships.length === 1 ? '' : 's'}</span
						>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
