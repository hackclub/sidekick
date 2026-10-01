<script lang="ts">
	import { Download, Copy, X } from 'lucide-svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		mode: 'download' | 'copy' | 'dinobox';
		totalCount: number;
		selectedCount: number;
		onclose: () => void;
		onexport: () => void;
		header: Snippet;
		children: Snippet;
		extra?: Snippet;
		toolbar?: Snippet;
		loading?: boolean;
		class?: string;
	}

	let { mode, totalCount, selectedCount, onclose, onexport, header, children, extra, toolbar, loading = false, class: className = '' }: Props = $props();

	const modeLabels: Record<string, { icon: typeof Download; title: string; action: string }> = {
		download: { icon: Download, title: 'Export CSV', action: 'Download' },
		copy: { icon: Copy, title: 'Copy CSV', action: 'Copy' },
		dinobox: { icon: Download, title: 'Export CSV', action: 'Send' },
	};

	const config = $derived(modeLabels[mode] ?? modeLabels.download);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
	onmousedown={(e) => { if (e.target === e.currentTarget) onclose(); }}
>
	<div class="bg-page border border-border-card rounded-card shadow-xl max-h-[80vh] max-md:max-h-[85dvh] max-md:max-w-[calc(100vw-1.5rem)] flex flex-col {className}">
		<div class="flex items-center justify-between px-5 py-4 border-b border-border-card">
			<div class="flex items-center gap-2">
				<config.icon size={16} class="text-text-primary" />
				<span class="font-bold text-[15px] text-text-primary tracking-[-0.4px]">{config.title}</span>
			</div>
			<button
				class="text-text-tertiary hover:text-text-primary cursor-pointer"
				onclick={onclose}
			>
				<X size={16} />
			</button>
		</div>
		<div class="px-5 py-4 flex flex-col gap-3 overflow-y-auto {loading ? 'opacity-60 pointer-events-none' : ''}">
			<!-- On mobile the table keeps its column widths and scrolls sideways as a whole. -->
			<div class="border border-border-card rounded-input overflow-hidden max-md:overflow-auto flex flex-col max-h-[300px]">
				<div class="flex items-center border-b border-border-card bg-surface text-sm shrink-0 max-md:min-w-[640px] max-md:sticky max-md:top-0 max-md:z-10">
					{@render header()}
				</div>
				<div class="overflow-y-auto max-md:overflow-visible max-md:min-w-[640px]">
					{@render children()}
				</div>
			</div>
			{#if extra}
				{@render extra()}
			{/if}
		</div>
		<div class="flex max-md:flex-wrap items-center justify-between max-md:gap-2 px-5 py-4 border-t border-border-card">
			<div class="flex max-md:flex-wrap items-center gap-3">
				{#if toolbar}
					{@render toolbar()}
				{/if}
				<span class="text-sm text-text-dim tracking-[-0.3px]">
					{selectedCount} of {totalCount} selected
				</span>
			</div>
			<div class="flex items-center gap-2">
				<button
					class="px-3 py-1.5 text-sm font-medium text-text-dim hover:bg-surface rounded-tag cursor-pointer"
					onclick={onclose}
				>
					Cancel
				</button>
				<button
					class="px-3 py-1.5 text-sm font-medium bg-accent text-white rounded-tag cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
					disabled={selectedCount === 0 || loading}
					onclick={onexport}
				>
					{config.action} ({selectedCount})
				</button>
			</div>
		</div>
	</div>
</div>
