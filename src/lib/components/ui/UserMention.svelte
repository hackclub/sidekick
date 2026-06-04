<script lang="ts">
	import Avatar from './Avatar.svelte';

	interface Props {
		name: string;
		avatarUrl?: string | null;
		size?: 'sm' | 'md';
	}

	let { name, avatarUrl = null, size = 'md' }: Props = $props();

	const textSize = $derived(size === 'sm' ? 'text-sm' : 'text-[14px]');
</script>

<span class="inline-flex items-center gap-1.5 px-0.5">
	<Avatar {name} url={avatarUrl} size={size === 'sm' ? 'xs' : 'sm'} />
	<span class="font-bold {textSize} text-text-primary whitespace-nowrap">{name}</span>
</span>
