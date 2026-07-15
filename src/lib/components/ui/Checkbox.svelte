<script lang="ts">
	import { Check } from 'lucide-svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		checked: boolean;
		onchange?: () => void;
		disabled?: boolean;
		children?: Snippet;
	}

	let { checked, onchange, disabled = false, children }: Props = $props();
</script>

<button
	type="button"
	class="flex items-start gap-2.5 text-left group
		{disabled ? 'cursor-default opacity-60' : 'cursor-pointer'}"
	onclick={onchange}
	{disabled}
>
	{#if checked}
		<div class="size-[18px] {disabled ? 'bg-border-card' : 'bg-accent'} rounded-[4px] flex items-center justify-center shrink-0 mt-px">
			<Check size={13} class={disabled ? 'text-text-subtle' : 'text-white'} strokeWidth={3} />
		</div>
	{:else}
		<div class="size-[18px] border-2 border-border-card rounded-[4px] shrink-0 mt-px {!disabled ? 'group-hover:border-accent/50' : ''}"></div>
	{/if}

	{#if children}
		{@render children()}
	{/if}
</button>
