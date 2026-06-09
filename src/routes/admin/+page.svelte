<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { ShieldCheck, Search, ChevronLeft, ChevronRight } from 'lucide-svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import type { PageData } from './$types.js';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	let searchInput = $state(data.search);

	const totalPages = $derived(Math.ceil(data.totalCount / data.perPage));

	function handleSearch() {
		const url = new URL($page.url);
		if (searchInput.trim()) {
			url.searchParams.set('q', searchInput.trim());
		} else {
			url.searchParams.delete('q');
		}
		url.searchParams.delete('page');
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(url.toString(), { replaceState: true });
	}

	function goToPage(p: number) {
		const url = new URL($page.url);
		url.searchParams.set('page', String(p));
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(url.toString(), { replaceState: true });
	}
</script>

<svelte:head>
	<title>Admin - Sidekick</title>
</svelte:head>

<div class="flex flex-col gap-6 p-10 max-w-[720px] mx-auto">
	<div class="flex items-center gap-4">
		<div class="size-10 rounded-section bg-accent-bg flex items-center justify-center">
			<ShieldCheck size={18} class="text-accent" />
		</div>
		<div>
			<h1 class="font-bold text-[20px] tracking-[-0.6px]">User Management</h1>
			<p class="text-sm text-text-secondary tracking-[-0.26px]">{data.totalCount} registered user{data.totalCount === 1 ? '' : 's'}</p>
		</div>
	</div>

	<form
		class="flex items-center gap-2 border border-border-input rounded-input px-3 py-2 bg-white w-full max-w-sm"
		onsubmit={(e) => { e.preventDefault(); handleSearch(); }}
	>
		<Search size={14} class="text-text-placeholder shrink-0" />
		<input
			bind:value={searchInput}
			placeholder="Search by name, email, or Slack ID..."
			class="flex-1 bg-transparent text-sm outline-none placeholder:text-text-placeholder"
		/>
	</form>

	<div class="flex flex-col gap-2">
		{#each data.users as u (u.id)}
			<div class="border border-border-card rounded-section bg-white px-4 py-3 flex items-center gap-3">
				<div class="flex items-center gap-2.5 flex-1 min-w-0">
					<Avatar name={u.name} url={u.avatarUrl} size="lg" />
					<div class="flex flex-col min-w-0">
						<span class="text-sm font-semibold text-text-primary truncate">{u.name}</span>
						<span class="text-xs text-text-secondary font-mono truncate">{u.email}</span>
					</div>
				</div>

				<span class="text-xs text-text-tertiary shrink-0 w-20 text-right">
					{u.programCount} program{u.programCount === 1 ? '' : 's'}
				</span>

				<div class="flex items-center gap-2 shrink-0">
					<form method="POST" action="?/toggleRole" use:enhance>
						<input type="hidden" name="userId" value={u.id} />
						<input type="hidden" name="field" value="isProgramAuthor" />
						<input type="hidden" name="value" value={String(!u.isProgramAuthor)} />
						<button
							type="submit"
							class="px-2 py-1 rounded-tag text-xs font-medium transition-colors cursor-pointer border
								{u.isProgramAuthor
								? 'bg-accent-bg border-accent text-accent'
								: 'bg-surface border-border-input text-text-secondary hover:border-accent hover:text-accent'}"
						>
							Author
						</button>
					</form>

					<form method="POST" action="?/toggleRole" use:enhance>
						<input type="hidden" name="userId" value={u.id} />
						<input type="hidden" name="field" value="isSuperAdmin" />
						<input type="hidden" name="value" value={String(!u.isSuperAdmin)} />
						<button
							type="submit"
							class="px-2 py-1 rounded-tag text-xs font-medium transition-colors cursor-pointer border
								{u.isSuperAdmin
								? 'bg-check-fail/10 border-check-fail/30 text-check-fail'
								: 'bg-surface border-border-input text-text-secondary hover:border-check-fail/30 hover:text-check-fail'}"
							disabled={u.id === data.user?.id}
							title={u.id === data.user?.id ? "Can't remove your own admin role" : ''}
						>
							Admin
						</button>
					</form>
				</div>
			</div>
		{/each}

		{#if data.users.length === 0}
			<p class="text-sm text-text-tertiary text-center py-6">No users found.</p>
		{/if}
	</div>

	{#if totalPages > 1}
		<div class="flex items-center justify-between">
			<span class="text-[12px] text-text-secondary">
				Page {data.page} of {totalPages}
			</span>
			<div class="flex items-center gap-1">
				<button
					class="size-7 rounded-tag border border-border-input flex items-center justify-center hover:bg-surface cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
					disabled={data.page <= 1}
					onclick={() => goToPage(data.page - 1)}
				>
					<ChevronLeft size={12} />
				</button>
				<button
					class="size-7 rounded-tag border border-border-input flex items-center justify-center hover:bg-surface cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
					disabled={data.page >= totalPages}
					onclick={() => goToPage(data.page + 1)}
				>
					<ChevronRight size={12} />
				</button>
			</div>
		</div>
	{/if}
</div>
