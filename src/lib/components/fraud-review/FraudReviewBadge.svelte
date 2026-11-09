<script lang="ts">
	import { ShieldCheck, ShieldQuestionMark, ShieldOff, History } from 'lucide-svelte';
	import type { FraudReviewState } from '$lib/server/fraud-review.js';

	interface Props {
		review: FraudReviewState | null;
		/** Ship number the stale verdict was for, when the caller knows it. */
		staleShipNumber?: number | null;
		/** Shorter text, for list rows. */
		compact?: boolean;
		class?: string;
	}

	let { review, staleShipNumber = null, compact = false, class: className = '' }: Props = $props();

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	const kind = $derived(
		!review
			? 'none'
			: !review.forPendingShip
				? 'stale'
				: review.status === 'clean'
					? 'clean'
					: 'skipped'
	);

	const label = $derived.by(() => {
		if (!review) return compact ? 'Not reviewed' : 'Fraud review: not reviewed';
		const verdict = review.status === 'clean' ? 'Clean' : 'Skipped';
		if (kind === 'stale') {
			const ship = staleShipNumber ? `ship ${staleShipNumber}` : 'an earlier ship';
			return compact
				? `${verdict} on ${ship}`
				: `Fraud review: ${verdict.toLowerCase()} for ${ship}, not this one`;
		}
		if (compact) return verdict;
		return review.status === 'clean' ? 'Heartbeats clean' : 'Fraud review skipped';
	});

	const title = $derived(
		review
			? `${review.status === 'clean' ? 'Marked clean' : 'Skipped'} by ${review.by.name} on ${new Date(review.at).toLocaleString()}${review.note ? `\n\n${review.note}` : ''}`
			: 'No one has checked these heartbeats for fraud tooling yet.'
	);

	const tone: Record<string, string> = {
		none: 'border-dashed border-border-input text-text-tertiary',
		clean: 'border-check-pass/40 bg-check-pass/5 text-check-pass',
		skipped: 'border-accent/40 bg-accent-bg text-accent',
		stale: 'border-dashed border-border-active text-text-secondary'
	};
</script>

<span
	class="inline-flex items-center gap-1 rounded-tag border font-medium tracking-[-0.2px] min-w-0 {compact
		? 'px-1.5 py-0.5 text-[11px]'
		: 'px-2 py-1 text-xs'} {tone[kind]} {className}"
	{title}
>
	{#if kind === 'clean'}
		<ShieldCheck size={compact ? 11 : 13} class="shrink-0" />
	{:else if kind === 'skipped'}
		<ShieldQuestionMark size={compact ? 11 : 13} class="shrink-0" />
	{:else if kind === 'stale'}
		<History size={compact ? 11 : 13} class="shrink-0" />
	{:else}
		<ShieldOff size={compact ? 11 : 13} class="shrink-0" />
	{/if}
	<span class="truncate">{label}</span>
	{#if review && !compact}
		<span class="font-normal opacity-80 truncate max-md:hidden"
			>· {review.by.name}, {fmtDate(review.at)}</span
		>
	{/if}
</span>
