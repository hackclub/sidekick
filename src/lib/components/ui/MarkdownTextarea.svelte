<script lang="ts">
	import { Bold, Italic, List, Code, Link, Heading, Quote } from 'lucide-svelte';
	import { MediaQuery } from 'svelte/reactivity';

	interface Props {
		id?: string;
		value: string;
		onchange: (value: string) => void;
		placeholder?: string;
		rows?: number;
		variant?: 'default' | 'internal';
		class?: string;
		/** On mobile, focusing the field opens it as a full-screen editor with this title. */
		fullscreenTitle?: string;
	}

	let {
		id,
		value,
		onchange,
		placeholder = '',
		rows = 4,
		variant = 'default',
		class: className = '',
		fullscreenTitle
	}: Props = $props();

	let textareaEl: HTMLTextAreaElement | undefined = $state();
	let rootEl: HTMLDivElement | undefined = $state();

	const mobile = new MediaQuery('max-width: 767px');
	let fullscreen = $state(false);

	// The on-screen keyboard shrinks the visual viewport but not the layout
	// viewport iOS positions fixed elements against, so the editor tracks the
	// visual viewport to keep its toolbar above the keyboard.
	let viewportTop = $state(0);
	let viewportHeight: number | null = $state(null);
	let keyboardOpen = $state(false);

	function openFullscreen() {
		if (fullscreenTitle && mobile.current)
			fullscreen = true;
	}

	function closeFullscreen() {
		fullscreen = false;
		textareaEl?.blur();
		requestAnimationFrame(() => rootEl?.scrollIntoView({ block: 'nearest' }));
	}

	$effect(() => {
		if (fullscreen && !mobile.current)
			fullscreen = false;
	});

	$effect(() => {
		if (!fullscreen)
			return;

		const vv = window.visualViewport;
		const sync = () => {
			if (!vv)
				return;
			viewportTop = vv.offsetTop;
			viewportHeight = vv.height;
			keyboardOpen = vv.height < window.innerHeight * 0.85;
		};
		sync();
		vv?.addEventListener('resize', sync);
		vv?.addEventListener('scroll', sync);

		const html = document.documentElement;
		const prevOverflow = html.style.overflow;
		html.style.overflow = 'hidden';

		return () => {
			vv?.removeEventListener('resize', sync);
			vv?.removeEventListener('scroll', sync);
			html.style.overflow = prevOverflow;
			viewportHeight = null;
		};
	});

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

<div
	bind:this={rootEl}
	class="flex flex-col overflow-hidden {fullscreen
		? `fixed inset-x-0 top-0 z-[60] h-dvh pt-[env(safe-area-inset-top)] ${variant === 'internal' ? 'bg-accent-bg-warm' : 'bg-white'}`
		: `rounded-section border ${variant === 'internal' ? 'border-dashed border-accent' : 'border-border-input'}`} {className}"
	style={fullscreen && viewportHeight !== null ? `top: ${viewportTop}px; height: ${viewportHeight}px` : undefined}
	role={fullscreen ? 'dialog' : undefined}
	aria-modal={fullscreen ? 'true' : undefined}
	aria-label={fullscreen ? fullscreenTitle : undefined}
>
	{#if fullscreen}
		<div class="flex items-center gap-3 px-4 py-2.5 shrink-0 border-b {variant === 'internal' ? 'border-accent/30' : 'border-border-input'}">
			<span class="font-bold text-base tracking-[-0.3px] truncate">{fullscreenTitle}</span>
			<button
				type="button"
				class="ml-auto shrink-0 px-3.5 py-1.5 rounded-tag bg-text-primary text-white text-sm font-medium cursor-pointer"
				onmousedown={(e) => e.preventDefault()}
				onclick={closeFullscreen}
			>
				Done
			</button>
		</div>
	{/if}
	<textarea
		{id}
		bind:this={textareaEl}
		{value}
		oninput={(e) => onchange(e.currentTarget.value)}
		onfocus={openFullscreen}
		onkeydown={(e) => {
			if (fullscreen && e.key === 'Escape') {
				e.preventDefault();
				closeFullscreen();
			}
		}}
		{placeholder}
		{rows}
		class="px-3.5 py-3 text-sm bg-transparent outline-none {fullscreen ? 'flex-1 min-h-0 resize-none' : 'resize-y'} {variant === 'internal' ? 'bg-accent-bg-warm' : 'bg-white'}"
	></textarea>
	<div class="flex items-center gap-0.5 px-2.5 pt-1.5 shrink-0 border-t {fullscreen && !keyboardOpen ? 'pb-[max(0.375rem,env(safe-area-inset-bottom))]' : 'pb-1.5'} {variant === 'internal' ? 'border-accent/30 bg-accent-bg-warm' : 'border-border-input bg-surface/50'}">
		{#each actions as act (act.title)}
			<button
				type="button"
				tabindex={-1}
				class="{fullscreen ? 'size-10' : 'size-7'} flex items-center justify-center rounded-tag text-text-tertiary hover:text-text-primary hover:bg-surface transition-colors cursor-pointer"
				title={act.title}
				onmousedown={(e) => e.preventDefault()}
				onclick={act.action}
			>
				<act.icon size={fullscreen ? 18 : 14} />
			</button>
		{/each}
		<span class="ml-auto text-[11px] text-text-tertiary">Markdown</span>
	</div>
</div>
