<script lang="ts">
	import StatusLight from './StatusLight.svelte';
	import Avatar from './Avatar.svelte';
	import SlackIcon from '../icons/SlackIcon.svelte';
	import { ShieldAlert, Clock, Mail } from 'lucide-svelte';

	interface Props {
		name: string;
		avatarUrl?: string | null;
		joinDate: string;
		slackId?: string | null;
		hackatimeId?: string | null;
		email?: string | null;
		trustLevel?: string | null;
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
		slackDeactivated = null,
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

<div class="@container border border-border-card rounded-card shadow-card p-8 flex flex-col gap-4 {className}">
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
				<div class="flex gap-1.5 items-center">
					<StatusLight status={trustStatus} size={8} />
					<span class="text-sm text-text-primary tracking-[-0.3px]">{trustLevel}</span>
				</div>
			</div>
		{/if}

		{#if slackId}
			<div class="flex flex-col @xs:flex-row @xs:items-center @xs:justify-between w-full gap-0.5 @xs:gap-2">
				<div class="flex gap-1.5 items-center shrink-0">
					<SlackIcon size={14} class="text-text-primary shrink-0" />
					<span class="text-sm text-text-primary tracking-[-0.3px]">Slack ID</span>
				</div>
				<div class="flex gap-2 items-center min-w-0">
					<span class="font-mono text-sm text-text-primary tracking-[-0.3px] truncate">{slackId}</span>
					{#if slackDeactivated}
						<div class="flex gap-1.5 items-center shrink-0">
							<StatusLight status="fail" size={8} />
							<span class="text-sm tracking-[-0.3px] text-check-fail">deactivated</span>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		{#if hackatimeId}
			<div class="flex flex-col @xs:flex-row @xs:items-center @xs:justify-between w-full gap-0.5 @xs:gap-2">
				<div class="flex gap-1.5 items-center shrink-0">
					<Clock size={14} class="text-text-primary" />
					<span class="text-sm text-text-primary tracking-[-0.3px]">Hackatime ID</span>
				</div>
				<span class="font-mono text-sm text-text-primary tracking-[-0.3px] truncate min-w-0">{hackatimeId}</span>
			</div>
		{/if}

		{#if email}
			<div class="flex flex-col @xs:flex-row @xs:items-center @xs:justify-between w-full gap-0.5 @xs:gap-2">
				<div class="flex gap-1.5 items-center shrink-0">
					<Mail size={14} class="text-text-primary" />
					<span class="text-sm text-text-primary tracking-[-0.3px]">Email</span>
				</div>
				<span class="font-mono text-sm text-text-primary tracking-[-0.3px] truncate min-w-0">{email}</span>
			</div>
		{/if}
	</div>
</div>
