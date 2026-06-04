<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import Sidebar from '$lib/components/sidebar/Sidebar.svelte';
	import type { LayoutData } from './$types.js';
	import type { Snippet } from 'svelte';

	interface Props {
		data: LayoutData;
		children: Snippet;
	}

	let { data, children }: Props = $props();

	const currentProgram = $derived(data.programs?.[0] ?? null);
	const showShell = $derived(!!data.user && !$page.url.pathname.startsWith('/auth/'));
	const permissions = $derived(($page.data as Record<string, unknown>).permissions as { canViewReviews: boolean; canViewFulfillments: boolean } | undefined ?? null);
</script>

<svelte:head>
	<title>Sidekick</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap" rel="stylesheet" />
</svelte:head>

{#if showShell}
	<div class="flex h-screen bg-page">
		<Sidebar user={data.user!} programs={data.programs} {currentProgram} {permissions} />
		<main class="flex-1 min-w-0 overflow-auto">
			{@render children()}
		</main>
	</div>
{:else}
	{@render children()}
{/if}
