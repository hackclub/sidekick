<script lang="ts">
	interface Tab {
		id: string;
		label: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		icon?: any;
		color?: string;
	}

	interface Props {
		tabs: Tab[];
		active: string;
		onchange: (id: string) => void;
	}

	let { tabs, active, onchange }: Props = $props();
</script>

<div class="flex border-b border-border-card">
	{#each tabs as tab (tab.id)}
		{@const isActive = active === tab.id}
		<button
			class="flex-1 max-md:min-w-0 flex max-md:flex-col items-center justify-center gap-2 max-md:gap-1 px-4 max-md:px-1 py-3 max-md:py-2 text-sm max-md:text-xs font-medium tracking-[-0.3px] transition-colors cursor-pointer border-b-2
				{isActive
				? `border-current bg-current/5 ${tab.color ?? 'text-text-primary'}`
				: 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface/50'}"
			onclick={() => onchange(tab.id)}
		>
			{#if tab.icon}
				<tab.icon size={16} />
			{/if}
			{tab.label}
		</button>
	{/each}
</div>
