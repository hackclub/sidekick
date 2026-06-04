<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		id?: string;
		hint?: string;
		children: Snippet;
	}

	let { label, id, hint, children }: Props = $props();
</script>

<div class="flex flex-col gap-1.5">
	{#if id}
		<label for={id} class="text-sm font-medium text-text-primary">{label}</label>
	{:else}
		<span class="text-sm font-medium text-text-primary">{label}</span>
	{/if}
	{#if hint}
		<p class="text-xs text-text-tertiary leading-relaxed">{hint}</p>
	{/if}
	{@render children()}
</div>
