<script lang="ts">
	import { untrack } from 'svelte';
	import {
		FileArchive,
		LoaderCircle,
		TriangleAlert,
		Upload,
		X,
		ChevronDown,
		ChevronRight
	} from 'lucide-svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
	import LocalHistoryEntry from './LocalHistoryEntry.svelte';
	import {
		HISTORY_ENTRY_CAP,
		baseName,
		type HistoryAnalysis,
		type HistorySession,
		type LocalHistory
	} from '$lib/review/localHistory.js';

	interface Props {
		history: LocalHistory | null;
		analysis: HistoryAnalysis | null;
		/** The analysis only covers the selected day until all heartbeats load. */
		partial?: boolean;
		parsing?: boolean;
		parseError?: string | null;
		currentDate: string;
		timezone: string;
		/** Entry to expand and scroll to (e.g. clicked on the graph). */
		focusKey?: string | null;
		onupload: (file: File) => void;
		onclear: () => void;
		onselectday: (date: string) => void;
	}

	let {
		history,
		analysis,
		partial = false,
		parsing = false,
		parseError = null,
		currentDate,
		timezone,
		focusKey = null,
		onupload,
		onclear,
		onselectday
	}: Props = $props();

	const LIST_LIMIT = 300;
	const HISTORY_FOLDER_HINT = [
		'Windows: %APPDATA%\\Code\\User\\History',
		'macOS: ~/Library/Application Support/Code/User/History',
		'Linux: ~/.config/Code/User/History'
	].join('\n');

	let fileInput = $state<HTMLInputElement>();
	let dragOver = $state(false);
	let scope = $state<'day' | 'all'>('day');
	let includeOtherFiles = $state(false);
	let expanded = $state<Record<string, boolean>>({});
	let showAllFlags = $state(false);
	let showUnmatchedWrites = $state(false);
	let showOtherFiles = $state(false);

	// Only reacts to a new focus request, so switching scope afterwards sticks.
	$effect(() => {
		const key = focusKey;
		if (!key) return;
		untrack(() => {
			const entry = history?.entries.find((e) => e.key === key);
			if (!entry) return;
			expanded[key] = true;
			if (scope === 'day' && dayOf(entry.timestamp) !== currentDate) scope = 'all';
			if (analysis && !analysis.matchedFileKeys.has(entry.fileKey)) includeOtherFiles = true;
		});
	});

	function dayOf(t: number): string {
		return new Date(t).toLocaleDateString('sv-SE', { timeZone: timezone });
	}

	function formatDuration(ms: number): string {
		const m = Math.round(ms / 60000);
		if (m < 60) return `${m}m`;
		const h = Math.floor(m / 60);
		return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
	}

	function formatClock(t: number): string {
		return new Date(t).toLocaleTimeString('en-US', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: timezone
		});
	}

	function formatDay(t: number): string {
		return new Date(t).toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			timeZone: timezone
		});
	}

	function handleFiles(files: FileList | null | undefined) {
		const file = files?.[0];
		if (file) onupload(file);
	}

	const fileByKey = $derived(new Map((history?.files ?? []).map((f) => [f.key, f])));

	const projectEntries = $derived(analysis?.projectEntries ?? []);
	const aiCount = $derived(projectEntries.filter((e) => e.kind === 'ai').length);
	const flagged = $derived(analysis?.flaggedSessions ?? []);
	const missingFlags = $derived(flagged.filter((s) => s.flag === 'missing'));
	const missingMs = $derived(missingFlags.reduce((sum, s) => sum + s.durationMs, 0));
	const matchedFileCount = $derived(analysis?.matchedFileKeys.size ?? 0);
	const cappedMatched = $derived(
		(history?.files ?? []).filter((f) => f.capped && analysis?.matchedFileKeys.has(f.key))
	);

	const listedEntries = $derived.by(() => {
		if (!history) return [];
		const source = includeOtherFiles ? history.entries : projectEntries;
		const scoped =
			scope === 'day' ? source.filter((e) => dayOf(e.timestamp) === currentDate) : source;
		return [...scoped].reverse();
	});

	const sortedFlags = $derived([...flagged].sort((a, b) => b.start - a.start));
	const visibleFlags = $derived(showAllFlags ? sortedFlags : sortedFlags.slice(0, 5));

	const otherFiles = $derived(
		(history?.files ?? []).filter((f) => !analysis?.matchedFileKeys.has(f.key))
	);

	function flagFiles(s: HistorySession): string {
		const names = [...new Set(s.entities.map(baseName))];
		return names.length > 3
			? `${names.slice(0, 3).join(', ')} +${names.length - 3}`
			: names.join(', ');
	}

	function pct(n: number, d: number): string {
		return d === 0 ? '—' : `${Math.round((n / d) * 100)}%`;
	}
</script>

<input
	bind:this={fileInput}
	type="file"
	accept=".zip,application/zip"
	class="hidden"
	onchange={(e) => {
		handleFiles((e.currentTarget as HTMLInputElement).files);
		(e.currentTarget as HTMLInputElement).value = '';
	}}
/>

{#if !history}
	<div class="px-6 py-6">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="flex flex-col items-center gap-3 rounded-section border-2 border-dashed px-6 py-10 text-center transition-colors
				{dragOver ? 'border-accent bg-accent-bg' : 'border-border-card'}"
			ondragover={(e) => {
				e.preventDefault();
				dragOver = true;
			}}
			ondragleave={() => (dragOver = false)}
			ondrop={(e) => {
				e.preventDefault();
				dragOver = false;
				handleFiles(e.dataTransfer?.files);
			}}
		>
			{#if parsing}
				<LoaderCircle size={24} class="animate-spin text-text-tertiary" />
				<span class="text-[13px] text-text-secondary">Reading history…</span>
			{:else}
				<FileArchive size={24} class="text-text-tertiary" />
				<span
					class="text-[14px] font-semibold text-text-primary"
					title={HISTORY_FOLDER_HINT}
				>
					Drop a zipped VS Code History folder
				</span>
				<button
					type="button"
					class="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-tag cursor-pointer bg-page border border-border-card text-text-primary hover:border-accent/50"
					onclick={() => fileInput?.click()}
				>
					<Upload size={13} />
					Choose zip
				</button>
			{/if}
			{#if parseError}
				<div
					class="border border-check-fail/30 bg-check-fail/5 rounded-tag px-3 py-2 text-[12px] text-check-fail"
				>
					{parseError}
				</div>
			{/if}
		</div>
	</div>
{:else}
	<div class="flex items-center gap-2 px-6 py-2.5 border-b border-border-card">
		<FileArchive size={14} class="text-text-tertiary shrink-0" />
		<span class="text-[12px] font-mono text-text-primary truncate">{history.fileName}</span>
		<span class="text-[11px] text-text-tertiary shrink-0">
			{history.files.length} file{history.files.length === 1 ? '' : 's'} · {history.entries.length} snapshot{history
				.entries.length === 1
				? ''
				: 's'}
		</span>
		{#if partial}
			<span class="flex items-center gap-1 text-[11px] text-text-tertiary shrink-0">
				<LoaderCircle size={11} class="animate-spin" /> loading all heartbeats…
			</span>
		{/if}
		<div class="ml-auto flex items-center gap-2 shrink-0">
			<button
				type="button"
				class="flex items-center gap-1 text-[11px] px-2 py-1 rounded-tag cursor-pointer bg-page border border-border-card text-text-secondary hover:text-text-primary"
				onclick={() => fileInput?.click()}
			>
				<Upload size={12} /> Replace
			</button>
			<button
				type="button"
				class="flex items-center gap-1 text-[11px] px-2 py-1 rounded-tag cursor-pointer bg-page border border-border-card text-text-secondary hover:text-text-primary"
				onclick={onclear}
			>
				<X size={12} /> Remove
			</button>
		</div>
	</div>

	{#if analysis}
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border-card border-b border-border-card">
			<div class="stat">
				<span class="stat-label">Project files in history</span>
				<span class="stat-value"
					>{matchedFileCount}<span class="stat-of"> / {history.files.length}</span></span
				>
				<span class="stat-note">
					{projectEntries.length} snapshot{projectEntries.length === 1 ? '' : 's'}
					{#if analysis.untrackedEntryCount > 0}
						· {analysis.untrackedEntryCount} with no heartbeats nearby
					{/if}
				</span>
			</div>
			<div class="stat">
				<span class="stat-label">AI chat edits</span>
				<span class="stat-value" style={aiCount > 0 ? 'color: #a855f7' : ''}>
					{aiCount}<span class="stat-of"> · {pct(aiCount, projectEntries.length)}</span>
				</span>
				<span class="stat-note">of project snapshots came from a chat edit</span>
			</div>
			<div class="stat">
				<span class="stat-label">Saves found in history</span>
				<span
					class="stat-value"
					class:text-check-fail={analysis.writes.unmatched.length > 0 &&
						analysis.writes.matched / Math.max(1, analysis.writes.total - analysis.writes.pruned) <
							0.5}
				>
					{analysis.writes.matched}<span class="stat-of">
						/ {analysis.writes.total - analysis.writes.pruned}</span
					>
				</span>
				<span class="stat-note">
					Hackatime save heartbeats with a matching snapshot
					{#if analysis.writes.pruned > 0}· {analysis.writes.pruned} pruned{/if}
				</span>
			</div>
			<div class="stat">
				<span class="stat-label">Sessions without history</span>
				<span class="stat-value" class:text-check-fail={missingFlags.length > 0}>
					{missingFlags.length}{#if missingFlags.length > 0}<span class="stat-of">
							· {formatDuration(missingMs)}</span
						>{/if}
				</span>
				<span class="stat-note">
					{#if flagged.length > missingFlags.length}
						+{flagged.length - missingFlags.length} unverifiable (pruned history)
					{:else}
						≥15m of coding with no snapshots
					{/if}
				</span>
			</div>
		</div>

		<div class="flex flex-col gap-2 px-6 py-3 border-b border-border-card">
			{#if matchedFileCount === 0}
				<div class="note note-fail">
					<TriangleAlert size={14} class="shrink-0 mt-px" />
					<span>
						None of the {history.files.length} files in this history match a file from the project's heartbeats.
						Either it's the wrong History folder (or from another machine / editor), or the project was
						never edited in this editor.
					</span>
				</div>
			{/if}
			{#if cappedMatched.length > 0}
				<div class="note note-warn">
					<TriangleAlert size={14} class="shrink-0 mt-px" />
					<span>
						{cappedMatched.length} file{cappedMatched.length === 1 ? '' : 's'} hit VS Code's
						{HISTORY_ENTRY_CAP}-snapshot limit ({cappedMatched
							.slice(0, 3)
							.map((f) => baseName(f.displayPath))
							.join(', ')}{cappedMatched.length > 3 ? '…' : ''}), so older edits to
						{cappedMatched.length === 1 ? 'it' : 'them'} were pruned. Gaps before their oldest snapshot
						are marked as unverifiable rather than missing.
					</span>
				</div>
			{/if}
			{#if analysis.otherEditorHeartbeats > 0}
				<div class="note">
					<span>
						{analysis.otherEditorHeartbeats.toLocaleString('en-US')} heartbeat{analysis.otherEditorHeartbeats ===
						1
							? ''
							: 's'} came from editors that don't write VS Code history and weren't checked.
					</span>
				</div>
			{/if}
			<div class="note">
				<span>
					Local history only records edits made in this editor on this machine; heartbeats from
					another computer won't have snapshots here.
				</span>
			</div>
		</div>

		{#if sortedFlags.length > 0}
			<div class="border-b border-border-card">
				<div class="px-6 pt-3 pb-1.5 text-[12px] font-semibold text-text-primary">
					Coding sessions with no history behind them
				</div>
				<div class="flex flex-col">
					{#each visibleFlags as s (s.start)}
						{@const date = dayOf(s.start)}
						<button
							type="button"
							class="flex items-center gap-3 px-6 py-1.5 text-left cursor-pointer hover:bg-surface/50 transition-colors {date ===
							currentDate
								? 'bg-accent-bg/60'
								: ''}"
							onclick={() => onselectday(date)}
							title="Show this day"
						>
							<TriangleAlert
								size={13}
								class="shrink-0 {s.flag === 'missing' ? 'text-check-fail' : 'text-amber-500'}"
							/>
							<span class="text-[12px] text-text-primary w-[92px] shrink-0"
								>{formatDay(s.start)}</span
							>
							<span class="text-[11px] font-mono text-text-secondary w-[92px] shrink-0">
								{formatClock(s.start)}–{formatClock(s.end)}
							</span>
							<span class="text-[12px] font-semibold w-[52px] shrink-0"
								>{formatDuration(s.durationMs)}</span
							>
							<span class="text-[11px] text-text-secondary shrink-0">
								{s.heartbeatCount} hb · {s.writeCount} save{s.writeCount === 1 ? '' : 's'}
							</span>
							<span class="text-[11px] font-mono text-text-tertiary truncate min-w-0"
								>{flagFiles(s)}</span
							>
							{#if s.flag === 'uncertain'}
								<span class="ml-auto text-[10px] text-amber-600 shrink-0">history pruned</span>
							{/if}
						</button>
					{/each}
				</div>
				{#if sortedFlags.length > 5}
					<button
						type="button"
						class="px-6 py-1.5 text-[11px] text-text-secondary hover:text-text-primary cursor-pointer"
						onclick={() => (showAllFlags = !showAllFlags)}
					>
						{showAllFlags ? 'Show fewer' : `Show all ${sortedFlags.length}`}
					</button>
				{/if}
			</div>
		{/if}
	{/if}

	<div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3 border-b border-border-card">
		<div class="flex items-center gap-1">
			{#each [['day', 'Selected day'], ['all', 'All time']] as [id, label] (id)}
				<button
					class="text-[12px] font-medium rounded-tag px-2.5 py-1 cursor-pointer transition-colors
						{scope === id
						? 'text-accent bg-accent-bg border border-accent'
						: 'text-text-secondary bg-page border border-border-card hover:border-accent/50'}"
					onclick={() => (scope = id as 'day' | 'all')}
				>
					{label}
				</button>
			{/each}
		</div>
		<Checkbox checked={includeOtherFiles} onchange={() => (includeOtherFiles = !includeOtherFiles)}>
			<span class="text-[12px] text-text-secondary leading-[18px] select-none">
				Include files outside the project
			</span>
		</Checkbox>
		<span class="ml-auto text-[11px] text-text-tertiary">
			{listedEntries.length} snapshot{listedEntries.length === 1 ? '' : 's'}
		</span>
	</div>

	{#if listedEntries.length > 0}
		<div class="flex flex-col">
			{#each listedEntries.slice(0, LIST_LIMIT) as entry (entry.key)}
				{@const file = fileByKey.get(entry.fileKey)}
				{#if file}
					<LocalHistoryEntry
						{history}
						{entry}
						{file}
						{timezone}
						showDate={scope === 'all'}
						outsideProject={!analysis?.matchedFileKeys.has(entry.fileKey)}
						expanded={!!expanded[entry.key]}
						highlighted={focusKey === entry.key}
						ontoggle={() => (expanded[entry.key] = !expanded[entry.key])}
					/>
				{/if}
			{/each}
			{#if listedEntries.length > LIST_LIMIT}
				<div class="px-6 py-2 text-[11px] text-text-tertiary">
					Showing the newest {LIST_LIMIT} of {listedEntries.length}.
				</div>
			{/if}
		</div>
	{:else}
		<div class="flex items-center justify-center py-10 text-[12px] text-text-tertiary">
			{scope === 'day' ? 'No history snapshots on this day.' : 'No history snapshots.'}
		</div>
	{/if}

	{#if analysis && analysis.writes.unmatched.length > 0}
		<div class="border-t border-border-card">
			<button
				type="button"
				class="w-full flex items-center gap-1.5 px-6 py-2.5 text-[12px] font-semibold text-text-primary cursor-pointer hover:bg-surface/50"
				onclick={() => (showUnmatchedWrites = !showUnmatchedWrites)}
			>
				{#if showUnmatchedWrites}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
				{analysis.writes.unmatched.length} save heartbeat{analysis.writes.unmatched.length === 1
					? ''
					: 's'} with no snapshot
			</button>
			{#if showUnmatchedWrites}
				<div class="max-h-64 overflow-auto scrollbar-thin px-6 pb-3">
					{#each analysis.writes.unmatched.slice(0, 200) as w, i (i)}
						<div class="flex items-center gap-3 py-0.5 text-[11px]">
							<span class="font-mono text-text-tertiary w-[140px] shrink-0">
								{formatDay(w.time)}
								{formatClock(w.time)}
							</span>
							<span class="font-mono text-text-primary truncate" title={w.entity}>{w.entity}</span>
							{#if w.fileMissing}
								<span class="ml-auto text-text-tertiary shrink-0">file not in history</span>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if otherFiles.length > 0}
		<div class="border-t border-border-card">
			<button
				type="button"
				class="w-full flex items-center gap-1.5 px-6 py-2.5 text-[12px] font-semibold text-text-primary cursor-pointer hover:bg-surface/50"
				onclick={() => (showOtherFiles = !showOtherFiles)}
			>
				{#if showOtherFiles}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
				{otherFiles.length} file{otherFiles.length === 1 ? '' : 's'} in the history outside this project
			</button>
			{#if showOtherFiles}
				<div class="max-h-64 overflow-auto scrollbar-thin px-6 pb-3">
					{#each otherFiles as f (f.key)}
						<div class="flex items-center gap-3 py-0.5 text-[11px]">
							<span class="font-mono text-text-primary truncate" title={f.displayPath}
								>{f.displayPath}</span
							>
							<span class="ml-auto text-text-tertiary shrink-0">{f.entries.length}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
{/if}

<style>
	.stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 24px;
		background: var(--color-page, #fff);
	}

	.stat-label {
		font-size: 11px;
		color: var(--color-text-secondary);
	}

	.stat-value {
		font-size: 20px;
		font-weight: 700;
		letter-spacing: -0.6px;
	}

	.stat-of {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-tertiary);
		letter-spacing: 0;
	}

	.stat-note {
		font-size: 11px;
		color: var(--color-text-tertiary);
		line-height: 1.3;
	}

	.note {
		display: flex;
		gap: 8px;
		font-size: 12px;
		line-height: 1.4;
		color: var(--color-text-secondary);
	}

	.note-fail {
		color: var(--color-check-fail);
	}

	.note-warn {
		color: #b45309;
	}
</style>
