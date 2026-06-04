<script lang="ts">
	interface Props {
		name: string;
		url?: string | null;
		size?: 'xs' | 'sm' | 'md' | 'lg';
		class?: string;
	}

	let { name, url = null, size = 'md', class: className = '' }: Props = $props();

	const sizeClasses: Record<string, { container: string; text: string }> = {
		xs: { container: 'size-4', text: 'text-[6px]' },
		sm: { container: 'size-5', text: 'text-[8px]' },
		md: { container: 'size-7', text: 'text-[10px]' },
		lg: { container: 'size-8', text: 'text-xs' },
	};

	const s = $derived(sizeClasses[size]);
</script>

{#if url}
	<img src={url} alt={name} class="{s.container} rounded-full object-cover shrink-0 {className}" />
{:else}
	<div class="{s.container} rounded-full bg-border-card flex items-center justify-center {s.text} font-bold shrink-0 {className}">
		{name.charAt(0)}
	</div>
{/if}
