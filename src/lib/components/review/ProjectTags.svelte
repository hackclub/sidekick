<script lang="ts">
	import type { ProjectTag } from '$lib/server/protocol/types.js';
	import { normalizeTagColor, normalizeTags } from '$lib/utils/tags.js';

	interface Props {
		tags: ProjectTag[] | undefined;
		class?: string;
	}

	let { tags, class: className = '' }: Props = $props();

	const valid = $derived(normalizeTags(tags));
</script>

{#if valid.length > 0}
	<div class="flex flex-wrap items-center gap-1 {className}">
		{#each valid as tag (tag.label)}
			{@const c = normalizeTagColor(tag.color)}
			<span
				class="inline-flex max-w-[180px] items-center truncate rounded-tag border px-1.5 py-0.5 text-[11px] font-medium leading-none tracking-[-0.2px]"
				style="background: color-mix(in srgb, {c} 14%, white); color: color-mix(in srgb, {c} 78%, black); border-color: color-mix(in srgb, {c} 30%, white);"
				title={tag.label}
			>
				{tag.label}
			</span>
		{/each}
	</div>
{/if}
