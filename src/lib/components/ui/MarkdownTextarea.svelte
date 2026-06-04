<script lang="ts">
	import { Bold, Italic, List, Code, Link, Heading, Quote } from 'lucide-svelte';

	interface Props {
		id?: string;
		value: string;
		onchange: (value: string) => void;
		placeholder?: string;
		rows?: number;
		variant?: 'default' | 'internal';
		class?: string;
	}

	let {
		id,
		value,
		onchange,
		placeholder = '',
		rows = 4,
		variant = 'default',
		class: className = ''
	}: Props = $props();

	let textareaEl: HTMLTextAreaElement | undefined = $state();

	function wrap(before: string, after: string) {
		if (!textareaEl)
			return;
		const start = textareaEl.selectionStart;
		const end = textareaEl.selectionEnd;
		const selected = value.slice(start, end);
		const replacement = `${before}${selected || 'text'}${after}`;
		const updated = value.slice(0, start) + replacement + value.slice(end);
		onchange(updated);
		requestAnimationFrame(() => {
			if (!textareaEl)
				return;
			const newStart = start + before.length;
			const newEnd = selected ? newStart + selected.length : newStart + 4;
			textareaEl.focus();
			textareaEl.setSelectionRange(newStart, newEnd);
		});
	}

	function prefix(pfx: string) {
		if (!textareaEl)
			return;
		const start = textareaEl.selectionStart;
		const lineStart = value.lastIndexOf('\n', start - 1) + 1;
		const updated = value.slice(0, lineStart) + pfx + value.slice(lineStart);
		onchange(updated);
		requestAnimationFrame(() => {
			if (!textareaEl)
				return;
			textareaEl.focus();
			textareaEl.setSelectionRange(start + pfx.length, start + pfx.length);
		});
	}

	const actions: Array<{ icon: typeof Bold; title: string; action: () => void }> = [
		{ icon: Bold, title: 'Bold', action: () => wrap('**', '**') },
		{ icon: Italic, title: 'Italic', action: () => wrap('_', '_') },
		{ icon: Code, title: 'Code', action: () => wrap('`', '`') },
		{ icon: Heading, title: 'Heading', action: () => prefix('## ') },
		{ icon: Quote, title: 'Quote', action: () => prefix('> ') },
		{ icon: List, title: 'List', action: () => prefix('- ') },
		{ icon: Link, title: 'Link', action: () => wrap('[', '](url)') }
	];
</script>

<div class="flex flex-col rounded-section overflow-hidden border {variant === 'internal' ? 'border-dashed border-accent' : 'border-border-input'} {className}">
	<textarea
		{id}
		bind:this={textareaEl}
		{value}
		oninput={(e) => onchange(e.currentTarget.value)}
		{placeholder}
		{rows}
		class="px-3.5 py-3 text-sm bg-transparent resize-y outline-none {variant === 'internal' ? 'bg-accent-bg-warm' : 'bg-white'}"
	></textarea>
	<div class="flex items-center gap-0.5 px-2.5 py-1.5 border-t {variant === 'internal' ? 'border-accent/30 bg-accent-bg-warm' : 'border-border-input bg-surface/50'}">
		{#each actions as act (act.title)}
			<button
				type="button"
				tabindex={-1}
				class="size-7 flex items-center justify-center rounded-tag text-text-tertiary hover:text-text-primary hover:bg-surface transition-colors cursor-pointer"
				title={act.title}
				onclick={act.action}
			>
				<act.icon size={14} />
			</button>
		{/each}
		<span class="ml-auto text-[11px] text-text-tertiary">Markdown</span>
	</div>
</div>
