<script lang="ts">
	import { Copy, ExternalLink } from 'lucide-svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		name: string;
		url: string;
		icon?: Snippet;
	}

	let { name, url, icon }: Props = $props();

	let copied = $state(false);

	async function copyUrl() {
		await navigator.clipboard.writeText(url);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<div class="flex items-center">
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<a
		href={url}
		target="_blank"
		rel="noopener noreferrer"
		class="bg-white border border-border-input flex gap-2 h-10 items-center justify-center rounded-l-input shrink-0 px-5 hover:bg-surface transition-colors"
	>
		{#if icon}
			<span class="size-[14px]">{@render icon()}</span>
		{:else}
			<ExternalLink size={14} />
		{/if}
		<span class="font-bold text-sm text-text-input tracking-[-0.3px]">{name}</span>
	</a>
	<a
		href={url}
		target="_blank"
		rel="noopener noreferrer"
		class="bg-white border-y border-border-input flex h-10 items-center px-4 flex-1 min-w-0 hover:bg-surface transition-colors"
	>
		<span class="text-sm text-link truncate">{url}</span>
	</a>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
	<button
		class="bg-white border border-border-input h-10 w-10 flex items-center justify-center rounded-r-input hover:bg-surface transition-colors cursor-pointer"
		onclick={copyUrl}
	>
		{#if copied}
			<span class="text-check-pass text-[9px] font-bold">OK</span>
		{:else}
			<Copy size={14} class="text-text-input" />
		{/if}
	</button>
</div>
