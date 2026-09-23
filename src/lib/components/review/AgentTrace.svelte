<script lang="ts">
	import { Lightbulb, MessageSquare, Wrench, ChevronRight, CircleAlert } from 'lucide-svelte';
	import type { TraceStep } from '$lib/server/protocol/types.js';
	import { renderSafeMarkdown } from '$lib/utils/markdown.js';

	interface Props {
		steps: TraceStep[];
	}

	let { steps }: Props = $props();

	let open = $state<Record<number, boolean>>({});

	function pretty(value: unknown): string {
		if (typeof value === 'string') return value;
		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return String(value);
		}
	}

	// A one-line glimpse of a call's input for the folded row, so a reviewer
	// can scan which file or query each call was about without opening it.
	function preview(value: unknown): string {
		if (value === undefined || value === null) return '';
		const text = typeof value === 'string' ? value : JSON.stringify(value);
		const flat = (text ?? '').replace(/\s+/g, ' ').trim();
		return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat;
	}

	function duration(ms: number): string {
		return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
	}
</script>

{#snippet markdown(text: string, muted: boolean)}
	<div class="prose prose-sm max-w-none text-sm tracking-[-0.3px] break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 {muted ? 'text-text-secondary' : ''}">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html renderSafeMarkdown(text)}
	</div>
{/snippet}

{#snippet payload(label: string, value: unknown, error: boolean)}
	<div class="flex flex-col gap-1 min-w-0">
		<p class="text-xs font-medium text-text-secondary tracking-[-0.2px]">{label}</p>
		<pre class="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words bg-white border rounded-tag px-3 py-2 max-h-72 overflow-auto {error ? 'border-check-fail/40 text-check-fail' : 'border-border-card text-text-input'}">{pretty(value)}</pre>
	</div>
{/snippet}

<ol class="flex flex-col relative">
	{#each steps as step, i (i)}
		<li class="flex gap-2.5 min-w-0 pb-3 last:pb-0 relative">
			{#if i < steps.length - 1}
				<div class="absolute left-[9.5px] top-5 bottom-0 w-px bg-border-card"></div>
			{/if}
			<!-- Centred on the step's first line: a tool call's row is exactly the
			     circle's height, a thought's first line of prose is 4px taller. -->
			<div class="size-5 shrink-0 flex items-center justify-center rounded-full bg-white border border-border-card relative z-10 {step.type === 'tool_call' ? '' : 'mt-0.5'}">
				{#if step.type === 'thought'}
					<Lightbulb size={11} class="text-text-secondary" />
				{:else if step.type === 'text'}
					<MessageSquare size={11} class="text-text-secondary" />
				{:else if step.isError}
					<CircleAlert size={11} class="text-check-fail" />
				{:else}
					<Wrench size={11} class="text-accent" />
				{/if}
			</div>

			<div class="flex flex-col gap-2 flex-1 min-w-0">
				{#if step.type === 'thought'}
					{@render markdown(step.text, true)}
				{:else if step.type === 'text'}
					{@render markdown(step.text, false)}
				{:else}
					{@const hasBody = step.input !== undefined || step.output !== undefined}
					<button
						type="button"
						class="flex items-center gap-2 min-w-0 h-5 text-left rounded-tag outline-none focus-visible:ring-2 focus-visible:ring-accent/40 {hasBody ? 'cursor-pointer' : 'cursor-default'}"
						disabled={!hasBody}
						aria-expanded={hasBody ? !!open[i] : undefined}
						onclick={() => (open[i] = !open[i])}
					>
						<code class="text-xs font-mono font-bold shrink-0 {step.isError ? 'text-check-fail' : 'text-text-primary'}">{step.name}</code>
						<span class="text-xs font-mono text-text-tertiary truncate min-w-0">{preview(step.input)}</span>
						<span class="ml-auto flex items-center gap-1.5 shrink-0">
							{#if step.durationMs !== undefined}
								<span class="text-[11px] text-text-tertiary tabular-nums">{duration(step.durationMs)}</span>
							{/if}
							{#if hasBody}
								<ChevronRight size={12} class="text-text-secondary transition-transform {open[i] ? 'rotate-90' : ''}" />
							{/if}
						</span>
					</button>
					{#if open[i]}
						{#if step.input !== undefined}
							{@render payload('Input', step.input, false)}
						{/if}
						{#if step.output !== undefined}
							{@render payload(step.isError ? 'Error' : 'Output', step.output, !!step.isError)}
						{/if}
					{/if}
				{/if}
			</div>
		</li>
	{/each}
</ol>
