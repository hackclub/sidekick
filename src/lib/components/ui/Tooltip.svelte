<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		text?: string;
		tip?: Snippet;
		children: Snippet;
	}

	let { text, tip, children }: Props = $props();
	let pos = $state<{ x: number; y: number } | null>(null);

	function onenter(e: MouseEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		pos = { x: rect.left + rect.width / 2, y: rect.top };
	}

	function onleave() {
		pos = null;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span onmouseenter={onenter} onmouseleave={onleave}>
	{@render children()}
</span>

{#if pos}
	<div
		class="tooltip"
		style="left: {pos.x}px; top: {pos.y}px;"
	>
		{#if tip}
			{@render tip()}
		{:else if text}
			<span class="whitespace-nowrap text-[12px] text-text-secondary">{text}</span>
		{/if}
	</div>
{/if}

<style>
	.tooltip {
		position: fixed;
		transform: translate(-50%, calc(-100% - 6px));
		background: var(--color-page, #fff);
		border: 1px solid var(--color-border-card);
		border-radius: 8px;
		padding: 6px 10px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		z-index: 50;
		pointer-events: none;
	}
</style>
