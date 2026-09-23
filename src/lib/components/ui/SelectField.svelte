<script lang="ts">
	import { ChevronDown, Check } from 'lucide-svelte';
	import type { ReviewFieldOption } from '$lib/server/protocol/types.js';
	import { isSafeImageUrl } from '$lib/utils/markdown.js';

	interface Props {
		id: string;
		options: ReviewFieldOption[];
		value: string;
		placeholder?: string;
		onchange: (value: string) => void;
	}

	let { id, options, value, placeholder = 'Choose…', onchange }: Props = $props();

	let open = $state(false);
	let upward = $state(false);
	let activeIndex = $state(-1);
	let root = $state<HTMLElement | null>(null);
	let list = $state<HTMLElement | null>(null);

	const selected = $derived(options.find((o) => o.value === value) ?? null);

	// Groups in the order they first occur; ungrouped options keep their own
	// position as a heading-less run.
	const sections = $derived.by(() => {
		const out: Array<{ group: string | null; items: Array<{ option: ReviewFieldOption; index: number }> }> = [];
		options.forEach((option, index) => {
			const group = option.group ?? null;
			const last = out[out.length - 1];
			const existing = group === null ? (last?.group === null ? last : null) : out.find((s) => s.group === group);
			if (existing) existing.items.push({ option, index });
			else out.push({ group, items: [{ option, index }] });
		});
		return out;
	});

	// Keyboard order follows what is on screen, which may differ from the
	// wire order once groups pull their options together.
	const visualOrder = $derived(sections.flatMap((s) => s.items.map((i) => i.index)));

	const MENU_MAX_HEIGHT = 360;

	// The menu opens downward unless whatever clips it (the nearest ancestor
	// that hides overflow, else the viewport) leaves too little room below and
	// more above. Review forms live in an overflow-hidden card, and the field
	// often sits near its bottom.
	function clipBounds(): { top: number; bottom: number } {
		for (let el = root?.parentElement; el; el = el.parentElement) {
			if (getComputedStyle(el).overflowY !== 'visible') {
				const box = el.getBoundingClientRect();
				return { top: Math.max(0, box.top), bottom: Math.min(window.innerHeight, box.bottom) };
			}
		}
		return { top: 0, bottom: window.innerHeight };
	}

	function toggle() {
		open = !open;
		if (!open) return;
		activeIndex = Math.max(0, options.findIndex((o) => o.value === value));
		const box = root?.getBoundingClientRect();
		if (!box) return;
		const clip = clipBounds();
		const below = clip.bottom - box.bottom;
		upward = below < MENU_MAX_HEIGHT && box.top - clip.top > below;
	}

	function choose(option: ReviewFieldOption) {
		onchange(option.value);
		open = false;
	}

	function move(step: number) {
		const pos = visualOrder.indexOf(activeIndex);
		const next = visualOrder[Math.min(visualOrder.length - 1, Math.max(0, pos + step))];
		if (next !== undefined) activeIndex = next;
		list?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			e.preventDefault();
			open = false;
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (!open) toggle();
			else move(e.key === 'ArrowDown' ? 1 : -1);
		} else if ((e.key === 'Enter' || e.key === ' ') && open && activeIndex >= 0) {
			e.preventDefault();
			choose(options[activeIndex]);
		}
	}

	function onWindowClick(e: MouseEvent) {
		if (root && !root.contains(e.target as Node)) open = false;
	}

	$effect(() => {
		if (!open) return;
		window.addEventListener('click', onWindowClick, true);
		return () => window.removeEventListener('click', onWindowClick, true);
	});
</script>

{#snippet optionBody(option: ReviewFieldOption)}
	{#if isSafeImageUrl(option.imageUrl)}
		<img src={option.imageUrl} alt="" loading="lazy" class="w-8 h-10 rounded-[4px] object-contain shrink-0" />
	{/if}
	<span class="flex flex-col min-w-0 text-left">
		<span class="text-sm font-medium tracking-[-0.3px] truncate">{option.label}</span>
		{#if option.description}
			<span class="text-xs text-text-secondary tracking-[-0.24px] truncate">{option.description}</span>
		{/if}
	</span>
{/snippet}

<div class="relative w-full" bind:this={root}>
	<button
		{id}
		type="button"
		class="w-full flex items-center gap-2.5 border border-border-input rounded-section px-3 py-2 bg-white text-left outline-none focus:border-accent transition-colors cursor-pointer min-h-[42px]"
		aria-haspopup="listbox"
		aria-expanded={open}
		onclick={toggle}
		{onkeydown}
	>
		{#if selected}
			{@render optionBody(selected)}
		{:else}
			<span class="text-sm text-text-placeholder">{placeholder}</span>
		{/if}
		<ChevronDown size={14} class="ml-auto shrink-0 text-text-secondary transition-transform {open ? 'rotate-180' : ''}" />
	</button>

	{#if open}
		<div
			bind:this={list}
			role="listbox"
			aria-labelledby={id}
			class="absolute {upward ? 'bottom-full mb-1' : 'top-full mt-1'} left-0 right-0 bg-page border border-border-card rounded-input shadow-lg z-30 max-h-[360px] overflow-y-auto py-1"
		>
			{#each sections as section, s (section.group ?? `ungrouped-${s}`)}
				{#if section.group}
					<div class="px-3 pt-2 pb-1 text-xs font-medium text-text-secondary tracking-[-0.2px] {s > 0 ? 'border-t border-border-table mt-1' : ''}">
						{section.group}
					</div>
				{/if}
				{#each section.items as { option, index } (option.value)}
					<button
						type="button"
						role="option"
						aria-selected={option.value === value}
						data-index={index}
						class="w-full flex items-center gap-2.5 px-3 py-1.5 cursor-pointer {index === activeIndex ? 'bg-surface' : ''} hover:bg-surface"
						onmouseenter={() => (activeIndex = index)}
						onclick={() => choose(option)}
					>
						{@render optionBody(option)}
						{#if option.value === value}
							<Check size={14} class="ml-auto shrink-0 text-accent" />
						{/if}
					</button>
				{/each}
			{/each}
		</div>
	{/if}
</div>
