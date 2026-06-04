<script lang="ts">
	import type { PageData } from './$types.js';
	import { resolve } from '$app/paths';
	import { Scale, Clock, CheckCircle, Hourglass, Trophy } from 'lucide-svelte';
	import BentoGraph from '$lib/components/ui/BentoGraph.svelte';
	import BentoLeaderboard from '$lib/components/ui/BentoLeaderboard.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	function formatHours(hours: number): string {
		if (hours < 0.1)
			return '0h';
		if (hours < 10)
			return `${hours.toFixed(1)}h`;
		return `${Math.round(hours)}h`;
	}

	const projectMap = $derived(
		Object.fromEntries(data.projects.map((p) => [p.id, p]))
	);
</script>

<div class="px-6 lg:px-12 xl:px-16 py-10 flex flex-col gap-8 max-w-full overflow-hidden">
	<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
		<BentoGraph
			title="Review Volume"
			description="Reviews completed per week."
			count={data.totalReviewsThisWeek}
			data={data.reviewVolume}
			class="flex-1"
		>
			{#snippet icon()}<Scale size={20} />{/snippet}
		</BentoGraph>
		<BentoLeaderboard
			title="Top Reviewers (This Week)"
			description="Most active reviewers this week."
			entries={data.reviewLeaderboardWeekly}
			itemType="reviews"
			class="flex-1"
		>
			{#snippet icon()}<Trophy size={20} />{/snippet}
		</BentoLeaderboard>
		<BentoLeaderboard
			title="Top Reviewers (All Time)"
			description="Most active reviewers overall."
			entries={data.reviewLeaderboardAllTime}
			itemType="reviews"
			class="flex-1"
		>
			{#snippet icon()}<Trophy size={20} />{/snippet}
		</BentoLeaderboard>
	</div>

	<div class="flex items-center gap-3">
		<div class="size-9 bg-surface rounded-lg flex items-center justify-center shrink-0">
			<Scale size={18} class="text-text-secondary" />
		</div>
		<div>
			<h1 class="font-bold text-[17px] tracking-[-0.51px]">Review Queue</h1>
			<p class="text-[13px] text-text-secondary tracking-[-0.3px]">{data.pendingCount} project{data.pendingCount === 1 ? '' : 's'} pending review</p>
		</div>
	</div>

	{#if data.canAuthorize && data.pendingApprovals.length > 0}
		<div class="flex flex-col gap-2">
			<div class="flex items-center gap-2">
				<Clock size={16} class="text-amber-500" />
				<h2 class="font-bold text-sm tracking-[-0.3px]">Pending Authorization</h2>
				<span class="text-xs text-text-tertiary">{data.pendingApprovals.length} approval{data.pendingApprovals.length === 1 ? '' : 's'} awaiting authorization</span>
			</div>
			{#each data.pendingApprovals as pa (pa.projectId)}
				{@const project = projectMap[pa.projectId]}
				{@const reviewer = data.actors[pa.reviewerId]}
				<a
					href={resolve(`/program/${data.program.id}/review/${pa.projectId}`)}
					class="border-2 border-dashed border-amber-300 bg-amber-50/30 rounded-section p-4 flex items-center gap-4 hover:border-amber-400 hover:bg-amber-50/50 transition-colors"
				>
					{#if project?.screenshotUrl}
						<img src={project.screenshotUrl} alt="" class="w-16 h-10 rounded-tag object-cover shrink-0" />
					{:else}
						<div class="w-16 h-10 rounded-tag bg-surface shrink-0"></div>
					{/if}
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-1.5 mb-0.5">
							<span class="text-text-tertiary text-xs font-mono">#{pa.projectId}</span>
							<span class="font-bold text-sm tracking-[-0.3px] truncate">{project?.title ?? pa.projectId}</span>
						</div>
						<div class="flex items-center gap-1.5 text-xs text-text-secondary tracking-[-0.24px]">
							<Avatar name={reviewer?.name ?? pa.reviewerId} url={reviewer?.avatarUrl} size="xs" />
							<span class="truncate">
								{reviewer?.name ?? pa.reviewerId} approved for {formatHours(pa.hoursAssigned)}
								<span class="text-text-tertiary">&middot; {new Date(pa.createdAt).toLocaleDateString()}</span>
							</span>
						</div>
					</div>
				</a>
			{/each}
		</div>
	{/if}

	{#if data.projects.length === 0}
		<div class="flex items-center justify-center h-32 text-text-tertiary text-sm">
			No projects pending review. Nice work!
		</div>
	{:else}
		<div class="flex flex-col gap-2">
			{#each data.projects as project (project.id)}
				{@const pendingShip = project.ships.find((s) => s.status === 'pending')}
				{@const approvedHours = project.ships
					.filter((s) => s.status === 'approved')
					.reduce((sum, s) => sum + s.hoursSubmitted, 0)}
				{@const actor = data.actors[project.authorId]}
				<a
					href={resolve(`/program/${data.program.id}/review/${project.id}`)}
					class="border border-border-card rounded-section p-4 flex items-center gap-4 hover:border-accent hover:bg-accent-bg transition-colors"
				>
					{#if project.screenshotUrl}
						<img src={project.screenshotUrl} alt="" class="w-16 h-10 rounded-tag object-cover shrink-0" />
					{:else}
						<div class="w-16 h-10 rounded-tag bg-surface shrink-0"></div>
					{/if}
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-1.5 mb-0.5">
							<span class="text-text-tertiary text-xs font-mono">#{project.id}</span>
							<span class="font-bold text-sm tracking-[-0.3px] truncate">{project.title}</span>
						</div>
						<div class="flex items-center gap-1.5 text-xs text-text-secondary tracking-[-0.24px]">
							<Avatar name={actor?.name ?? project.authorId} url={actor?.avatarUrl} size="xs" />
							<span class="truncate">
								{actor?.name ?? project.authorId}
								{#if pendingShip}
									<span class="text-text-tertiary">&middot; {new Date(pendingShip.submittedAt).toLocaleDateString()}</span>
								{/if}
								{#if project.ships.length > 1}
									<span class="text-accent font-medium">&middot; Update ({project.ships.length} ships)</span>
								{/if}
							</span>
						</div>
					</div>
					<div class="flex items-center gap-4 shrink-0 text-xs text-text-secondary">
						{#if pendingShip}
							<div class="flex items-center gap-1" title="Reported hours (this ship)">
								<Hourglass size={12} class="text-text-tertiary" />
								<span>{formatHours(pendingShip.hoursSubmitted)}</span>
							</div>
						{/if}
						{#if approvedHours > 0}
							<div class="flex items-center gap-1" title="Prior approved hours">
								<CheckCircle size={12} class="text-check-pass" />
								<span>{formatHours(approvedHours)}</span>
							</div>
						{/if}
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
