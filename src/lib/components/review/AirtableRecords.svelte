<script lang="ts">
	import { Clock, ExternalLink } from 'lucide-svelte';

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
			<svg width="16" height="16" viewBox="0 0 200 170" fill="none" class="shrink-0">
				<path d="M90.04 2.97L17.35 34.81a7.98 7.98 0 00-.2 14.55l73.63 33.03a24.06 24.06 0 0019.62-.1l70.47-33a7.98 7.98 0 00-.15-14.49L109.35 2.9a24.06 24.06 0 00-19.31.07z" fill="#FCB400"/>
				<path d="M104.5 95.13V166c0 4.56 4.86 7.5 8.9 5.4l78.42-43.22a3.98 3.98 0 002.08-3.52V53.73c0-4.68-5.1-7.6-9.1-5.22L105.96 90.9a8.06 8.06 0 00-1.46 4.23z" fill="#18BFFF"/>
				<path d="M88.64 90.74L67.2 79.57l-53.7 34.8A5.52 5.52 0 006 119.24v49.75a5.2 5.2 0 007.88 4.47L88.6 99.45c2.18-1.32 2.24-4.52.04-5.71V90.74z" fill="#F82B60"/>
			</svg>

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
