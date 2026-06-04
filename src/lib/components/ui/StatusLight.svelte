<script lang="ts">
	interface Props {
		status: 'ok' | 'pending' | 'fail' | 'info' | 'blue';
		size?: number;
	}

	let { status, size = 10 }: Props = $props();

	const colorClass = $derived(
		status === 'ok'
			? 'bg-check-pass'
			: status === 'fail'
				? 'bg-check-fail'
				: status === 'pending'
					? 'bg-amber-400'
					: status === 'blue'
						? 'bg-blue-500'
						: 'bg-text-tertiary'
	);
</script>

<span
	class="inline-block rounded-full shrink-0 {colorClass}"
	style="width: {size}px; height: {size}px"
></span>
