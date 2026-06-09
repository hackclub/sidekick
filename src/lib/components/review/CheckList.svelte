<script lang="ts">
	import { Check, X, LoaderCircle } from 'lucide-svelte';

	interface CheckItem {
		id: string;
		name: string;
		status: 'pending' | 'completed' | 'failed';
		passed: boolean;
		summary: string;
		severity: string;
	}

	interface Props {
		checks: CheckItem[];
		class?: string;
	}

	let { checks, class: className = '' }: Props = $props();

	const pending = $derived(checks.filter((c) => c.status === 'pending'));
	const failing = $derived(checks.filter((c) => c.status !== 'pending' && !c.passed));
	const passed = $derived(checks.filter((c) => c.status !== 'pending' && c.passed));
</script>

<div class="border border-border-card rounded-card shadow-card p-8 pr-20 flex flex-col gap-4 {className}">
	<div class="flex flex-col gap-1">
		<div class="flex items-center gap-2">
			<p class="font-bold text-[15px] text-text-primary tracking-[-0.4px]">Automated checks</p>
			{#if pending.length > 0}
				<LoaderCircle size={14} class="text-text-placeholder animate-spin" />
			{/if}
		</div>
		<p class="text-sm text-text-placeholder tracking-[-0.3px]">
			{#if checks.length === 0}
				No checks available
			{:else if pending.length === checks.length}
				Running {checks.length} checks…
			{:else}
				{failing.length} failing, {passed.length} passed{#if pending.length > 0}, {pending.length} running{/if}
			{/if}
		</p>
	</div>

	<div class="flex flex-col gap-3 w-full">
		{#if failing.length > 0}
			<div class="flex flex-col gap-2">
				{#each failing as check (check.id)}
					<div class="flex gap-2 items-start">
						<div class="shrink-0 size-4 flex items-center justify-center mt-0.5">
							<X size={14} class="text-check-fail" />
						</div>
						<div class="flex flex-col gap-0.5 min-w-0">
							<p class="font-bold text-sm text-text-primary tracking-[-0.3px]">{check.name}</p>
							<p class="text-xs text-text-primary tracking-[-0.24px]">{check.summary}</p>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if pending.length > 0}
			<div class="flex flex-col gap-2">
				{#each pending as check (check.id)}
					<div class="flex gap-2 items-center">
						<LoaderCircle size={14} class="text-text-placeholder animate-spin shrink-0" />
						<span class="text-sm text-text-placeholder tracking-[-0.3px]">{check.name}</span>
					</div>
				{/each}
			</div>
		{/if}

		{#if passed.length > 0}
			<div class="flex flex-col gap-2">
				{#each passed as check (check.id)}
					<div class="flex gap-2 items-center">
						<Check size={14} class="text-check-pass shrink-0" />
						<span class="text-sm text-text-primary tracking-[-0.3px]">{check.name}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
