<script lang="ts">
	import Avatar from './Avatar.svelte';
	import SlackIcon from '../icons/SlackIcon.svelte';
	import { ShieldAlert, Clock, Mail, ArrowRight, Eye } from 'lucide-svelte';
	import type { TrustLog } from '$lib/server/integrations/hackatime.js';

	interface Props {
		name: string;
		avatarUrl?: string | null;
		joinDate: string;
		slackId?: string | null;
		hackatimeId?: string | null;
		email?: string | null;
		trustLevel?: string | null;
		trustLogs?: TrustLog[];
		slackDeactivated?: boolean | null;
		loading?: boolean;
		class?: string;
	}

	let {
		name,
		avatarUrl = null,
		joinDate,
		slackId = null,
		hackatimeId = null,
		email = null,
		trustLevel = null,
		trustLogs = [],
		slackDeactivated = null,
		loading = false,
		class: className = ''
	}: Props = $props();

	function openSlack() {
		if (slackId) {
			window.open(`https://hackclub.enterprise.slack.com/team/${slackId}`, '_blank');
		}
	}

	// Joe identifies users by Hackatime ID first, falling back to Slack ID.
	const joeId = $derived(hackatimeId ?? slackId);

	function openJoe() {
		if (joeId) {
			window.open(`https://joe.fraud.hackclub.com/profile/${joeId}`, '_blank');
		}
	}

	const trustColorClasses = $derived(
		trustLevel === 'green'
			? 'bg-check-pass text-white'
			: trustLevel === 'yellow'
				? 'bg-amber-400 text-black'
				: trustLevel === 'red'
					? 'bg-check-fail text-white'
					: trustLevel === 'blue'
						? 'bg-blue-500 text-white'
						: 'bg-text-tertiary text-white'
	);

	function trustPillClasses(level: string): string {
		switch (level) {
			case 'green':
				return 'bg-check-pass text-white';
			case 'red':
				return 'bg-check-fail text-white';
			case 'yellow':
				return 'bg-amber-400 text-black';
			case 'blue':
				return 'bg-blue-500 text-white';
			default:
				return 'bg-text-tertiary text-white';
		}
	}

	function formatLogDate(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	let showTooltip = $state(false);
	let pillEl: HTMLDivElement | undefined = $state();
</script>

<div
	class="@container border border-border-card rounded-card shadow-card p-8 flex flex-col gap-4 {className}"
>
	<div class="flex gap-2 items-center w-full">
		<div class="flex flex-1 gap-2.5 items-center min-w-0">
			<Avatar {name} url={avatarUrl} size="lg" />
			<div class="flex flex-col gap-0.5 min-w-0">
				<p class="font-bold text-[16px] text-text-primary tracking-[-0.48px] truncate">{name}</p>
				{#if joinDate}
					<p class="text-sm text-text-primary tracking-[-0.3px]">{joinDate}</p>
				{/if}
			</div>
		</div>
		{#if joeId}
			<button
				class="size-8 shrink-0 rounded-tag border border-border-input flex items-center justify-center hover:bg-surface transition-colors cursor-pointer"
				onclick={openJoe}
				title="Open profile in Joe"
			>
				<Eye size={16} />
			</button>
		{/if}
		{#if slackId}
			<button
				class="size-8 shrink-0 rounded-tag border border-border-input flex items-center justify-center hover:bg-surface transition-colors cursor-pointer"
				onclick={openSlack}
				title="Open in Slack"
			>
				<SlackIcon size={16} />
			</button>
		{/if}
	</div>

	<div class="flex flex-col gap-2 w-full">
		{#if loading && !trustLevel}
			<div class="flex items-center justify-between w-full animate-pulse">
				<div class="flex gap-1.5 items-center">
					<ShieldAlert size={14} class="text-text-placeholder" />
					<span class="text-sm text-text-placeholder tracking-[-0.3px]">Hackatime trust level</span>
				</div>
				<div class="h-3.5 w-12 rounded bg-surface"></div>
			</div>
		{:else if trustLevel}
			<div class="flex items-center justify-between w-full">
				<div class="flex gap-1.5 items-center">
					<ShieldAlert size={14} class="text-text-primary" />
					<span class="text-sm text-text-primary tracking-[-0.3px]">Hackatime trust level</span>
				</div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="relative"
					onmouseenter={() => {
						if (trustLogs.length > 0) showTooltip = true;
					}}
					onmouseleave={() => (showTooltip = false)}
				>
					<div
						bind:this={pillEl}
						class="px-2.5 py-0.5 rounded-full text-xs font-medium tracking-[-0.3px] cursor-default select-none {trustColorClasses}"
					>
						{trustLevel}{#if trustLogs.length > 0}<span class="opacity-75 ml-1"
								>({trustLogs.length})</span
							>{/if}
					</div>

					{#if showTooltip && trustLogs.length > 0}
						<div class="trust-tooltip-bridge"></div>
						<div class="trust-tooltip">
							<div class="flex flex-col gap-3">
								{#each trustLogs.slice(0, 10) as log}
									<div class="flex flex-col gap-2">
										<div class="flex items-center gap-2">
											<span
												class="px-2 py-0.5 rounded-full text-xs font-medium tracking-[-0.3px] leading-none {trustPillClasses(
													log.previousTrustLevel
												)}">{log.previousTrustLevel}</span
											>
											<ArrowRight size={12} class="text-text-tertiary shrink-0" />
											<span
												class="px-2 py-0.5 rounded-full text-xs font-medium tracking-[-0.3px] leading-none {trustPillClasses(
													log.newTrustLevel
												)}">{log.newTrustLevel}</span
											>
											<span class="text-xs text-text-tertiary ml-auto shrink-0 leading-none"
												>{formatLogDate(log.createdAt)}</span
											>
											{#if log.changedBy}
												<span class="text-xs text-text-secondary shrink-0 leading-none"
													>{log.changedBy}</span
												>
												<Avatar name={log.changedBy} url={log.changedByAvatarUrl} size="xs" />
											{/if}
										</div>
										{#if log.reason}
											<span class="text-xs text-text-secondary leading-tight">{log.reason}</span>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		{#if slackId}
			<div class="flex items-center justify-between w-full gap-2">
				<div class="flex gap-1.5 items-center shrink-0">
					<SlackIcon size={14} class="text-text-primary shrink-0" />
					<span class="text-sm text-text-primary tracking-[-0.3px]">Slack ID</span>
				</div>
				<div class="flex gap-2 items-center min-w-0">
					<span class="font-mono text-sm text-text-primary tracking-[-0.3px] truncate"
						>{slackId}</span
					>
					{#if slackDeactivated}
						<div class="flex gap-1.5 items-center shrink-0">
							<span
								class="inline-block rounded-full shrink-0 bg-check-fail"
								style="width: 8px; height: 8px"
							></span>
							<span class="text-sm tracking-[-0.3px] text-check-fail">deactivated</span>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		{#if hackatimeId}
			<div class="flex items-center justify-between w-full gap-2">
				<div class="flex gap-1.5 items-center shrink-0">
					<Clock size={14} class="text-text-primary" />
					<span class="text-sm text-text-primary tracking-[-0.3px]">Hackatime ID</span>
				</div>
				<span class="font-mono text-sm text-text-primary tracking-[-0.3px] truncate min-w-0"
					>{hackatimeId}</span
				>
			</div>
		{/if}

		{#if email}
			<div class="flex items-center justify-between w-full gap-2">
				<div class="flex gap-1.5 items-center shrink-0">
					<Mail size={14} class="text-text-primary" />
					<span class="text-sm text-text-primary tracking-[-0.3px]">Email</span>
				</div>
				<span class="font-mono text-sm text-text-primary tracking-[-0.3px] truncate min-w-0"
					>{email}</span
				>
			</div>
		{/if}
	</div>
</div>

<style>
	.trust-tooltip-bridge {
		position: absolute;
		right: 0;
		top: 100%;
		width: 100%;
		height: 8px;
	}

	.trust-tooltip {
		position: absolute;
		right: 0;
		top: calc(100% + 8px);
		background: var(--color-page, #fff);
		border: 1px solid var(--color-border-card);
		border-radius: 8px;
		padding: 16px;
		min-width: 320px;
		max-width: 420px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		z-index: 50;
	}
</style>
