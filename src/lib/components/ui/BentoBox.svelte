<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description: string;
		icon?: Snippet;
		slot?: Snippet;
		children?: Snippet;
		class?: string;
		outlined?: boolean;
	}

	let { title, description, icon, slot, children, class: className = '', outlined = false }: Props = $props();
</script>

<div class="{outlined ? 'border border-border-card' : 'bg-surface'} flex flex-col gap-5 items-start overflow-clip px-6 py-5 rounded-bento {className}">
	<div class="flex gap-2.5 items-center w-full">
		<div class="flex flex-1 gap-2.5 items-center min-w-0">
			{#if icon}
				<div class="shrink-0 text-text-secondary">
					{@render icon()}
				</div>
			{/if}
			<div class="flex flex-col gap-0.5 min-w-0">
				<h2 class="font-bold text-[15px] text-text-primary tracking-[-0.45px] truncate">{title}</h2>
				<p class="text-[12px] text-text-secondary tracking-[-0.24px]">{description}</p>
			</div>
		</div>
		{#if slot}
			<div class="shrink-0">
				{@render slot()}
			</div>
		{/if}
	</div>
	{#if children}
		<div class="flex-1 min-h-0 w-full">
			{@render children()}
		</div>
	{/if}
</div>
