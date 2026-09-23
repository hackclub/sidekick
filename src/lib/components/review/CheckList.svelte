<script lang="ts">
	import { Check, X, LoaderCircle, AlertTriangle, CircleHelp, ChevronRight, ExternalLink } from 'lucide-svelte';
	import type { ProgramCheck } from '$lib/server/protocol/types.js';
	import { isSafeLinkUrl } from '$lib/utils/markdown.js';

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
		// Checks the program ran itself, reported on the ship under review.
		programChecks?: ProgramCheck[];
		programName?: string;
		class?: string;
	}

	let { checks, programChecks = [], programName = 'Program', class: className = '' }: Props = $props();

	type Row = {
		key: string;
		name: string;
		state: 'pending' | 'pass' | 'fail' | 'warn' | 'inconclusive';
		summary: string;
		url: string | null;
	};

	function failState(severity: string | undefined): Row['state'] {
		return severity === 'warn' || severity === 'info' ? 'warn' : 'fail';
	}

	const builtinRows = $derived<Row[]>(
		checks.map((c) => ({
			key: `sidekick:${c.id}`,
			name: c.name,
			state: c.status === 'pending' ? 'pending' : c.passed ? 'pass' : failState(c.severity),
			summary: c.summary,
			url: null
		}))
	);

	// Sidekick's own checks come first, then the program's groups in the order
	// the program sent them. Headings only appear once there is more than one
	// group to tell apart.
	const groups = $derived.by(() => {
		const out: Array<{ key: string; label: string; rows: Row[] }> = [];
		if (builtinRows.length > 0) out.push({ key: 'sidekick', label: 'Sidekick', rows: builtinRows });
		for (const c of programChecks) {
			const label = c.group?.trim() || programName;
			let group = out.find((g) => g.key === `program:${label}`);
			if (!group) {
				group = { key: `program:${label}`, label, rows: [] };
				out.push(group);
			}
			group.rows.push({
				key: `${group.key}:${c.id}`,
				name: c.name,
				state: c.status === 'pass' ? 'pass' : c.status === 'inconclusive' ? 'inconclusive' : failState(c.severity ?? 'fail'),
				summary: c.summary ?? '',
				url: isSafeLinkUrl(c.url) ? c.url : null
			});
		}
		return out;
	});

	const allRows = $derived(groups.flatMap((g) => g.rows));
	const count = (rows: Row[], state: Row['state']) => rows.filter((r) => r.state === state).length;

	// Passing checks are folded per group: with a program reporting a few
	// dozen rules, listing every pass pushes the failures out of view.
	let expanded = $state<Record<string, boolean>>({});

	function describe(rows: Row[]): string {
		const parts: string[] = [];
		const fail = count(rows, 'fail');
		const warn = count(rows, 'warn');
		const unknown = count(rows, 'inconclusive');
		const pending = count(rows, 'pending');
		if (fail) parts.push(`${fail} failing`);
		if (warn) parts.push(`${warn} ${warn === 1 ? 'warning' : 'warnings'}`);
		if (unknown) parts.push(`${unknown} inconclusive`);
		parts.push(`${count(rows, 'pass')} passed`);
		if (pending) parts.push(`${pending} running`);
		return parts.join(', ');
	}
</script>

{#snippet row(r: Row)}
	<div class="flex gap-2 items-start">
		<div class="shrink-0 size-4 flex items-center justify-center mt-0.5">
			{#if r.state === 'fail'}
				<X size={14} class="text-check-fail" />
			{:else if r.state === 'warn'}
				<AlertTriangle size={13} class="text-amber-500" />
			{:else if r.state === 'inconclusive'}
				<CircleHelp size={13} class="text-text-tertiary" />
			{:else if r.state === 'pending'}
				<LoaderCircle size={14} class="text-text-placeholder animate-spin" />
			{:else}
				<Check size={14} class="text-check-pass" />
			{/if}
		</div>
		<div class="flex flex-col gap-0.5 min-w-0">
			<p class="text-sm tracking-[-0.3px] {r.state === 'pending' ? 'text-text-placeholder' : r.state === 'pass' ? 'text-text-primary' : 'font-bold text-text-primary'}">
				{r.name}
				{#if r.url}
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a href={r.url} target="_blank" rel="noopener noreferrer" class="inline-flex align-[-1px] ml-0.5 text-text-tertiary hover:text-accent" title="Open the rule's page">
						<ExternalLink size={12} />
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
			</p>
			{#if r.summary && r.state !== 'pass' && r.state !== 'pending'}
				<p class="text-xs text-text-primary tracking-[-0.24px] break-words">{r.summary}</p>
			{/if}
		</div>
	</div>
{/snippet}

<div class="border border-border-card rounded-card shadow-card p-8 flex flex-col gap-4 {className}">
	<div class="flex flex-col gap-1">
		<div class="flex items-center gap-2">
			<p class="font-bold text-[15px] text-text-primary tracking-[-0.4px]">Automated checks</p>
			{#if count(allRows, 'pending') > 0}
				<LoaderCircle size={14} class="text-text-placeholder animate-spin" />
			{/if}
		</div>
		<p class="text-sm text-text-placeholder tracking-[-0.3px]">
			{#if allRows.length === 0}
				No checks available
			{:else if count(allRows, 'pending') === allRows.length}
				Running {allRows.length} checks…
			{:else}
				{describe(allRows)}
			{/if}
		</p>
	</div>

	<div class="flex flex-col gap-5 w-full">
		{#each groups as group (group.key)}
			{@const attention = group.rows.filter((r) => r.state !== 'pass')}
			{@const passed = group.rows.filter((r) => r.state === 'pass')}
			<div class="flex flex-col gap-2">
				{#if groups.length > 1}
					<p class="text-[11px] font-bold uppercase tracking-[0.4px] text-text-tertiary">{group.label}</p>
				{/if}
				{#each attention as r (r.key)}
					{@render row(r)}
				{/each}
				{#if passed.length > 0}
					<button
						type="button"
						class="flex items-center gap-1.5 text-sm text-text-secondary tracking-[-0.3px] hover:text-text-primary cursor-pointer self-start"
						onclick={() => (expanded[group.key] = !expanded[group.key])}
						aria-expanded={!!expanded[group.key]}
					>
						<ChevronRight size={14} class="transition-transform {expanded[group.key] ? 'rotate-90' : ''}" />
						{passed.length} passed
					</button>
					{#if expanded[group.key]}
						<div class="flex flex-col gap-2 pl-5">
							{#each passed as r (r.key)}
								{@render row(r)}
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		{/each}
	</div>
</div>
