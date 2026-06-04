<script lang="ts">
	import { Plus } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';

	interface ProgramEntry {
		id: string;
		name: string;
		iconUrl: string | null;
	}

	interface Props {
		programs: ProgramEntry[];
		activeProgramId?: string | null;
		isCreateNew?: boolean;
		children: Snippet;
	}

	let { programs, activeProgramId = null, isCreateNew = false, children }: Props = $props();
</script>

<div class="flex-1 overflow-auto h-full">
	<div class="flex gap-6 items-start max-w-[1020px] mx-auto min-h-full px-4 md:px-8 py-14">
		<div class="w-[240px] shrink-0 flex flex-col gap-1 sticky top-8 hidden md:flex">
			{#each programs as prog (prog.id)}
				<a
					href={resolve(`/program/${prog.id}/manage`)}
					class="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all
						{prog.id === activeProgramId
						? 'bg-accent-bg-warm font-semibold'
						: 'hover:bg-surface'}"
				>
					{#if prog.iconUrl}
						<img src={prog.iconUrl} alt="" class="size-6 object-cover rounded shrink-0" />
					{:else}
						<div class="size-6 bg-accent rounded flex items-center justify-center text-white text-[10px] font-bold shrink-0">
							{prog.name.charAt(0)}
						</div>
					{/if}
					<span class="text-sm text-text-primary truncate">{prog.name}</span>
				</a>
			{/each}

			{#if isCreateNew}
				<div class="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-dashed border-accent bg-accent-bg-warm font-semibold mt-1">
					<Plus size={14} class="text-text-primary ml-0.5" />
					<span class="text-sm text-text-primary">Create new</span>
				</div>
			{:else}
				<a
					href={resolve('/program/new')}
					class="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-dashed border-border-card text-left transition-all hover:bg-surface mt-1"
				>
					<Plus size={14} class="text-text-secondary ml-0.5" />
					<span class="text-sm text-text-secondary">Create new</span>
				</a>
			{/if}
		</div>

		<div class="flex-1 min-w-0">
			{@render children()}
		</div>
	</div>
</div>
