<script lang="ts">
	import { MapPin, Eye } from 'lucide-svelte';
	import { countryName } from '$lib/utils/countries';

	interface AddressData {
		firstName: string;
		lastName: string;
		line1: string;
		line2?: string;
		city: string;
		stateProvince?: string;
		postalCode: string;
		country: string;
		phoneNumber?: string;
	}

	interface Props {
		orderId: string;
		programId: string;
		class?: string;
	}

	let { orderId, programId, class: className = '' }: Props = $props();

	let revealed = $state(false);
	let loading = $state(false);
	let address = $state<AddressData | null>(null);
	let noAddress = $state(false);
	let fetchError = $state<string | null>(null);

	async function revealAddress() {
		loading = true;
		fetchError = null;
		noAddress = false;

		try {
			const res = await fetch(`/api/programs/${programId}/orders/${orderId}/address`, {
				method: 'POST'
			});
			if (res.status === 404) {
				noAddress = true;
				revealed = true;
				return;
			}
			if (!res.ok) {
				throw new Error('Failed to load address');
			}
			address = await res.json();
			revealed = true;
		}
		catch (e) {
			fetchError = e instanceof Error ? e.message : 'Unknown error';
		}
		finally {
			loading = false;
		}
	}

	const fields = $derived(
		address
			? [
					{ label: 'First Name', value: address.firstName },
					{ label: 'Last Name', value: address.lastName },
					{ label: 'Line 1', value: address.line1 },
					...(address.line2 ? [{ label: 'Line 2', value: address.line2 }] : []),
					{ label: 'City', value: address.city },
					...(address.stateProvince
						? [{ label: 'State/Province/etc.', value: address.stateProvince }]
						: []),
					{ label: 'Postal Code', value: address.postalCode },
					{ label: 'Country', value: countryName(address.country) },
					...(address.phoneNumber
						? [{ label: 'Phone Number', value: address.phoneNumber }]
						: [])
				]
			: []
	);
</script>

<div class="border border-border-card rounded-card p-8 flex flex-col gap-4 {className}">
	<div class="flex gap-2 items-center">
		<MapPin size={14} class="text-text-primary" />
		<span class="font-bold text-[15px] text-text-primary tracking-[-0.4px]">Shipping Address</span>
	</div>

	{#if !revealed}
		<button
			class="w-full py-2 border border-dashed border-border-input rounded-section text-center text-text-placeholder tracking-[-0.3px] text-sm hover:bg-surface transition-colors cursor-pointer flex items-center justify-center gap-2"
			onclick={revealAddress}
			disabled={loading}
		>
			<Eye size={14} />
			{#if loading}
				Loading...
			{:else}
				Click to reveal shipping address
			{/if}
		</button>
		{#if fetchError}
			<p class="text-check-fail text-xs">{fetchError}</p>
		{/if}
	{:else if noAddress}
		<p class="text-sm text-text-tertiary tracking-[-0.3px]">No shipping address on file for this order.</p>
	{:else if address}
		<div class="flex flex-col gap-2 w-full text-sm tracking-[-0.3px]">
			{#each fields as field (field.label)}
				<div class="flex items-center justify-between w-full">
					<span>{field.label}</span>
					<span>{field.value}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
