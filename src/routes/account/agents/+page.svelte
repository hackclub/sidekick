<script lang="ts">
	import { enhance } from '$app/forms';
	import { Bot, Copy, Check, KeyRound } from 'lucide-svelte';
	import type { PageData, ActionData } from './$types.js';

	interface Props {
		data: PageData;
		form: ActionData;
	}

	let { data, form }: Props = $props();
	let copied = $state(false);

	const minted = $derived(form && 'minted' in form ? form.minted : null);
	const mintError = $derived(form && 'error' in form ? form.error : null);
	const command = $derived(
		`claude mcp add --transport http sidekick ${data.mcpUrl} --header "Authorization: Bearer ${minted ?? '<token>'}" -s user`
	);

	async function copyCommand() {
		await navigator.clipboard.writeText(command);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	function relative(iso: string | null): string {
		if (!iso) return 'never';
		const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
		return `${Math.round(minutes / 60 / 24)}d ago`;
	}
</script>

<svelte:head>
	<title>Agent access - Sidekick</title>
</svelte:head>

<div class="flex flex-col gap-6 p-10 max-md:px-4 max-md:py-6 max-w-[720px] mx-auto">
	<div class="flex items-center gap-4">
		<div class="size-10 rounded-section bg-accent-bg flex items-center justify-center">
			<Bot size={18} class="text-accent" />
		</div>
		<div>
			<h1 class="font-bold text-[20px] tracking-[-0.6px]">Agent access</h1>
			<p class="text-sm text-text-secondary tracking-[-0.26px]">
				Let an agent such as Claude Code review beside you through Sidekick's MCP server.
			</p>
		</div>
	</div>

	<div class="flex flex-col gap-2 text-sm text-text-subtle leading-relaxed">
		<p>
			A token acts as you, with exactly your program permissions. The agent can read review queues,
			projects, timelines and (where you may) Hackatime data, and leave a <em>draft</em> verdict on a
			review page. It never approves or rejects anything: you load its draft, read it, and submit it yourself.
		</p>
		<p>Tokens last 90 days. Revoke one the moment it might have leaked.</p>
	</div>

	{#if minted}
		<div class="border-2 border-accent rounded-section bg-accent-bg-warm p-4 flex flex-col gap-3">
			<p class="text-sm font-semibold">
				Your new token. It is shown this once; copy the command now.
			</p>
			<div class="flex items-start gap-2">
				<code
					class="flex-1 min-w-0 break-all text-xs font-mono bg-white border border-border-input rounded-tag px-3 py-2"
				>
					{command}
				</code>
				<button
					type="button"
					class="size-8 shrink-0 rounded-tag border border-border-input bg-white flex items-center justify-center hover:bg-surface cursor-pointer"
					onclick={copyCommand}
					title="Copy"
				>
					{#if copied}<Check size={14} class="text-check-pass" />{:else}<Copy size={14} />{/if}
				</button>
			</div>
			<p class="text-xs text-text-secondary">
				Run it in a terminal to add Sidekick to Claude Code for your user. Other MCP clients take
				<span class="font-mono">{data.mcpUrl}</span> with the token as a Bearer header.
			</p>
		</div>
	{/if}

	<form method="POST" action="?/mint" use:enhance class="flex items-center gap-2">
		<input
			name="name"
			placeholder="Token name, e.g. Claude Code on my laptop"
			maxlength="60"
			class="flex-1 border border-border-input rounded-input px-3 py-2 bg-white text-sm outline-none placeholder:text-text-placeholder"
		/>
		<button
			type="submit"
			class="px-3 py-2 rounded-tag text-sm font-medium border border-accent bg-accent text-white hover:opacity-90 cursor-pointer flex items-center gap-1.5"
		>
			<KeyRound size={14} />
			Create token
		</button>
	</form>
	{#if mintError}
		<p class="text-sm text-check-fail -mt-4">{mintError}</p>
	{/if}

	<div class="flex flex-col gap-2">
		{#each data.tokens as t (t.id)}
			<div
				class="border border-border-card rounded-section bg-white px-4 py-3 flex max-md:flex-wrap items-center gap-3"
			>
				<div class="flex flex-col flex-1 min-w-0">
					<span
						class="text-sm font-semibold truncate {t.state === 'live'
							? ''
							: 'text-text-tertiary line-through'}"
					>
						{t.name}
					</span>
					<span class="text-xs text-text-secondary">
						<span class="font-mono">…{t.hint}</span> · used {relative(t.lastUsedAt)} ·
						{t.state === 'live' ? `expires ${new Date(t.expiresAt).toLocaleDateString()}` : t.state}
					</span>
				</div>
				{#if t.state === 'live'}
					<form method="POST" action="?/revoke" use:enhance>
						<input type="hidden" name="id" value={t.id} />
						<button
							type="submit"
							class="px-2 py-1 rounded-tag text-xs font-medium border bg-surface border-border-input text-text-secondary hover:border-check-fail/30 hover:text-check-fail cursor-pointer"
						>
							Revoke
						</button>
					</form>
				{/if}
			</div>
		{/each}
		{#if data.tokens.length === 0}
			<p class="text-sm text-text-tertiary text-center py-6">No tokens yet.</p>
		{/if}
	</div>
</div>
