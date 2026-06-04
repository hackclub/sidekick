<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends HTMLAttributes<HTMLButtonElement> {
		children: Snippet;
	}

	let { children, ...rest }: Props = $props();
</script>

<button
	class="bg-white border border-border-active rounded-tag p-3 flex items-center justify-center hover:bg-surface transition-colors cursor-pointer"
	{...rest}
>
	{@render children()}
</button>
