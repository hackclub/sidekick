<script lang="ts">
	import StatusLight from '$lib/components/ui/StatusLight.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { Banknote } from 'lucide-svelte';
	import { isUuid, shortenId } from '$lib/utils/id';

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

<!-- Mobile: the page un-tables the order list, so each row lays its cells out
     as a card: user + status, then item + date, then order ID + quantity. -->
<tr
	class="cursor-pointer transition-colors max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:items-center max-md:gap-x-3 max-md:gap-y-1.5 max-md:px-3 max-md:py-3 max-md:border-b max-md:border-border-table {selected ? 'bg-accent-bg outline outline-2 -outline-offset-2 outline-accent' : 'hover:bg-surface/50'}"
	onclick={onclick}
	tabindex="0"
>
	<td class="px-3 py-2.5 border-b border-r border-border-table text-sm max-md:block max-md:p-0 max-md:border-0 max-md:order-5 max-md:text-xs max-md:text-text-tertiary {selected ? 'font-bold' : ''}" title={isUuid(id) ? id : undefined}>#{shortenId(id)}</td>
	<td class="px-3 py-2.5 border-b border-r border-border-table max-md:block max-md:p-0 max-md:border-0 max-md:min-w-0 max-md:order-1">
		<div class="flex gap-2 items-center min-w-0">
			<Avatar name={userName} url={userAvatarUrl} size="md" />

			<div class="flex flex-col min-w-0">
				<span class="font-bold text-sm truncate">{userName}</span>
				<span class="text-xs text-text-primary truncate">{userEmail}</span>
			</div>
		</div>
	</td>

	<td class="px-3 py-2.5 border-b border-r border-border-table max-md:block max-md:p-0 max-md:border-0 max-md:min-w-0 max-md:order-3">
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

	<td class="px-3 py-2.5 border-b border-r border-border-table text-sm max-md:block max-md:p-0 max-md:border-0 max-md:order-6 max-md:text-xs max-md:text-right max-md:text-text-secondary max-md:before:content-['Qty_']">{quantity}</td>
	<td class="px-3 py-2.5 border-b border-r border-border-table text-sm max-md:block max-md:p-0 max-md:border-0 max-md:order-4 max-md:text-xs max-md:text-right max-md:text-text-secondary">
		{new Date(date).toLocaleDateString()} ({timeAgo(date)})
	</td>
	
	<td class="px-3 py-2.5 border-b border-border-table max-md:block max-md:p-0 max-md:border-0 max-md:order-2">
		<div class="flex gap-2 items-center max-md:justify-end">
			<StatusLight status={statusType} />
			<span class="text-sm capitalize">{status}</span>
		</div>
	</td>
</tr>
