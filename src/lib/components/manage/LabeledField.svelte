<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		description: string;
		icon: Snippet;
		children: Snippet;
	}

	let { label, description, icon, children }: Props = $props();
</script>

<div class="flex flex-col gap-2.5">
	<div class="flex items-start gap-2">
		<div class="size-5 flex items-center justify-center shrink-0 text-text-tertiary mt-px">
			{@render icon()}
		</div>

		<div class="flex flex-col gap-0 flex-1 min-w-0">
			<span class="text-sm font-semibold text-text-primary tracking-[-0.3px]">{label}</span>
			<p class="text-[12px] text-text-tertiary">{description}</p>
		</div>
	</div>
	
	{@render children()}
</div>
