<script lang="ts">
	import type { Snippet } from 'svelte';
	import Avatar from './Avatar.svelte';

	interface LeaderboardEntry {
		username: string;
		avatarUrl?: string | null;
		value: number;
	}

	interface Props {
		title: string;
		description: string;
		entries: LeaderboardEntry[];
		itemType?: string;
		icon?: Snippet;
		class?: string;
	}

	let {
		title,
		description,
		entries,
		itemType = 'orders',
		icon,
		class: className = ''
	}: Props = $props();
</script>

<div
	class="bg-surface flex flex-col gap-5 items-start overflow-clip px-6 py-5 rounded-bento h-[280px] {className}"
>
	<div class="flex items-center w-full">
		<div class="flex flex-1 gap-2.5 items-center min-w-0">
			{#if icon}
				<div class="shrink-0 text-text-secondary">
					{@render icon()}
				</div>
			{/if}
			<div class="flex flex-col gap-0.5 min-w-0">
				<p class="font-bold text-[15px] text-text-primary tracking-[-0.45px] truncate">{title}</p>
				<p class="text-[12px] text-text-secondary tracking-[-0.24px] truncate">{description}</p>
			</div>
		</div>
	</div>

	<div class="flex flex-col gap-3 px-2 flex-1 min-h-0 w-full overflow-auto">
		{#each entries as entry, i (i)}
			<div class="flex items-center justify-between w-full">
				<div class="flex gap-4 items-center">
					<span class="font-bold text-[15px] text-text-primary w-6">#{i + 1}</span>
					<div class="flex gap-2 items-center">
						<Avatar name={entry.username} url={entry.avatarUrl} size="sm" />
						<span class="text-sm text-text-primary">{entry.username}</span>
					</div>
				</div>
				<div class="flex gap-1 items-center text-sm">
					<span class="font-bold text-text-primary">{entry.value}</span>
					<span class="text-text-primary">{itemType}</span>
				</div>
			</div>
		{/each}
	</div>
</div>
