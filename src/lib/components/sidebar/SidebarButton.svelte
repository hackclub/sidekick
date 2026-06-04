<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends HTMLAttributes<HTMLButtonElement> {
		active?: boolean;
		disabled?: boolean;
		children: Snippet;
	}

	let { active = false, disabled = false, children, ...rest }: Props = $props();
</script>

<button
	class="flex items-center justify-center rounded-sidebar-btn size-10 transition-all
		{disabled
		? 'opacity-40 cursor-default'
		: active
			? 'bg-white border border-border-active shadow-sidebar-active cursor-pointer'
			: 'bg-sidebar hover:bg-white/60 cursor-pointer'}"
	{disabled}
	{...rest}
>
	{@render children()}
</button>
