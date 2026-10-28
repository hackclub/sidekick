<script lang="ts">
	import { BadgeQuestionMark, BookMarked, ExternalLink, Globe } from 'lucide-svelte';
	import type { Snippet } from 'svelte';
	import AirtableIcon from '../icons/AirtableIcon.svelte';
	import NamedLink from '../ui/NamedLink.svelte';
	import { isSafeLinkUrl } from '$lib/utils/markdown.js';
	import { programFromId, type AirtableMatch } from '$lib/review/airtable.js';

	interface Props {
		record: AirtableMatch;
		// Compact rows stack several records in one view (the approval warning):
		// a thumbnail beside the title, inline links, and a clamped description.
		compact?: boolean;
		// Extra header controls (the modal's close button). Full layout only.
		actions?: Snippet;
		titleId?: string;
		class?: string;
	}

	let { record, compact = false, actions, titleId, class: className = '' }: Props = $props();

	// The unified ID is "<Program> – <number>"; the program is already the
	// title, so only the number is repeated beneath it.
	const recordNumber = $derived.by(() => {
		const program = programFromId(record.id);
		const rest = record.id.slice(program.length).replace(/^\s*–\s*/, '').trim();
		return rest || null;
	});

	const playableUrl = $derived(isSafeLinkUrl(record.playableUrl) ? record.playableUrl : null);
	const codeUrl = $derived(isSafeLinkUrl(record.codeUrl) ? record.codeUrl : null);

	const stats = $derived([
		{
			label: 'Override hours',
			value: record.overrideHours != null ? fmtHours(record.overrideHours) : 'None',
			muted: record.overrideHours == null,
			sub: null
		},
		{ label: 'Approved', ...dateStat(record.approvedAt) },
		{ label: 'Created', ...dateStat(record.createdAt) }
	]);

	function dateStat(iso: string | null) {
		if (!iso)
			return { value: 'Unknown', muted: true, sub: null };

		const d = new Date(iso);
		return {
			value: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
			muted: false,
			sub: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
		};
	}

	function fmtHours(h: number): string {
		return `${h.toFixed(2).replace(/\.?0+$/, '')}h`;
	}

	function displayUrl(url: string): string {
		return url
			.replace(/^https?:\/\//, '')
			.replace(/^www\./, '')
			.replace(/\/+$/, '');
	}
</script>

{#snippet title()}
	<div class="flex items-baseline gap-2 min-w-0">
		<span id={titleId} class="font-bold text-[15px] text-text-primary tracking-[-0.4px] truncate">{programFromId(record.id)}</span>
		{#if recordNumber}
			<span class="font-mono text-xs text-text-secondary shrink-0" title={record.id}>#{recordNumber}</span>
		{/if}
	</div>
{/snippet}

{#snippet airtableButton()}
	{#if record.url}
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			href={record.url}
			target="_blank"
			rel="noopener noreferrer"
			class="shrink-0 border border-border-button rounded-md flex gap-1.5 h-8 items-center justify-center px-3 hover:bg-surface transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
		>
			<ExternalLink size={14} />
			<span class="font-medium text-sm text-text-subtle tracking-[-0.3px]">Open in Airtable</span>
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/if}
{/snippet}

{#snippet fuzzyNote()}
	{#if !record.isExact}
		<p class="flex items-center gap-1.5 text-xs text-text-secondary tracking-[-0.24px]">
			<BadgeQuestionMark size={13} class="text-check-fail shrink-0" />
			<span>Fuzzy match: didn't match {record.mismatches.join(', ')}</span>
		</p>
	{/if}
{/snippet}

{#snippet statStrip()}
	<!-- Three columns on desktop; label/value rows on mobile, where a third of
	     the width can't fit a full date. -->
	<dl class="grid grid-cols-3 max-md:grid-cols-1 border border-border-card rounded-tag divide-x max-md:divide-x-0 max-md:divide-y divide-border-card">
		{#each stats as stat (stat.label)}
			<div class="flex flex-col max-md:flex-row max-md:items-baseline max-md:justify-between gap-0.5 max-md:gap-3 px-3 py-2 min-w-0">
				<dt class="text-xs text-text-secondary tracking-[-0.24px]">{stat.label}</dt>
				<dd class="text-sm tracking-[-0.3px] tabular-nums truncate {stat.muted ? 'text-text-secondary' : 'font-semibold text-text-primary'}">
					{stat.value}
					{#if stat.sub}
						<span class="block max-md:inline max-md:ml-1 text-[11px] font-normal text-text-secondary">{stat.sub}</span>
					{/if}
				</dd>
			</div>
		{/each}
	</dl>
{/snippet}

{#snippet description()}
	<section class="flex flex-col gap-1">
		<h3 class="text-xs font-medium text-text-secondary tracking-[-0.24px]">Description</h3>
		{#if record.description}
			<p class="text-sm text-text-primary tracking-[-0.3px] leading-[1.4] whitespace-pre-line break-words {compact ? 'line-clamp-3' : ''}" title={compact ? record.description : undefined}>{record.description}</p>
		{:else}
			<p class="text-sm text-text-secondary tracking-[-0.3px]">No description</p>
		{/if}
	</section>
{/snippet}

{#snippet justification()}
	{#if record.overrideHoursJustification}
		<section class="bg-accent-bg-warm border border-dashed border-accent rounded-tag p-3 flex flex-col gap-1 min-w-0">
			<h3 class="text-xs font-medium text-text-subtle tracking-[-0.24px]">Override justification</h3>
			<p class="text-sm text-text-primary tracking-[-0.3px] leading-[1.4] whitespace-pre-line break-words">{record.overrideHoursJustification}</p>
		</section>
	{/if}
{/snippet}

{#if compact}
	<article class="flex flex-col gap-3 {className}">
		<div class="flex max-md:flex-col gap-4">
			{#if record.screenshotUrl}
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					href={record.screenshotUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="shrink-0 w-[168px] max-md:w-full aspect-video max-md:aspect-[5/2] rounded-tag overflow-hidden bg-surface border border-border-card cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
				>
					<img src={record.screenshotUrl} alt="Screenshot submitted with this record" class="w-full h-full object-cover" />
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
			<div class="flex flex-col gap-2.5 flex-1 min-w-0">
				<div class="flex items-center justify-between gap-3">
					{@render title()}
					{@render airtableButton()}
				</div>
				{@render fuzzyNote()}
				{@render statStrip()}
			</div>
		</div>

		{#if playableUrl || codeUrl}
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs tracking-[-0.24px] min-w-0">
				{#if playableUrl}
					<a href={playableUrl} target="_blank" rel="noopener noreferrer" class="flex items-center gap-1.5 min-w-0 text-link hover:underline rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/40" title="Playable URL">
						<Globe size={12} class="shrink-0 text-text-secondary" />
						<span class="truncate">{displayUrl(playableUrl)}</span>
					</a>
				{/if}
				{#if codeUrl}
					<a href={codeUrl} target="_blank" rel="noopener noreferrer" class="flex items-center gap-1.5 min-w-0 text-link hover:underline rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/40" title="Code URL">
						<BookMarked size={12} class="shrink-0 text-text-secondary" />
						<span class="truncate">{displayUrl(codeUrl)}</span>
					</a>
				{/if}
			</div>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}

		{@render description()}
		{@render justification()}
	</article>
{:else}
	<div class="flex flex-col {className}">
		<header class="sticky top-0 z-10 bg-page flex items-center justify-between gap-3 px-5 py-4 border-b border-border-card">
			<div class="flex items-center gap-2.5 min-w-0">
				<AirtableIcon size={18} class="shrink-0" />
				{@render title()}
			</div>
			<div class="flex items-center gap-3 shrink-0">
				{@render airtableButton()}
				{@render actions?.()}
			</div>
		</header>

		<div class="flex flex-col gap-5 px-5 py-5">
			{@render fuzzyNote()}

			{#if record.screenshotUrl}
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					href={record.screenshotUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="block aspect-video rounded-section overflow-hidden bg-surface border border-border-card cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
				>
					<img src={record.screenshotUrl} alt="Screenshot submitted with this record" class="w-full h-full object-contain" />
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}

			{@render statStrip()}

			{#if playableUrl || codeUrl}
				<div class="flex flex-col gap-2">
					{#if playableUrl}
						<NamedLink name="Playable URL" url={playableUrl}>
							{#snippet icon()}<Globe size={14} />{/snippet}
						</NamedLink>
					{/if}
					{#if codeUrl}
						<NamedLink name="Code URL" url={codeUrl}>
							{#snippet icon()}<BookMarked size={14} />{/snippet}
						</NamedLink>
					{/if}
				</div>
			{/if}

			{@render description()}
			{@render justification()}
		</div>
	</div>
{/if}
