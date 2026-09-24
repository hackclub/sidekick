<script lang="ts">
	import { ChevronRight, ChevronDown, LoaderCircle } from 'lucide-svelte';
	import { lineDiff, type LineDiffResult } from '$lib/utils/diff.js';
	import {
		baseName,
		type HistoryEntry,
		type HistoryFile,
		type LocalHistory
	} from '$lib/review/localHistory.js';
	import { HISTORY_KIND_STYLE } from '$lib/review/localHistoryStyle.js';

	interface Props {
		history: LocalHistory;
		entry: HistoryEntry;
		file: HistoryFile;
		timezone: string;
		showDate?: boolean;
		/** Belongs to a file the project's heartbeats never touched. */
		outsideProject?: boolean;
		expanded?: boolean;
		highlighted?: boolean;
		ontoggle?: () => void;
	}

	let {
		history,
		entry,
		file,
		timezone,
		showDate = false,
		outsideProject = false,
		expanded = false,
		highlighted = false,
		ontoggle
	}: Props = $props();

	// A single snapshot adding this many lines is worth a second look (pastes, generated code).
	const LARGE_ADDITION = 150;
	const BASELINE_PREVIEW_LINES = 400;

	const prev = $derived(entry.index > 0 ? file.entries[entry.index - 1] : null);
	const kindStyle = $derived(HISTORY_KIND_STYLE[entry.kind]);

	let diff = $state<LineDiffResult | null>(null);
	let baselineLines = $state<string[] | null>(null);
	let missing = $state(false);
	let loading = $state(false);
	let requested = false;

	async function load() {
		if (requested) return;
		requested = true;
		loading = true;
		try {
			const [cur, before] = await Promise.all([
				history.readContent(entry),
				prev ? history.readContent(prev) : Promise.resolve(null)
			]);
			if (cur === null) {
				missing = true;
				return;
			}
			if (prev && before !== null) diff = lineDiff(before, cur);
			else baselineLines = cur.split(/\r?\n/);
		} finally {
			loading = false;
		}
	}

	function inview(node: HTMLElement) {
		const io = new IntersectionObserver(
			(obs) => {
				if (obs.some((o) => o.isIntersecting)) {
					load();
					io.disconnect();
				}
			},
			{ rootMargin: '200px' }
		);
		io.observe(node);
		return { destroy: () => io.disconnect() };
	}

	let rowEl = $state<HTMLElement>();
	$effect(() => {
		if (highlighted && rowEl) rowEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
	});

	function formatTime(t: number): string {
		return new Date(t).toLocaleString('en-US', {
			...(showDate ? { month: 'short', day: 'numeric' } : {}),
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false,
			timeZone: timezone
		});
	}
</script>

<div
	bind:this={rowEl}
	use:inview
	class="border-b border-border-table last:border-b-0 {highlighted ? 'bg-accent-bg' : ''}"
>
	<button
		type="button"
		class="w-full flex items-start gap-2.5 px-4 py-2 text-left cursor-pointer hover:bg-surface/50 transition-colors"
		onclick={() => {
			load();
			ontoggle?.();
		}}
	>
		<span class="pt-0.5 text-text-tertiary shrink-0">
			{#if expanded}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
		</span>
		<span
			class="text-[11px] font-mono text-text-tertiary shrink-0 pt-px {showDate
				? 'w-[118px]'
				: 'w-[70px]'}"
		>
			{formatTime(entry.timestamp)}
		</span>
		<span
			class="flex items-center justify-center rounded-full w-4 h-4 shrink-0 mt-px"
			style="background-color: {kindStyle.color}"
			title={kindStyle.label}
		>
			<kindStyle.icon size={10} color="white" strokeWidth={2.5} />
		</span>
		<span class="flex flex-col min-w-0 flex-1 gap-0.5">
			<span class="flex items-center gap-2 min-w-0">
				<span class="text-[12px] font-mono text-text-primary truncate" title={file.displayPath}>
					{baseName(file.displayPath)}
				</span>
				{#if outsideProject}
					<span class="text-[10px] text-text-tertiary shrink-0">outside project</span>
				{/if}
				{#if !prev}
					<span
						class="text-[10px] rounded-tag px-1.5 border border-border-card text-text-secondary shrink-0"
						title={file.capped
							? `Oldest retained snapshot — VS Code keeps ${file.entries.length} per file, so earlier ones were pruned`
							: 'First snapshot of this file'}
					>
						{file.capped ? 'oldest retained' : 'first snapshot'}
					</span>
				{/if}
				{#if diff && diff.added >= LARGE_ADDITION}
					<span
						class="text-[10px] font-semibold rounded-tag px-1.5 text-white shrink-0"
						style="background-color: #f59e0b"
						title="{diff.added} lines appeared in one snapshot"
					>
						large addition
					</span>
				{/if}
			</span>
			{#if entry.kind === 'ai'}
				<span
					class="text-[11px] text-text-secondary leading-snug line-clamp-2"
					title={entry.prompt}
				>
					{entry.prompt ?? entry.source}
				</span>
			{:else if entry.kind === 'other'}
				<span class="text-[11px] text-text-secondary truncate">{entry.source}</span>
			{/if}
		</span>
		<span class="text-[11px] font-mono shrink-0 pt-px">
			{#if loading}
				<LoaderCircle size={11} class="animate-spin text-text-tertiary" />
			{:else if missing}
				<span class="text-text-tertiary">no snapshot</span>
			{:else if diff}
				{#if diff.added === 0 && diff.removed === 0}
					<span class="text-text-tertiary">no change</span>
				{:else}
					<span class="text-git-added">+{diff.added}</span>
					<span class="text-git-removed ml-1">−{diff.removed}</span>
				{/if}
			{:else if baselineLines}
				<span class="text-text-tertiary">{baselineLines.length} lines</span>
			{/if}
		</span>
	</button>

	{#if expanded}
		<div class="px-4 pb-3">
			{#if entry.kind === 'ai' && entry.prompt}
				<div
					class="mb-2 rounded-tag border border-dashed px-3 py-2 text-[12px] whitespace-pre-wrap break-words"
					style="border-color: {kindStyle.color}; background: color-mix(in srgb, {kindStyle.color} 6%, transparent);"
				>
					<span class="font-semibold" style="color: {kindStyle.color}">Chat prompt:</span>
					{entry.prompt}
				</div>
			{/if}
			<div
				class="rounded-tag border border-border-card overflow-auto max-h-[480px] scrollbar-thin bg-page"
			>
				{#if loading}
					<div class="flex items-center justify-center py-6 text-text-tertiary">
						<LoaderCircle size={16} class="animate-spin" />
					</div>
				{:else if missing}
					<div class="px-3 py-3 text-[12px] text-text-tertiary">
						The snapshot file for this entry isn't in the zip.
					</div>
				{:else if diff}
					{#if diff.hunks.length === 0}
						<div class="px-3 py-3 text-[12px] text-text-tertiary">
							Identical to the previous snapshot.
						</div>
					{/if}
					<table class="diff w-full">
						<tbody>
							{#each diff.hunks as hunk, h (h)}
								{#if hunk.skippedBefore > 0}
									<tr class="diff-skip">
										<td colspan="3"
											>⋯ {hunk.skippedBefore} unchanged line{hunk.skippedBefore === 1
												? ''
												: 's'}</td
										>
									</tr>
								{/if}
								{#each hunk.ops as op, i (i)}
									<tr class="diff-{op.type}">
										<td class="diff-no">{op.oldNo ?? ''}</td>
										<td class="diff-no">{op.newNo ?? ''}</td>
										<td class="diff-line"
											><span class="diff-sign"
												>{op.type === 'add' ? '+' : op.type === 'remove' ? '−' : ' '}</span
											>{op.line}</td
										>
									</tr>
								{/each}
							{/each}
						</tbody>
					</table>
					{#if diff.approximate}
						<div class="px-3 py-2 text-[11px] text-text-tertiary border-t border-border-card">
							Change too large to align line-by-line; shown as a full replacement.
						</div>
					{/if}
				{:else if baselineLines}
					<div class="px-3 py-1.5 text-[11px] text-text-tertiary border-b border-border-card">
						No earlier snapshot to compare against — showing the file as it was at this point.
					</div>
					<table class="diff w-full">
						<tbody>
							{#each baselineLines.slice(0, BASELINE_PREVIEW_LINES) as line, i (i)}
								<tr class="diff-equal">
									<td class="diff-no">{i + 1}</td>
									<td class="diff-line">{line}</td>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if baselineLines.length > BASELINE_PREVIEW_LINES}
						<div class="px-3 py-2 text-[11px] text-text-tertiary border-t border-border-card">
							{baselineLines.length - BASELINE_PREVIEW_LINES} more lines not shown.
						</div>
					{/if}
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.diff {
		border-collapse: collapse;
		font-family: 'Cascadia Mono', ui-monospace, monospace;
		font-size: 11px;
		line-height: 1.5;
	}

	.diff-no {
		width: 1%;
		padding: 0 6px;
		text-align: right;
		color: var(--color-text-faint);
		user-select: none;
		white-space: nowrap;
		vertical-align: top;
	}

	.diff-line {
		padding: 0 8px 0 4px;
		white-space: pre;
		color: var(--color-text-primary);
	}

	.diff-sign {
		display: inline-block;
		width: 12px;
		user-select: none;
		color: var(--color-text-tertiary);
	}

	.diff-add {
		background: color-mix(in srgb, var(--color-git-added) 10%, transparent);
	}

	.diff-add .diff-sign {
		color: var(--color-git-added);
	}

	.diff-remove {
		background: color-mix(in srgb, var(--color-git-removed) 9%, transparent);
	}

	.diff-remove .diff-sign {
		color: var(--color-git-removed);
	}

	.diff-skip td {
		padding: 2px 8px;
		color: var(--color-text-tertiary);
		background: var(--color-surface);
		font-style: italic;
	}
</style>
