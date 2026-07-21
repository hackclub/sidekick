<script lang="ts">
	import NamedLink from '$lib/components/ui/NamedLink.svelte';
	import ProjectTags from '$lib/components/review/ProjectTags.svelte';
	import { Globe, BookMarked, Copy, Check } from 'lucide-svelte';
	import { isUuid, shortenId } from '$lib/utils/id';
	import type { ProjectDetailsExport } from '$lib/review/projectDetailsExport.js';
	import type { ProjectTag } from '$lib/server/protocol/types.js';
	import type { Snippet } from 'svelte';

	interface Props {
		id: string;
		title: string;
		description: string;
		screenshotUrl?: string | null;
		demoUrl: string;
		codeUrl: string;
		tags?: ProjectTag[];
		/** Rendered inline after the tag pills — e.g. an "add tag" control. */
		tagPicker?: Snippet;
		/** Full project review payload, copied to the clipboard as JSON. */
		details?: ProjectDetailsExport | null;
		class?: string;
	}

	let { id, title, description, screenshotUrl = null, demoUrl, codeUrl, tags = [], tagPicker = undefined, details = null, class: className = '' }: Props = $props();

	let lightboxOpen = $state(false);
	let copied = $state(false);

	async function copyDetails() {
		if (!details) return;
		const payload = { ...details, exportedAt: new Date().toISOString() };
		await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<div class="border border-border-card rounded-card shadow-card p-10 flex flex-col gap-3 {className}">
	<div class="flex flex-col gap-4">
		<div class="flex items-start gap-3">
			{#if screenshotUrl}
				<button class="cursor-zoom-in shrink-0" onclick={() => (lightboxOpen = true)}>
					<img src={screenshotUrl} alt="Project screenshot" class="rounded-section w-full max-w-[243px] h-auto object-cover" />
				</button>
			{/if}

			{#if details}
				<button
					onclick={copyDetails}
					title="Copy all project details as JSON"
					class="shrink-0 ml-auto border border-border-button rounded-md flex gap-1.5 h-8 items-center justify-center px-3 hover:bg-surface transition-colors cursor-pointer"
				>
					{#if copied}
						<Check size={14} class="text-check-pass" />
						<span class="font-medium text-sm text-text-subtle tracking-[-0.3px]">Copied</span>
					{:else}
						<Copy size={14} />
						<span class="font-medium text-sm text-text-subtle tracking-[-0.3px]">Copy JSON</span>
					{/if}
				</button>
			{/if}
		</div>

		<div class="flex flex-col gap-2">
			<div class="flex gap-1.5 items-end text-[24px] tracking-[-0.72px]">
				<span class="text-text-secondary" title={isUuid(id) ? id : undefined}>#{shortenId(id)}</span>
				<span class="font-bold text-text-primary">{title}</span>
			</div>
			{#if tags.length > 0 || tagPicker}
				<div class="flex flex-wrap items-center gap-1">
					<ProjectTags {tags} />
					{@render tagPicker?.()}
				</div>
			{/if}
			<p class="text-sm text-text-primary tracking-[-0.3px] leading-[1.3] whitespace-pre-line">
				{description}
			</p>
		</div>
	</div>

	<div class="flex flex-col gap-2">
		<NamedLink name="Demo URL" url={demoUrl}>
			{#snippet icon()}<Globe size={14} />{/snippet}
		</NamedLink>
		<NamedLink name="Repo URL" url={codeUrl}>
			{#snippet icon()}<BookMarked size={14} />{/snippet}
		</NamedLink>
	</div>
</div>

{#if lightboxOpen && screenshotUrl}
	<button
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 cursor-zoom-out backdrop-blur-sm"
		onclick={() => (lightboxOpen = false)}
		onkeydown={(e) => { if (e.key === 'Escape') lightboxOpen = false; }}
	>
		<img
			src={screenshotUrl}
			alt="Project screenshot"
			class="max-w-[90vw] max-h-[90vh] object-contain rounded-section shadow-2xl"
		/>
	</button>
{/if}
