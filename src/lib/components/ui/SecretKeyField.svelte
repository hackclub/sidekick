<script lang="ts">
	import { KeyRound, RefreshCw } from 'lucide-svelte';
	import { onMount } from 'svelte';

	interface Props {
		value?: string;
		name?: string;
		id?: string;
		readonly?: boolean;
	}

	let {
		value = $bindable(''),
		name,
		id,
		readonly: isReadonly = false
	}: Props = $props();

	let visible = $state(false);

	function generate() {
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		value = 'sk_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	}

	onMount(() => {
		if (!value) {
			generate();
		}
	});
</script>

<div class="flex items-center gap-2">
	<div class="flex items-center gap-2.5 flex-1 border border-border-input rounded-input px-3 py-2.5 bg-page transition-colors focus-within:border-accent">
		<KeyRound size={15} class="text-text-tertiary shrink-0" />
		<input
			{id}
			{name}
			type={visible ? 'text' : 'password'}
			bind:value
			readonly={isReadonly}
			placeholder="sk_..."
			autocomplete="off"
			data-1p-ignore
			data-lpignore="true"
			class="flex-1 bg-transparent text-sm font-mono text-text-input placeholder:text-text-placeholder outline-none min-w-0"
		/>
		<button
			type="button"
			onclick={() => (visible = !visible)}
			class="text-text-tertiary hover:text-text-primary cursor-pointer text-[12px] font-medium shrink-0"
		>
			{visible ? 'Hide' : 'Show'}
		</button>
	</div>
	<button
		type="button"
		onclick={generate}
		class="flex items-center gap-1.5 px-3 py-2.5 rounded-input border border-border-button bg-page hover:bg-surface transition-colors cursor-pointer text-[12px] font-medium text-text-primary shrink-0"
	>
		<RefreshCw size={13} />
		Generate
	</button>
</div>
