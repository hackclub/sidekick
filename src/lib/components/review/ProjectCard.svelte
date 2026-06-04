<script lang="ts">
	import NamedLink from '$lib/components/ui/NamedLink.svelte';
	import { Globe, BookMarked } from 'lucide-svelte';

	interface Props {
		id: string;
		title: string;
		description: string;
		screenshotUrl?: string | null;
		demoUrl: string;
		codeUrl: string;
		class?: string;
	}

	let { id, title, description, screenshotUrl = null, demoUrl, codeUrl, class: className = '' }: Props = $props();

	let lightboxOpen = $state(false);
</script>

<div class="border border-border-card rounded-card shadow-card p-10 flex flex-col gap-3 {className}">
	<div class="flex flex-col gap-4">
		{#if screenshotUrl}
			<button class="cursor-zoom-in" onclick={() => (lightboxOpen = true)}>
				<img src={screenshotUrl} alt="Project screenshot" class="rounded-section w-full max-w-[243px] h-auto object-cover" />
			</button>
		{/if}

		<div class="flex flex-col gap-2">
			<div class="flex gap-1.5 items-end text-[24px] tracking-[-0.72px]">
				<span class="text-text-secondary">#{id}</span>
				<span class="font-bold text-text-primary">{title}</span>
			</div>
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
