<script lang="ts">
	import { page } from '$app/stores';
	import { TriangleAlert } from 'lucide-svelte';

	const titles: Record<number, string> = {
		400: 'Bad request',
		403: 'Access denied',
		404: 'Not found',
		500: 'Something broke',
	};

	const descriptions: Record<number, string> = {
		400: "The request couldn't be processed.",
		403: "You don't have permission to access this page.",
		404: "The page you're looking for doesn't exist.",
		500: 'An internal error occurred. Try again later.',
	};

	const status = $derived($page.status);
	const title = $derived(titles[status] ?? 'Error');
	const description = $derived(
		$page.error?.message || descriptions[status] || 'An unexpected error occurred.'
	);
</script>

<div class="flex items-center justify-center h-full px-6">
	<div class="flex flex-col items-center text-center gap-4 max-w-sm">
		<div class="size-12 rounded-tag bg-accent-bg flex items-center justify-center">
			<TriangleAlert size={24} class="text-accent" />
		</div>
		<div class="flex flex-col gap-1.5">
			<h1 class="font-bold text-[22px] tracking-[-0.66px] text-text-primary">{title}</h1>
			<p class="text-[14px] text-text-secondary tracking-[-0.28px] leading-relaxed">{description}</p>
		</div>
	</div>
</div>
