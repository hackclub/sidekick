<script lang="ts">
	import type { ProgramSummary } from '$lib/types.js';
	import { Pin, PinOff, Plus, Settings } from 'lucide-svelte';

	interface Props {
		programs: ProgramSummary[];
		currentProgramId?: string;
		onselect: (program: ProgramSummary) => void;
		onpin: (program: ProgramSummary, pinned: boolean) => void;
		onclose: () => void;
		onmanage?: () => void;
		oncreate?: () => void;
	}

	let { programs, currentProgramId, onselect, onpin, onclose, onmanage, oncreate }: Props = $props();

	const pinnedProgram = $derived(programs.find((p) => p.isPinned));
	const memberPrograms = $derived(programs.filter((p) => p.isMember && !p.isPinned));
	const otherPrograms = $derived(programs.filter((p) => !p.isMember && !p.isPinned));

	let visible = $state(false);
	$effect(() => {
		requestAnimationFrame(() => (visible = true));
	});

	function close() {
		visible = false;
		setTimeout(onclose, 150);
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50" onclick={close}>
	<div
		class="absolute left-3 top-14 bg-white border border-border-input rounded-section shadow-card p-1.5 w-56
			transition-all duration-150 origin-top-left
			{visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}"
		onclick={(e) => e.stopPropagation()}
		role="dialog"
		tabindex="-1"
	>
		{#snippet programButton(program: ProgramSummary)}
			<div
				class="group flex items-center rounded-tag transition-colors w-full
					{program.id === currentProgramId ? 'bg-accent-bg' : 'hover:bg-surface'}"
			>
				<button
					class="flex items-center gap-2.5 pl-2.5 py-2 text-left cursor-pointer flex-1 min-w-0"
					onclick={() => { visible = false; setTimeout(() => onselect(program), 150); }}
				>
					{#if program.iconUrl}
						<img src={program.iconUrl} alt="" class="size-6 object-cover rounded shrink-0" />
					{:else}
						<div class="size-6 bg-surface rounded flex items-center justify-center text-[10px] font-bold shrink-0">
							{program.name.charAt(0)}
						</div>
					{/if}
					<span class="text-sm font-medium text-text-primary truncate">{program.name}</span>
				</button>
				<button
					class="p-1.5 mr-1 rounded-tag cursor-pointer shrink-0 transition-opacity hover:bg-white/70
						{program.isPinned ? 'text-accent' : 'text-text-tertiary opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}"
					title={program.isPinned ? 'Unpin' : 'Pin (open this program by default)'}
					aria-label={program.isPinned ? `Unpin ${program.name}` : `Pin ${program.name}`}
					onclick={() => onpin(program, !program.isPinned)}
				>
					{#if program.isPinned}
						<PinOff size={14} />
					{:else}
						<Pin size={14} />
					{/if}
				</button>
			</div>
		{/snippet}

		{#if pinnedProgram}
			<div class="mb-1 pb-1 border-b border-border-input flex flex-col gap-0.5">
				{@render programButton(pinnedProgram)}
			</div>
		{/if}

		<div class="flex flex-col gap-0.5">
			{#each memberPrograms as program (program.id)}
				{@render programButton(program)}
			{/each}

			{#if programs.length === 0}
				<p class="text-[12px] text-text-tertiary px-2.5 py-2">No programs yet.</p>
			{/if}
		</div>

		{#if otherPrograms.length > 0}
			<div class="mt-1 pt-1 border-t border-border-input flex flex-col gap-0.5">
				<p class="text-[11px] font-medium text-text-tertiary px-2.5 pt-1 pb-0.5">Other programs</p>
				{#each otherPrograms as program (program.id)}
					{@render programButton(program)}
				{/each}
			</div>
		{/if}

		<div class="mt-1 pt-1 border-t border-border-input flex flex-col gap-0.5">
			{#if oncreate}
				<button
					class="w-full text-left px-2.5 py-2 text-sm text-text-primary font-medium hover:bg-surface rounded-tag cursor-pointer flex items-center gap-2"
					onclick={() => { visible = false; setTimeout(() => oncreate?.(), 150); }}
				>
					<Plus size={14} class="text-text-secondary" />
					Create new
				</button>
			{/if}
			{#if onmanage}
				<button
					class="w-full text-left px-2.5 py-2 text-sm text-text-secondary hover:bg-surface rounded-tag cursor-pointer flex items-center gap-2"
					onclick={() => { visible = false; setTimeout(() => onmanage?.(), 150); }}
				>
					<Settings size={14} class="text-text-tertiary" />
					Manage
				</button>
			{/if}
		</div>
	</div>
</div>
