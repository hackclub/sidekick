<script lang="ts">
	import { X } from 'lucide-svelte';
	import AirtableRecordDetails from './AirtableRecordDetails.svelte';
	import type { AirtableMatch } from '$lib/review/airtable.js';

	interface Props {
		record: AirtableMatch;
		onclose: () => void;
	}

	let { record, onclose }: Props = $props();
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose(); }} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
	onmousedown={(e) => { if (e.target === e.currentTarget) onclose(); }}
>
	<div
		role="dialog"
		aria-modal="true"
		aria-labelledby="airtable-record-title"
		class="bg-page border border-border-card rounded-card shadow-xl w-[600px] max-w-[90vw] max-h-[85vh] max-md:max-h-[85dvh] overflow-y-auto overflow-x-hidden"
	>
		<AirtableRecordDetails {record} titleId="airtable-record-title">
			{#snippet actions()}
				<button
					class="text-text-secondary hover:text-text-primary cursor-pointer rounded-tag p-1 -m-1 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
					aria-label="Close"
					onclick={onclose}
				>
					<X size={16} />
				</button>
			{/snippet}
		</AirtableRecordDetails>
	</div>
</div>
