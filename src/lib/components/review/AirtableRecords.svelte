<script lang="ts">
	import { Clock, ExternalLink } from 'lucide-svelte';
	import AirtableIcon from '../icons/AirtableIcon.svelte';
	import Checkbox from '../ui/Checkbox.svelte';

	interface AirtableMatch {
		id: string;
		url: string;
		hours: number;
		approvedAt: string | null;
		playableUrl: string | null;
		codeUrl: string | null;
		isExact: boolean;
	}

	interface Props {
		records: AirtableMatch[];
		loading?: boolean;
		showFuzzy?: boolean;
		class?: string;
	}

	let { records, loading = false, showFuzzy = $bindable(false), class: className = '' }: Props = $props();

	const exactRecords = $derived(records.filter((r) => r.isExact));
	const fuzzyRecords = $derived(records.filter((r) => !r.isExact));
	const displayedRecords = $derived(showFuzzy ? records : exactRecords);

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

	function programFromId(id: string): string {
		const dash = id.indexOf('–');
		if (dash > 0)
			return id.slice(0, dash).trim();

		return id;
	}

	function truncateUrl(url: string): string {
		return url
			.replace(/^https?:\/\//, '')
			.replace(/^www\./, '')
			.replace(/\/+$/, '');
	}
</script>

<div class="border border-border-card rounded-card shadow-card overflow-hidden {className}">
	<div class="flex items-center justify-between px-8 py-4 border-b border-border-card">
		<div class="flex items-center gap-2">
			<AirtableIcon size={16} class="shrink-0" />

			<span class="text-sm font-semibold text-text-primary tracking-[-0.3px]">
				Airtable Records
			</span>

			{#if !loading}
				<span class="text-xs text-text-tertiary tracking-[-0.24px]">
					({displayedRecords.length})
				</span>
			{/if}
		</div>
	</div>

	<div class="max-h-[240px] overflow-auto">
		{#if loading}
			<div class="flex flex-col animate-pulse px-8 py-4 gap-1">
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
		{:else if displayedRecords.length === 0}
			<div class="px-8 py-6">
				<p class="text-sm text-text-tertiary tracking-[-0.3px]">No matching records found</p>
			</div>
		{:else}
			<div class="flex flex-col px-8 py-3">
				{#each displayedRecords as record (record.id)}
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a
						href={record.url}
						target="_blank"
						rel="noopener noreferrer"
						class="flex flex-col gap-0.5 py-2.5 border-b border-border-table last:border-b-0 -mx-2 px-2 rounded-tag hover:bg-surface transition-colors group {record.isExact ? '' : 'opacity-50'}"
					>
						<div class="flex items-center justify-between gap-3">
							<span class="text-sm tracking-[-0.3px] truncate {record.isExact ? 'text-text-primary' : 'text-text-tertiary'}">{programFromId(record.id)}</span>
							<div class="flex items-center gap-3 shrink-0">
								<div class="flex items-center gap-1">
									<Clock size={11} class={record.isExact ? 'text-text-tertiary' : 'text-text-faint'} />
									<span class="text-sm font-medium tracking-[-0.3px] {record.isExact ? 'text-text-primary' : 'text-text-tertiary'}">{fmtHours(record.hours)}</span>
								</div>

								{#if record.approvedAt}
									<span class="text-xs text-text-faint">{shortDate(record.approvedAt)}</span>
								{/if}

								<ExternalLink size={12} class="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
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
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/each}
			</div>
		{/if}
	</div>

	{#if !loading && fuzzyRecords.length > 0}
		<div class="px-8 py-3 border-t border-border-card">
			<Checkbox checked={showFuzzy} onchange={() => (showFuzzy = !showFuzzy)}>
				<span class="text-xs text-text-tertiary">
					Show {fuzzyRecords.length} fuzzy {fuzzyRecords.length === 1 ? 'match' : 'matches'}
				</span>
			</Checkbox>
		</div>
	{/if}
</div>
