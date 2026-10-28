<script lang="ts">
	import { BadgeQuestionMark, ChevronRight, Clock } from 'lucide-svelte';
	import AirtableIcon from '../icons/AirtableIcon.svelte';
	import Checkbox from '../ui/Checkbox.svelte';
	import AirtableRecordModal from './AirtableRecordModal.svelte';
	import { programFromId, type AirtableMatch } from '$lib/review/airtable.js';

	interface Props {
		records: AirtableMatch[];
		loading?: boolean;
		countFuzzy?: boolean;
		class?: string;
	}

	let { records, loading = false, countFuzzy = $bindable(false), class: className = '' }: Props = $props();

	const fuzzyRecords = $derived(records.filter((r) => !r.isExact));
	let selected = $state<AirtableMatch | null>(null);

	function shortDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function fmtHours(h: number): string {
		if (h === 0)
			return '0h';

		if (h < 1)
			return `${Math.round(h * 60)}m`;

		return `${h.toFixed(1).replace(/\.0$/, '')}h`;
	}

	function truncateUrl(url: string): string {
		return url
			.replace(/^https?:\/\//, '')
			.replace(/^www\./, '')
			.replace(/\/+$/, '');
	}
</script>

<div class="border border-border-card rounded-card shadow-card overflow-hidden {className}">
	<div class="flex items-center justify-between px-8 max-md:px-4 py-4 border-b border-border-card">
		<div class="flex items-center gap-2">
			<AirtableIcon size={16} class="shrink-0" />

			<span class="text-sm font-semibold text-text-primary tracking-[-0.3px]">
				Airtable Records
			</span>

			{#if !loading}
				<span class="text-xs text-text-tertiary tracking-[-0.24px]">
					({records.length})
				</span>
			{/if}
		</div>
	</div>

	<div class="max-h-[240px] overflow-auto">
		{#if loading}
			<div class="flex flex-col animate-pulse px-8 max-md:px-4 py-4 gap-1">
				<!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
				{#each Array(3) as _, i (i)}
					<div class="flex items-center justify-between h-9 gap-3">
						<div class="flex items-center gap-2">
							<div class="h-3.5 w-14 rounded bg-surface"></div>
							<div class="h-3 w-20 rounded bg-surface"></div>
						</div>
						<div class="h-3 w-10 rounded bg-surface shrink-0"></div>
					</div>
				{/each}
			</div>
		{:else if records.length === 0}
			<div class="px-8 max-md:px-4 py-6">
				<p class="text-sm text-text-tertiary tracking-[-0.3px]">No matching records found</p>
			</div>
		{:else}
			<div class="flex flex-col px-8 max-md:px-4 py-3">
				<!-- The index in the key guards against duplicate records: a key collision
				     throws mid-flush and silently freezes this whole section (records
				     stop rendering and the fuzzy checkbox stops reflecting its state). -->
				{#each records as record, i (`${record.recordId}#${i}`)}
					<button
						type="button"
						onclick={() => (selected = record)}
						class="flex flex-col gap-0.5 py-2.5 border-b border-border-table last:border-b-0 -mx-2 px-2 rounded-tag text-left cursor-pointer hover:bg-surface transition-colors group {record.isExact || countFuzzy ? '' : 'opacity-50'}"
					>
						<div class="flex items-center justify-between gap-3">
							<div class="flex items-center gap-1.5 min-w-0">
								<span class="text-sm tracking-[-0.3px] truncate text-text-primary">{programFromId(record.id)}</span>
								{#if !record.isExact}
									<span class="flex shrink-0" title="Fuzzy match — didn't match: {record.mismatches.join(', ')}">
										<BadgeQuestionMark size={13} class="text-check-fail" />
									</span>
								{/if}
							</div>
							<div class="flex items-center gap-3 shrink-0">
								<div class="flex items-center gap-1">
									<Clock size={11} class="text-text-tertiary" />
									<span class="text-sm font-medium tracking-[-0.3px] text-text-primary">{fmtHours(record.hours)}</span>
								</div>

								{#if record.approvedAt || record.createdAt}
									<span class="text-xs text-text-faint">{shortDate(record.approvedAt || record.createdAt || '')}</span>
								{/if}

								<ChevronRight size={12} class="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
							</div>
						</div>
						<div class="flex items-center gap-3 text-[11px] text-text-faint truncate">
							{#if record.playableUrl}
								<span class="truncate" title={record.playableUrl}>{truncateUrl(record.playableUrl)}</span>
							{/if}
							{#if record.codeUrl}
								<span class="truncate" title={record.codeUrl}>{truncateUrl(record.codeUrl)}</span>
							{/if}
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if !loading && fuzzyRecords.length > 0}
		<div class="px-8 max-md:px-4 py-3 border-t border-border-card">
			<Checkbox checked={countFuzzy} onchange={() => (countFuzzy = !countFuzzy)}>
				<span class="text-xs text-text-tertiary">
					Count {fuzzyRecords.length} fuzzy {fuzzyRecords.length === 1 ? 'match' : 'matches'}
				</span>
			</Checkbox>
		</div>
	{/if}
</div>

{#if selected}
	<AirtableRecordModal record={selected} onclose={() => (selected = null)} />
{/if}
