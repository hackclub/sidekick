<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<!--
	Remount pages when the program changes: SvelteKit reuses the same page
	component when only the [programId] param changes, so per-program $state
	(form fields, expansion maps, scroll position of inner containers) would
	otherwise leak between programs.
-->
{#key page.params.programId}
	{@render children()}
{/key}
