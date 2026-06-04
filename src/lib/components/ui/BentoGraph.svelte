<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description: string;
		count: number | string;
		icon?: Snippet;
		data?: number[];
		class?: string;
	}

	let {
		title,
		description,
		count,
		icon,
		data = [],
		class: className = ''
	}: Props = $props();

	const maxVal = $derived(Math.max(...data, 1));
</script>

<div
	class="bg-surface flex flex-col items-start justify-between overflow-clip px-6 py-5 rounded-bento h-[280px] {className}"
>
	<div class="flex gap-2.5 items-center w-full">
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
		<p class="font-bold text-[28px] text-text-primary shrink-0">{count}</p>
	</div>

	<div class="border-border-card border-b-2 border-l-2 flex h-[170px] items-end justify-between px-3 rounded-bl-section w-full gap-0.5">
		{#each data as value, i (i)}
			<div
				class="bg-accent rounded-t-section flex-1 max-w-[28px] min-w-[6px] transition-all"
				style="height: {(value / maxVal) * 100}%"
			></div>
		{/each}
	</div>
</div>
