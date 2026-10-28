<script lang="ts">
	import { AlertTriangle, X } from 'lucide-svelte';
	import AirtableRecordDetails from './AirtableRecordDetails.svelte';
	import type { AirtableMatch } from '$lib/review/airtable.js';

	interface Props {
		records: AirtableMatch[];
		onapprove: () => void;
		oncancel: () => void;
	}

	let { records, onapprove, oncancel }: Props = $props();
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') oncancel(); }} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
	onmousedown={(e) => { if (e.target === e.currentTarget) oncancel(); }}
>
	<div
		role="alertdialog"
		aria-modal="true"
		aria-labelledby="airtable-warning-title"
		aria-describedby="airtable-warning-description"
		class="bg-page border border-border-card rounded-card shadow-xl w-[640px] max-w-[90vw] max-h-[85vh] max-md:max-h-[85dvh] flex flex-col"
	>
		<div class="flex items-start justify-between gap-4 px-6 pt-6 pb-5 border-b border-border-card">
			<div class="flex items-start gap-3.5">
				<span class="flex items-center justify-center size-9 rounded-full bg-accent-bg shrink-0">
					<AlertTriangle size={18} class="text-accent" />
				</span>
				<div class="flex flex-col gap-1">
					<h2 id="airtable-warning-title" class="font-bold text-[17px] text-text-primary tracking-[-0.45px]">
						Existing Airtable records found
						<span class="font-normal text-text-secondary">({records.length})</span>
					</h2>
					<p id="airtable-warning-description" class="text-sm text-text-subtle tracking-[-0.3px] leading-[1.4]">
						This project has been submitted to another YSWS program before. If it's an update, you can approve.
					</p>
				</div>
			</div>
			<button
				class="text-text-secondary hover:text-text-primary cursor-pointer rounded-tag p-1 -m-1 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
				aria-label="Cancel"
				onclick={oncancel}
			>
				<X size={16} />
			</button>
		</div>

		<div class="overflow-y-auto bg-surface/60">
			{#each records as record (record.recordId)}
				<AirtableRecordDetails
					{record}
					compact
					class="px-6 py-5 border-b border-border-card last:border-b-0"
				/>
			{/each}
		</div>

		<div class="flex items-center justify-end gap-2 px-6 py-4 border-t border-border-card">
			<button
				class="px-4 h-9 max-md:h-11 max-md:flex-1 text-sm font-medium text-text-subtle border border-border-button hover:bg-surface rounded-tag cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
				onclick={oncancel}
			>
				Cancel
			</button>
			<button
				class="px-4 h-9 max-md:h-11 max-md:flex-1 text-sm font-bold bg-check-pass text-white rounded-tag cursor-pointer hover:opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-check-pass/40 focus-visible:ring-offset-1"
				onclick={onapprove}
			>
				Approve
			</button>
		</div>
	</div>
</div>
