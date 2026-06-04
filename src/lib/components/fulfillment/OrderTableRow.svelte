<script lang="ts">
	import StatusLight from '$lib/components/ui/StatusLight.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { Banknote } from 'lucide-svelte';

	interface Props {
		id: string;
		userName: string;
		userEmail: string;
		userAvatarUrl?: string | null;
		itemName: string;
		itemPrice?: number | null;
		itemThumbnailUrl?: string | null;
		quantity: number;
		date: string;
		status: string;
		selected?: boolean;
		onclick?: () => void;
	}

	let {
		id,
		userName,
		userEmail,
		userAvatarUrl = null,
		itemName,
		itemPrice = null,
		quantity,
		date,
		status,
		itemThumbnailUrl = null,
		selected = false,
		onclick
	}: Props = $props();

	const statusType = $derived(
		status === 'fulfilled'
			? 'ok'
			: status === 'pending'
				? 'pending'
				: 'fail'
	) as 'ok' | 'fail' | 'pending';

	function timeAgo(dateStr: string): string {
		const ms = Date.now() - new Date(dateStr).getTime();
		const hours = Math.floor(ms / 3600000);
		if (hours < 1)
			return '<1h';
		if (hours < 24)
			return `${hours}h`;
		const days = Math.floor(hours / 24);
		return `${days}d`;
	}
</script>

<tr
	class="cursor-pointer transition-colors {selected ? 'bg-accent-bg outline outline-2 -outline-offset-2 outline-accent' : 'hover:bg-surface/50'}"
	onclick={onclick}
	tabindex="0"
>
	<td class="px-3 py-2.5 border-b border-r border-border-table text-sm {selected ? 'font-bold' : ''}">{id}</td>
	<td class="px-3 py-2.5 border-b border-r border-border-table">
		<div class="flex gap-2 items-center min-w-0">
			<Avatar name={userName} url={userAvatarUrl} size="md" />

			<div class="flex flex-col min-w-0">
				<span class="font-bold text-sm truncate">{userName}</span>
				<span class="text-xs text-text-primary truncate">{userEmail}</span>
			</div>
		</div>
	</td>

	<td class="px-3 py-2.5 border-b border-r border-border-table">
		<div class="flex gap-2 items-center min-w-0">
			{#if itemThumbnailUrl}
				<img src={itemThumbnailUrl} alt="" class="h-6 w-10 object-cover shrink-0 rounded-sm" />
			{/if}
			<div class="flex flex-col min-w-0">
				<span class="font-bold text-sm truncate">{itemName}</span>
				{#if itemPrice != null}
					<span class="flex items-center gap-1 text-xs text-text-primary"><Banknote size={12} />{itemPrice}</span>
				{/if}
			</div>
		</div>
	</td>

	<td class="px-3 py-2.5 border-b border-r border-border-table text-sm">{quantity}</td>
	<td class="px-3 py-2.5 border-b border-r border-border-table text-sm">
		{new Date(date).toLocaleDateString()} ({timeAgo(date)})
	</td>
	
	<td class="px-3 py-2.5 border-b border-border-table">
		<div class="flex gap-2 items-center">
			<StatusLight status={statusType} />
			<span class="text-sm capitalize">{status}</span>
		</div>
	</td>
</tr>
