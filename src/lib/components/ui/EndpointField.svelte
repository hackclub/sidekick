<script lang="ts">
	import { createLogger } from '$lib/logger.js';
	import { Globe, FlaskConical } from 'lucide-svelte';
	import StatusLight from './StatusLight.svelte';

	const log = createLogger('EndpointField');

	interface Props {
		value?: string;
		name?: string;
		id?: string;
		readonly?: boolean;
		required?: boolean;
		secretKey?: string;
	}

	let {
		value = $bindable(''),
		name,
		id,
		readonly: isReadonly = false,
		required = false,
		secretKey = ''
	}: Props = $props();

	let status: 'ok' | 'pending' | 'fail' | 'info' = $state('info');
	let errorMessage = $state('');

	async function test() {
		if (!value)
			return;
		status = 'pending';
		errorMessage = '';
		log.info('Testing endpoint', { url: value });
		const t = log.time('testEndpoint');
		try {
			const res = await fetch('/api/test-endpoint', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: value, secretKey })
			});
			const data = await res.json();
			t.end('status', res.status);
			if (data.ok) {
				status = 'ok';
				log.info('Endpoint test passed', { url: value });
			} else {
				status = 'fail';
				errorMessage = data.error ?? 'Unknown error';
				log.warn('Endpoint test failed', { url: value, error: errorMessage });
			}
		} catch (e) {
			status = 'fail';
			errorMessage = 'Failed to reach Sidekick server';
			log.error('Endpoint test exception', e);
		}
	}
</script>

<div class="flex flex-col gap-1.5">
	<div class="flex items-center gap-2">
		<div class="flex items-center gap-2.5 flex-1 border border-border-input rounded-input px-3 py-2.5 bg-page transition-colors focus-within:border-accent">
			<Globe size={15} class="text-text-tertiary shrink-0" />
			<input
				{id}
				{name}
				type="url"
				bind:value
				readonly={isReadonly}
				{required}
				placeholder="https://example.hackclub.com/api/sidekick"
				class="flex-1 bg-transparent text-sm font-mono text-text-input placeholder:text-text-placeholder outline-none min-w-0"
			/>
			{#if status !== 'info'}
				<StatusLight {status} size={8} />
			{/if}
		</div>
		<button
			type="button"
			onclick={test}
			class="flex items-center gap-1.5 px-3 py-2.5 rounded-input border border-border-button bg-page hover:bg-surface transition-colors cursor-pointer text-[12px] font-medium text-text-primary shrink-0"
		>
			<FlaskConical size={13} />
			Test
		</button>
	</div>
	{#if errorMessage}
		<p class="text-xs text-check-fail font-mono leading-relaxed">{errorMessage}</p>
	{/if}
</div>
