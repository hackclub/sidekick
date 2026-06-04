<script lang="ts">
	import StatusLight from './StatusLight.svelte';
	import Avatar from './Avatar.svelte';
	import { ShieldAlert, Clock, Mail } from 'lucide-svelte';

	interface Props {
		name: string;
		avatarUrl?: string | null;
		joinDate: string;
		slackId?: string | null;
		hackatimeId?: string | null;
		email?: string | null;
		trustLevel?: string | null;
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
		loading = false,
		class: className = ''
	}: Props = $props();

	function openSlack() {
		if (slackId) {
			window.open(`https://hackclub.enterprise.slack.com/team/${slackId}`, '_blank');
		}
	}

	const trustStatus = $derived(
		trustLevel === 'green'
			? 'ok'
			: trustLevel === 'yellow'
				? 'pending'
				: trustLevel === 'red'
					? 'fail'
					: trustLevel === 'blue'
						? 'blue'
						: 'info'
	) as 'ok' | 'pending' | 'fail' | 'info' | 'blue';
</script>

<div class="border border-border-card rounded-card shadow-card p-8 flex flex-col gap-4 {className}">
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
		{#if slackId}
			<button
				class="size-8 shrink-0 rounded-tag border border-border-input flex items-center justify-center hover:bg-surface transition-colors cursor-pointer"
				onclick={openSlack}
				title="Open in Slack"
			>
				<svg width="16" height="16" viewBox="0 0 20 20" fill="none">
					<path d="M4.202 12.638a2.101 2.101 0 0 1-2.101 2.101A2.101 2.101 0 0 1 0 12.638a2.101 2.101 0 0 1 2.101-2.1h2.1v2.1z" fill="currentColor"/>
					<path d="M5.261 12.638a2.101 2.101 0 0 1 2.1-2.1 2.101 2.101 0 0 1 2.101 2.1v5.261A2.101 2.101 0 0 1 7.362 20a2.101 2.101 0 0 1-2.1-2.101v-5.261z" fill="currentColor"/>
					<path d="M7.362 4.202a2.101 2.101 0 0 1-2.1-2.101A2.101 2.101 0 0 1 7.361 0a2.101 2.101 0 0 1 2.101 2.101v2.1H7.362z" fill="currentColor"/>
					<path d="M7.362 5.261a2.101 2.101 0 0 1 2.1 2.1 2.101 2.101 0 0 1-2.1 2.101H2.1A2.101 2.101 0 0 1 0 7.362a2.101 2.101 0 0 1 2.101-2.1h5.261z" fill="currentColor"/>
					<path d="M15.798 7.362a2.101 2.101 0 0 1 2.101-2.1A2.101 2.101 0 0 1 20 7.361a2.101 2.101 0 0 1-2.101 2.101h-2.1V7.362z" fill="currentColor"/>
					<path d="M14.739 7.362a2.101 2.101 0 0 1-2.1 2.1 2.101 2.101 0 0 1-2.101-2.1V2.1A2.101 2.101 0 0 1 12.638 0a2.101 2.101 0 0 1 2.101 2.101v5.261z" fill="currentColor"/>
					<path d="M12.638 15.798a2.101 2.101 0 0 1 2.101 2.101A2.101 2.101 0 0 1 12.638 20a2.101 2.101 0 0 1-2.1-2.101v-2.1h2.1z" fill="currentColor"/>
					<path d="M12.638 14.739a2.101 2.101 0 0 1-2.1-2.1 2.101 2.101 0 0 1 2.1-2.101h5.261A2.101 2.101 0 0 1 20 12.638a2.101 2.101 0 0 1-2.101 2.101h-5.261z" fill="currentColor"/>
				</svg>
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
				<div class="flex gap-1.5 items-center">
					<StatusLight status={trustStatus} size={8} />
					<span class="text-sm text-text-primary tracking-[-0.3px]">{trustLevel}</span>
				</div>
			</div>
		{/if}

		{#if slackId}
			<div class="flex items-center justify-between w-full">
				<div class="flex gap-1.5 items-center">
					<svg width="14" height="14" viewBox="0 0 20 20" fill="none" class="text-text-primary shrink-0">
						<path d="M4.202 12.638a2.101 2.101 0 0 1-2.101 2.101A2.101 2.101 0 0 1 0 12.638a2.101 2.101 0 0 1 2.101-2.1h2.1v2.1z" fill="currentColor"/>
						<path d="M5.261 12.638a2.101 2.101 0 0 1 2.1-2.1 2.101 2.101 0 0 1 2.101 2.1v5.261A2.101 2.101 0 0 1 7.362 20a2.101 2.101 0 0 1-2.1-2.101v-5.261z" fill="currentColor"/>
						<path d="M7.362 4.202a2.101 2.101 0 0 1-2.1-2.101A2.101 2.101 0 0 1 7.361 0a2.101 2.101 0 0 1 2.101 2.101v2.1H7.362z" fill="currentColor"/>
						<path d="M7.362 5.261a2.101 2.101 0 0 1 2.1 2.1 2.101 2.101 0 0 1-2.1 2.101H2.1A2.101 2.101 0 0 1 0 7.362a2.101 2.101 0 0 1 2.101-2.1h5.261z" fill="currentColor"/>
						<path d="M15.798 7.362a2.101 2.101 0 0 1 2.101-2.1A2.101 2.101 0 0 1 20 7.361a2.101 2.101 0 0 1-2.101 2.101h-2.1V7.362z" fill="currentColor"/>
						<path d="M14.739 7.362a2.101 2.101 0 0 1-2.1 2.1 2.101 2.101 0 0 1-2.101-2.1V2.1A2.101 2.101 0 0 1 12.638 0a2.101 2.101 0 0 1 2.101 2.101v5.261z" fill="currentColor"/>
						<path d="M12.638 15.798a2.101 2.101 0 0 1 2.101 2.101A2.101 2.101 0 0 1 12.638 20a2.101 2.101 0 0 1-2.1-2.101v-2.1h2.1z" fill="currentColor"/>
						<path d="M12.638 14.739a2.101 2.101 0 0 1-2.1-2.1 2.101 2.101 0 0 1 2.1-2.101h5.261A2.101 2.101 0 0 1 20 12.638a2.101 2.101 0 0 1-2.101 2.101h-5.261z" fill="currentColor"/>
					</svg>
					<span class="text-sm text-text-primary tracking-[-0.3px]">Slack ID</span>
				</div>
				<span class="font-mono text-sm text-text-primary tracking-[-0.3px]">{slackId}</span>
			</div>
		{/if}

		{#if hackatimeId}
			<div class="flex items-center justify-between w-full">
				<div class="flex gap-1.5 items-center">
					<Clock size={14} class="text-text-primary" />
					<span class="text-sm text-text-primary tracking-[-0.3px]">Hackatime ID</span>
				</div>
				<span class="font-mono text-sm text-text-primary tracking-[-0.3px]">{hackatimeId}</span>
			</div>
		{/if}

		{#if email}
			<div class="flex items-center justify-between w-full">
				<div class="flex gap-1.5 items-center">
					<Mail size={14} class="text-text-primary" />
					<span class="text-sm text-text-primary tracking-[-0.3px]">Email</span>
				</div>
				<span class="font-mono text-sm text-text-primary tracking-[-0.3px]">{email}</span>
			</div>
		{/if}
	</div>
</div>
