<script lang="ts">
	import { Clock, ExternalLink } from 'lucide-svelte';
	import AirtableIcon from '../icons/AirtableIcon.svelte';

	interface AirtableMatch {
		id: string;
		url: string;
		hours: number;
		approvedAt: string | null;
	}

	interface Props {
		records: AirtableMatch[];
		loading?: boolean;
		class?: string;
	}

	let { records, loading = false, class: className = '' }: Props = $props();

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
					({records.length})
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
		{:else if records.length === 0}
			<div class="px-8 py-6">
				<p class="text-sm text-text-tertiary tracking-[-0.3px]">No matching records found</p>
			</div>
		{:else}
			<div class="flex flex-col px-8 py-3">
				{#each records as record (record.id)}
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a
						href={record.url}
						target="_blank"
						rel="noopener noreferrer"
						class="flex items-center justify-between gap-3 py-2.5 border-b border-border-table last:border-b-0 -mx-2 px-2 rounded-tag hover:bg-surface transition-colors group"
					>
						<span class="text-sm text-text-primary tracking-[-0.3px] truncate">{programFromId(record.id)}</span>
						<div class="flex items-center gap-3 shrink-0">
							<div class="flex items-center gap-1">
								<Clock size={11} class="text-text-tertiary" />
								<span class="text-sm font-medium text-text-primary tracking-[-0.3px]">{fmtHours(record.hours)}</span>
							</div>

							{#if record.approvedAt}
								<span class="text-xs text-text-faint">{shortDate(record.approvedAt)}</span>
							{/if}

							<ExternalLink size={12} class="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
						</div>
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/each}
			</div>
		{/if}
	</div>
</div>
