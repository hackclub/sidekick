<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description: string;
		icon: Snippet;
		children: Snippet;
	}

	let { title, description, icon, children }: Props = $props();
</script>

<div class="px-8 py-6 flex flex-col gap-4">
	<div class="flex items-center gap-3">
		<div class="size-8 bg-surface rounded-lg flex items-center justify-center shrink-0">
			{@render icon()}
		</div>

		<div class="flex flex-col gap-0.5">
			<h2 class="font-bold text-[15px] text-text-primary tracking-[-0.45px]">{title}</h2>
			<p class="text-[12px] text-text-secondary tracking-[-0.24px]">{description}</p>
		</div>
	</div>
	
	{@render children()}
</div>
