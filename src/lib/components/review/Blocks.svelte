<script lang="ts">
	import { Eye, Info, CircleCheck, AlertTriangle, CircleX } from 'lucide-svelte';
	import type { Block } from '$lib/server/protocol/types.js';
	import { renderSafeMarkdown, isSafeImageUrl } from '$lib/utils/markdown.js';

	interface Props {
		blocks: Block[];
		// The styling for blocks that don't set `isInternal` themselves (a
		// system event's blocks inherit the event's).
		internal?: boolean;
		class?: string;
	}

	let { blocks, internal = false, class: className = '' }: Props = $props();

	const CALLOUT_TONES = {
		info: { box: 'bg-sky-50 border-sky-200 text-sky-950', icon: 'text-sky-600' },
		success: { box: 'bg-emerald-50 border-emerald-200 text-emerald-950', icon: 'text-check-pass' },
		warning: { box: 'bg-amber-50 border-amber-200 text-amber-950', icon: 'text-amber-600' },
		danger: { box: 'bg-red-50 border-red-200 text-red-950', icon: 'text-check-fail' }
	} as const;

	function boxClass(block: Block): string {
		return (block.isInternal ?? internal)
			? 'bg-accent-bg-warm border border-dashed border-accent'
			: 'bg-surface';
	}
</script>

{#snippet markdown(text: string)}
	<div class="prose prose-sm max-w-none text-sm tracking-[-0.3px] break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html renderSafeMarkdown(text)}
	</div>
{/snippet}

<!-- A section or image title is a quiet label over its content, so a body
     that opens with something bold (a name, a verdict) is the only bold line
     in the box. A callout's title sits beside its icon and stays bold. -->
{#snippet label(title: string | undefined, block: Block)}
	{#if title}
		<p class="text-xs font-medium text-text-secondary tracking-[-0.2px] flex items-center gap-1.5">
			{title}
			{#if block.isInternal && !internal}
				<Eye size={11} class="text-accent" />
			{/if}
		</p>
	{/if}
{/snippet}

{#snippet heading(title: string | undefined, block: Block)}
	{#if title}
		<p class="font-bold text-sm tracking-[-0.3px] flex items-center gap-1.5">
			{title}
			{#if block.isInternal && !internal}
				<Eye size={12} class="text-accent" />
			{/if}
		</p>
	{/if}
{/snippet}

{#if blocks.length > 0}
	<div class="flex flex-col gap-1.5 w-full {className}">
		{#each blocks as block, i (i)}
			{#if block.type === 'section'}
				<!-- The thumbnail leads, so on a wide timeline it sits beside the text it
				     illustrates instead of at the far edge of the row. -->
				<div class="{boxClass(block)} rounded-tag px-3.5 py-2.5 flex gap-3.5 min-w-0">
					{#if isSafeImageUrl(block.accessory?.imageUrl)}
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a href={block.accessory.imageUrl} target="_blank" rel="noopener noreferrer" class="shrink-0 self-start">
							<img
								src={block.accessory.imageUrl}
								alt={block.accessory.alt}
								loading="lazy"
								class="w-16 max-h-24 rounded-tag object-contain"
							/>
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{/if}
					<div class="flex flex-col gap-1 flex-1 min-w-0 py-0.5">
						{@render label(block.title, block)}
						{#if block.text}
							{@render markdown(block.text)}
						{/if}
						{#if block.fields && block.fields.length > 0}
							<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm tracking-[-0.3px]">
								{#each block.fields as field, j (j)}
									<dt class="text-text-secondary">{field.label}</dt>
									<dd>{@render markdown(field.value)}</dd>
								{/each}
							</dl>
						{/if}
					</div>
				</div>
			{:else if block.type === 'image'}
				{#if isSafeImageUrl(block.imageUrl)}
					<div class="{boxClass(block)} rounded-tag p-3 flex flex-col gap-1.5 min-w-0">
						{@render label(block.title, block)}
						<img src={block.imageUrl} alt={block.alt} loading="lazy" class="max-h-80 w-auto max-w-full self-start rounded-section object-contain" />
						{#if block.caption}
							<div class="text-text-secondary">{@render markdown(block.caption)}</div>
						{/if}
					</div>
				{/if}
			{:else if block.type === 'context'}
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary tracking-[-0.24px] px-0.5">
					{#each block.elements as el, j (j)}
						{#if el.type === 'image'}
							{#if isSafeImageUrl(el.imageUrl)}
								<img src={el.imageUrl} alt={el.alt} class="size-4 rounded-full object-cover" />
							{/if}
						{:else}
							<span class="[&_p]:inline [&_.prose]:text-xs">{@render markdown(el.text)}</span>
						{/if}
					{/each}
				</div>
			{:else if block.type === 'callout'}
				{@const tone = CALLOUT_TONES[block.tone] ?? CALLOUT_TONES.info}
				<div class="border rounded-tag p-3 flex gap-2 min-w-0 {tone.box}">
					<div class="shrink-0 mt-0.5 {tone.icon}">
						{#if block.tone === 'success'}
							<CircleCheck size={16} />
						{:else if block.tone === 'warning'}
							<AlertTriangle size={16} />
						{:else if block.tone === 'danger'}
							<CircleX size={16} />
						{:else}
							<Info size={16} />
						{/if}
					</div>
					<div class="flex flex-col gap-1 flex-1 min-w-0">
						{@render heading(block.title, block)}
						{@render markdown(block.text)}
					</div>
				</div>
			{:else if block.type === 'divider'}
				<hr class="border-border-card my-1" />
			{/if}
		{/each}
	</div>
{/if}
