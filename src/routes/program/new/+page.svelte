<script lang="ts">
	import { enhance } from '$app/forms';
	import { Plus } from 'lucide-svelte';
	import ManageLayout from '$lib/components/manage/ManageLayout.svelte';
	import FormField from '$lib/components/ui/FormField.svelte';
	import EndpointField from '$lib/components/ui/EndpointField.svelte';
	import SecretKeyField from '$lib/components/ui/SecretKeyField.svelte';
	import type { PageData } from './$types.js';

	interface Props {
		data: PageData;
		form: { error?: string } | null;
	}

	let { data, form: formResult }: Props = $props();

	let secretKey = $state('');
</script>

<svelte:head>
	<title>New Program - Sidekick</title>
</svelte:head>

<ManageLayout programs={data.programs} isCreateNew>
	<div class="border border-border-card rounded-bento px-8 py-8">
		<div class="flex flex-col gap-6">
			<div class="flex items-center gap-4">
				<div class="size-12 bg-accent rounded-section flex items-center justify-center text-white shrink-0">
					<Plus size={20} />
				</div>
				<div class="flex flex-col gap-0.5">
					<h1 class="font-bold text-[20px] text-text-primary tracking-[-0.6px]">Create a new program</h1>
					<p class="text-sm text-text-secondary tracking-[-0.26px]">
						Set up a YSWS program on Sidekick. You can configure permissions and team members later.
					</p>
				</div>
			</div>

			{#if formResult?.error}
				<div class="bg-check-fail/10 border border-check-fail/30 rounded-tag px-3 py-2 text-[12px] text-check-fail">
					{formResult.error}
				</div>
			{/if}

			<form method="POST" use:enhance class="flex flex-col gap-5">
				<FormField label="Program name" id="name">
					<input
						id="name"
						name="name"
						type="text"
						required
						placeholder="e.g. Hack Club: The Game"
						class="border border-border-input rounded-input px-3 py-2.5 text-sm bg-page text-text-input placeholder:text-text-placeholder outline-none transition-colors focus:border-accent"
					/>
				</FormField>

				<FormField
					label="Master endpoint URL"
					id="masterEndpoint"
					hint="The URL Sidekick will call to communicate with your program."
				>
					<EndpointField id="masterEndpoint" name="masterEndpoint" required {secretKey} />
				</FormField>

				<FormField
					label="Secret key"
					id="secretKey"
					hint="Shared between Sidekick and your program to authenticate API requests."
				>
					<SecretKeyField id="secretKey" name="secretKey" bind:value={secretKey} />
				</FormField>

				<button
					type="submit"
					class="flex items-center justify-center gap-1.5 bg-accent hover:bg-accent/90 text-white rounded-input px-3.5 py-2.5 font-semibold text-sm transition-colors cursor-pointer mt-1 w-fit"
				>
					<Plus size={14} />
					Create program
				</button>
			</form>
		</div>
	</div>
</ManageLayout>
