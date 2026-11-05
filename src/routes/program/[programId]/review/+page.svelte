<script lang="ts">
	import type { PageData } from './$types.js';
	import { resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { Clock, CheckCircle, Hourglass, Scale, ShieldCheck, ShieldAlert, Download, Copy, ChevronDown, Check, Search, Filter, ArrowUpDown, Ban, Minus, X } from 'lucide-svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import CsvExportModal from '$lib/components/ui/CsvExportModal.svelte';
	import ProjectTags from '$lib/components/review/ProjectTags.svelte';
	import { isUuid, shortenId } from '$lib/utils/id';
	import { normalizeTags } from '$lib/utils/tags.js';
	import { SvelteMap } from 'svelte/reactivity';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	function formatHours(hours: number): string {
		if (hours < 0.1)
			return '0h';
		if (hours < 10)
			return `${hours.toFixed(1)}h`;
		return `${Math.round(hours)}h`;
	}

	const PENDING_AUTH_COLLAPSED_KEY = 'review-pending-auth-collapsed';

	let pendingAuthCollapsed = $state(
		browser && localStorage.getItem(PENDING_AUTH_COLLAPSED_KEY) === '1'
	);

	function togglePendingAuth() {
		pendingAuthCollapsed = !pendingAuthCollapsed;
		if (browser) localStorage.setItem(PENDING_AUTH_COLLAPSED_KEY, pendingAuthCollapsed ? '1' : '0');
	}

	const projectMap = $derived(
		Object.fromEntries(data.projects.map((p) => [p.id, p]))
	);

	// Filtering & sorting (client-side — the full queue is already loaded)
	type SortMode = 'default' | 'newest' | 'title-asc' | 'title-desc' | 'author' | 'hours-desc' | 'hours-asc';

	// The default mode preserves the server-provided order: longest-waiting first,
	// or the program's own ordering when the upstream sets `explicitlySorted`.
	const SORT_OPTIONS = $derived<{ value: SortMode; label: string }[]>([
		{ value: 'default', label: data.explicitlySorted ? 'Program order' : 'Longest waiting' },
		{ value: 'newest', label: 'Newest first' },
		{ value: 'title-asc', label: 'Title A–Z' },
		{ value: 'title-desc', label: 'Title Z–A' },
		{ value: 'author', label: 'Author A–Z' },
		{ value: 'hours-desc', label: 'Most hours' },
		{ value: 'hours-asc', label: 'Fewest hours' }
	]);

	type ShipKind = 'all' | 'new' | 'update';

	const SHIP_KIND_OPTIONS: { value: ShipKind; label: string }[] = [
		{ value: 'all', label: 'All submissions' },
		{ value: 'new', label: 'New projects' },
		{ value: 'update', label: 'Updates' }
	];

	type TagMode = 'include' | 'exclude';
	type TagMatch = 'any' | 'all';

	let searchInput = $state('');
	// Keyed `p:<label>` for program-sent tags (cards, flags, tracks...), which carry
	// no id, and `c:<id>` for Sidekick's own custom tags.
	const tagFilters = new SvelteMap<string, TagMode>();
	let tagMatch = $state<TagMatch>('any');
	let tagSearch = $state('');
	let shipKind = $state<ShipKind>('all');
	let sortMode = $state<SortMode>('default');
	let filterDropdownOpen = $state(false);
	let sortDropdownOpen = $state(false);

	const sortLabel = $derived(SORT_OPTIONS.find((o) => o.value === sortMode)?.label ?? 'Sort');

	const tagById = $derived(new Map(data.tagDefinitions.map((t) => [t.id, t])));

	function customTagsFor(projectId: string): { label: string; color: string }[] {
		return (data.projectTagIds[projectId] ?? [])
			.map((id) => tagById.get(id))
			.filter((t): t is { id: string; label: string; color: string } => !!t);
	}

	type TagOption = { key: string; label: string; color?: string; count: number };

	function tagKeysFor(project: (typeof data.projects)[number]): Set<string> {
		return new Set([
			...normalizeTags(project.tags).map((t) => `p:${t.label}`),
			...(data.projectTagIds[project.id] ?? []).map((id) => `c:${id}`)
		]);
	}

	const queueTagKeys = $derived([...data.projects, ...data.hqProjects].map(tagKeysFor));

	function countOf(key: string): number {
		return queueTagKeys.filter((keys) => keys.has(key)).length;
	}

	// Every distinct program tag across the queue, first color seen wins.
	const programTagOptions = $derived<TagOption[]>(
		[...data.projects, ...data.hqProjects]
			.flatMap((p) => normalizeTags(p.tags))
			.filter((t, i, all) => all.findIndex((o) => o.label === t.label) === i)
			.map((t) => ({ key: `p:${t.label}`, label: t.label, color: t.color, count: countOf(`p:${t.label}`) }))
			.sort((a, b) => a.label.localeCompare(b.label))
	);

	const customTagOptions = $derived<TagOption[]>(
		data.tagDefinitions.map((t) => ({ key: `c:${t.id}`, label: t.label, color: t.color, count: countOf(`c:${t.id}`) }))
	);

	const tagSearchShown = $derived(programTagOptions.length + customTagOptions.length > 8);

	function searchTags(options: TagOption[]): TagOption[] {
		const query = tagSearch.trim().toLowerCase();
		return query ? options.filter((t) => t.label.toLowerCase().includes(query)) : options;
	}

	const visibleProgramTags = $derived(searchTags(programTagOptions));
	const visibleCustomTags = $derived(searchTags(customTagOptions));

	// A filter outlives its tag leaving the queue, so its chip still has to name it.
	function describeTag(key: string): { label: string; color?: string } {
		if (key.startsWith('p:')) {
			return programTagOptions.find((t) => t.key === key) ?? { label: key.slice(2) };
		}
		const tag = tagById.get(key.slice(2));
		return tag ? { label: tag.label, color: tag.color } : { label: 'Deleted tag' };
	}

	const includedTagKeys = $derived([...tagFilters].filter(([, m]) => m === 'include').map(([k]) => k));
	const excludedTagKeys = $derived([...tagFilters].filter(([, m]) => m === 'exclude').map(([k]) => k));

	const activeFilterCount = $derived(tagFilters.size + (shipKind === 'all' ? 0 : 1));

	// Filters live in the URL so they survive opening a project and coming back,
	// a reload, and being shared: `tag`/`not` name program tags by label,
	// `ctag`/`cnot` custom tags by id.
	const TAG_PARAMS = { p: { include: 'tag', exclude: 'not' }, c: { include: 'ctag', exclude: 'cnot' } } as const;
	const FILTER_PARAMS = ['tag', 'not', 'ctag', 'cnot', 'match', 'kind'];

	{
		const params = page.url.searchParams;
		for (const [prefix, names] of Object.entries(TAG_PARAMS)) {
			for (const [mode, name] of Object.entries(names)) {
				for (const value of params.getAll(name)) tagFilters.set(`${prefix}:${value}`, mode as TagMode);
			}
		}
		if (params.get('match') === 'all') tagMatch = 'all';
		const kind = params.get('kind');
		if (kind === 'new' || kind === 'update') shipKind = kind;
	}

	$effect(() => {
		const url = new URL(page.url);
		for (const name of FILTER_PARAMS) url.searchParams.delete(name);
		for (const [key, mode] of tagFilters) {
			const prefix = key.slice(0, 1) as keyof typeof TAG_PARAMS;
			url.searchParams.append(TAG_PARAMS[prefix][mode], key.slice(2));
		}
		if (tagMatch === 'all') url.searchParams.set('match', 'all');
		if (shipKind !== 'all') url.searchParams.set('kind', shipKind);
		// Same page, only the query string changes: there is no route to resolve.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		if (url.search !== page.url.search) replaceState(url, page.state);
	});

	function matchesFilters(project: (typeof data.projects)[number]): boolean {
		const query = searchInput.trim().toLowerCase();
		if (query) {
			const actor = data.actors[project.authorId];
			const haystack = [project.title, project.id, project.authorId, actor?.name ?? '']
				.join('\n')
				.toLowerCase();
			if (!haystack.includes(query)) return false;
		}
		if (tagFilters.size > 0) {
			const keys = tagKeysFor(project);
			if (excludedTagKeys.some((k) => keys.has(k))) return false;
			if (includedTagKeys.length > 0) {
				const matched =
					tagMatch === 'all'
						? includedTagKeys.every((k) => keys.has(k))
						: includedTagKeys.some((k) => keys.has(k));
				if (!matched) return false;
			}
		}
		if (shipKind !== 'all') {
			const isUpdate = project.ships.length > 1;
			if (isUpdate !== (shipKind === 'update')) return false;
		}
		return true;
	}

	// "default" preserves the server-provided order: longest-waiting first, or the
	// program's own ordering when the upstream sets `explicitlySorted`.
	function sortProjects(
		list: typeof data.projects,
		shipStatus: 'pending' | 'pending_hq'
	): typeof data.projects {
		if (sortMode === 'default') return list;
		const shipOf = (p: (typeof data.projects)[number]) =>
			p.ships.find((s) => s.status === shipStatus);
		const date = (p: (typeof data.projects)[number]) => {
			const ship = shipOf(p);
			return ship ? new Date(ship.submittedAt).getTime() : 0;
		};
		const hours = (p: (typeof data.projects)[number]) => shipOf(p)?.hoursSubmitted ?? 0;
		const author = (p: (typeof data.projects)[number]) =>
			(data.actors[p.authorId]?.name ?? p.authorId).toLowerCase();
		const sorted = [...list];
		switch (sortMode) {
			case 'newest':
				sorted.sort((a, b) => date(b) - date(a));
				break;
			case 'title-asc':
				sorted.sort((a, b) => a.title.localeCompare(b.title));
				break;
			case 'title-desc':
				sorted.sort((a, b) => b.title.localeCompare(a.title));
				break;
			case 'author':
				sorted.sort((a, b) => author(a).localeCompare(author(b)));
				break;
			case 'hours-desc':
				sorted.sort((a, b) => hours(b) - hours(a));
				break;
			case 'hours-asc':
				sorted.sort((a, b) => hours(a) - hours(b));
				break;
		}
		return sorted;
	}

	// Ships awaiting authorization (HQ or fraud review) are shown in their own
	// group, not in the review queue.
	const pendingAuthShipIds = $derived(
		new Set([...data.pendingApprovals.map((pa) => pa.shipId), ...data.fraudQueuedShipIds])
	);
	const filteredProjects = $derived(
		sortProjects(
			data.projects.filter((p) => {
				const ship = p.ships.find((s) => s.status === 'pending');
				return !(ship && pendingAuthShipIds.has(ship.id)) && matchesFilters(p);
			}),
			'pending'
		)
	);
	const filteredHqProjects = $derived(sortProjects(data.hqProjects.filter(matchesFilters), 'pending_hq'));
	const filtersActive = $derived(searchInput.trim().length > 0 || activeFilterCount > 0);

	// Clicking the mode a tag already has clears it; clicking the other switches it.
	function setTagMode(key: string, mode: TagMode) {
		if (tagFilters.get(key) === mode) tagFilters.delete(key);
		else tagFilters.set(key, mode);
	}

	function clearFilters() {
		tagFilters.clear();
		shipKind = 'all';
	}

	function handleFilterDropdownKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') filterDropdownOpen = false;
	}

	function handleFilterDropdownWindowClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-filter-dropdown]')) filterDropdownOpen = false;
	}

	function handleSortDropdownWindowClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-sort-dropdown]')) sortDropdownOpen = false;
	}

	$effect(() => {
		if (filterDropdownOpen) {
			window.addEventListener('click', handleFilterDropdownWindowClick, true);
			window.addEventListener('keydown', handleFilterDropdownKeydown);
			return () => {
				window.removeEventListener('click', handleFilterDropdownWindowClick, true);
				window.removeEventListener('keydown', handleFilterDropdownKeydown);
			};
		}
	});

	$effect(() => {
		if (sortDropdownOpen) {
			window.addEventListener('click', handleSortDropdownWindowClick, true);
			return () => window.removeEventListener('click', handleSortDropdownWindowClick, true);
		}
	});

	// CSV export
	let csvDropdownOpen = $state(false);
	let csvExportMode = $state<'download' | 'copy'>('download');
	let csvModalOpen = $state(false);
	let excludedProjectIds = $state(new Set<string>());
	let csvCopied = $state(false);

	const allExportableProjects = $derived([...data.projects, ...data.hqProjects]);

	const includedProjects = $derived(
		allExportableProjects.filter(p => !excludedProjectIds.has(p.id))
	);

	function csvField(value: string): string {
		const clean = value.replace(/[\r\n]+/g, ' ').trim();
		if (clean.includes(',') || clean.includes('"'))
			return `"${clean.replace(/"/g, '""')}"`;
		return clean;
	}

	function getChangePeriod(project: typeof allExportableProjects[0]): { isUpdate: boolean; periodStart: string; periodEnd: string } {
		const pendingShip = project.ships.find(s => s.status === 'pending' || s.status === 'pending_hq');
		const approvedShips = project.ships
			.filter(s => s.status === 'approved')
			.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

		if (approvedShips.length === 0 || !pendingShip) {
			return { isUpdate: false, periodStart: '', periodEnd: '' };
		}

		const lastApproved = approvedShips[0];
		const approvalDate = data.shipApprovalDates[lastApproved.id] ?? '';

		return {
			isUpdate: true,
			periodStart: approvalDate,
			periodEnd: pendingShip.submittedAt,
		};
	}

	function buildProjectCsv(excluded: Set<string>): string {
		const header = 'Project ID,Title,Author,Demo URL,Code URL,Status,Hours Submitted,Submitted At,Is Update,Change Period Start,Change Period End';
		const rows = [header];
		for (const project of allExportableProjects) {
			if (excluded.has(project.id)) continue;
			const pendingShip = project.ships.find(s => s.status === 'pending' || s.status === 'pending_hq');
			const actor = data.actors[project.authorId];
			const change = getChangePeriod(project);
			rows.push([
				csvField(project.id),
				csvField(project.title),
				csvField(actor?.name ?? project.authorId),
				csvField(project.demoUrl ?? ''),
				csvField(project.codeUrl),
				csvField(pendingShip?.status ?? 'pending'),
				csvField(String(pendingShip?.hoursSubmitted ?? '')),
				csvField(pendingShip?.submittedAt ?? ''),
				csvField(change.isUpdate ? 'Yes' : 'No'),
				csvField(change.periodStart),
				csvField(change.periodEnd),
			].join(','));
		}
		return rows.join('\r\n') + '\r\n';
	}

	function startCsvExport(mode: 'download' | 'copy') {
		csvDropdownOpen = false;
		csvExportMode = mode;
		excludedProjectIds = new Set();
		csvModalOpen = true;
	}

	function executeCsvExport() {
		const csv = buildProjectCsv(excludedProjectIds);
		if (csvExportMode === 'download') {
			const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			const date = new Date().toISOString().slice(0, 10);
			const slug = data.program.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
			a.download = `${slug}-review-queue-${date}.csv`;
			a.click();
			URL.revokeObjectURL(url);
		} else {
			navigator.clipboard.writeText(csv);
			csvCopied = true;
			setTimeout(() => (csvCopied = false), 2000);
		}
		csvModalOpen = false;
	}

	function toggleProjectExclusion(id: string) {
		const next = new Set(excludedProjectIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		excludedProjectIds = next;
	}

	function toggleAllProjects() {
		if (excludedProjectIds.size === 0) {
			excludedProjectIds = new Set(allExportableProjects.map(p => p.id));
		} else {
			excludedProjectIds = new Set();
		}
	}

	function handleCsvDropdownWindowClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-csv-dropdown]')) csvDropdownOpen = false;
	}

	$effect(() => {
		if (csvDropdownOpen) {
			window.addEventListener('click', handleCsvDropdownWindowClick, true);
			return () => window.removeEventListener('click', handleCsvDropdownWindowClick, true);
		}
	});

</script>

<svelte:head>
	<title>Review - {data.program.name} - Sidekick</title>
</svelte:head>

<div class="px-10 max-md:px-4 py-8 max-md:py-5 flex flex-col gap-8 max-md:gap-6 max-w-full overflow-x-clip">
	<div class="flex flex-col gap-2.5">
	<div class="flex items-center justify-between flex-wrap gap-2">
		<div class="flex gap-2 items-center flex-wrap min-w-0">
			<form
				class="border border-border-input rounded-tag flex gap-2 items-center px-3 py-1.5 w-[260px] max-md:w-full min-w-0"
				onsubmit={(e) => e.preventDefault()}
			>
				<Search size={14} class="text-text-placeholder shrink-0" />
				<input
					bind:value={searchInput}
					placeholder="Search by user, title, or ID..."
					class="flex-1 bg-transparent text-sm outline-none placeholder:text-text-placeholder font-medium min-w-0"
				/>
			</form>
			{#snippet tagRow(tag: TagOption)}
				{@const mode = tagFilters.get(tag.key)}
				<div class="group flex items-center gap-1 pl-1.5 pr-1.5">
					<button
						class="flex-1 min-w-0 text-left px-1.5 py-1.5 text-sm rounded-tag hover:bg-surface cursor-pointer flex items-center gap-2"
						aria-pressed={mode === 'include'}
						title={mode === 'include' ? 'Stop filtering by this tag' : 'Only show projects with this tag'}
						onclick={() => setTagMode(tag.key, 'include')}
					>
						<span
							class="size-4 shrink-0 rounded-[4px] border flex items-center justify-center {mode === 'include'
								? 'bg-accent border-accent text-white'
								: mode === 'exclude'
									? 'border-check-fail text-check-fail'
									: 'border-border-input'}"
						>
							{#if mode === 'include'}
								<Check size={12} strokeWidth={3} />
							{:else if mode === 'exclude'}
								<Minus size={12} strokeWidth={3} />
							{/if}
						</span>
						{#if mode === 'exclude'}
							<span class="text-xs font-medium text-check-fail shrink-0">Not</span>
						{/if}
						<ProjectTags tags={[tag]} class="min-w-0 {mode === 'exclude' ? 'opacity-60' : ''}" />
						<span class="ml-auto text-xs text-text-tertiary tabular-nums shrink-0">{tag.count}</span>
					</button>
					<button
						class="shrink-0 p-1 rounded-tag cursor-pointer hover:bg-surface focus-visible:opacity-100 {mode === 'exclude'
							? 'text-check-fail'
							: 'text-text-tertiary opacity-0 group-hover:opacity-100 max-md:opacity-100'}"
						aria-pressed={mode === 'exclude'}
						aria-label="Exclude {tag.label}"
						title={mode === 'exclude' ? 'Stop excluding this tag' : 'Hide projects with this tag'}
						onclick={() => setTagMode(tag.key, 'exclude')}
					>
						<Ban size={14} />
					</button>
				</div>
			{/snippet}
			<div class="relative" data-filter-dropdown>
				<button
					class="border border-border-input rounded-tag flex gap-2 items-center px-3 py-1.5 cursor-pointer hover:bg-surface min-w-0"
					onclick={() => (filterDropdownOpen = !filterDropdownOpen)}
				>
					<Filter size={14} class="text-text-dim shrink-0" />
					<span class="font-medium text-sm text-text-dim truncate">
						{activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}
					</span>
					<ChevronDown size={12} class="text-text-dim shrink-0" />
				</button>
				{#if filterDropdownOpen}
					<div class="absolute top-full left-0 mt-1 bg-page border border-border-card rounded-input shadow-lg z-30 min-w-[220px] max-h-[420px] overflow-y-auto py-1">
						<div class="px-3 pt-1 pb-0.5 text-[11px] font-medium text-text-tertiary uppercase tracking-wide">Submission</div>
						{#each SHIP_KIND_OPTIONS as opt (opt.value)}
							<button
								class="w-full text-left px-3 py-1.5 text-sm hover:bg-surface cursor-pointer flex items-center justify-between gap-2"
								onclick={() => (shipKind = opt.value)}
							>
								{opt.label}
								{#if shipKind === opt.value}
									<Check size={14} class="text-accent shrink-0" />
								{/if}
							</button>
						{/each}
						{#if programTagOptions.length + customTagOptions.length > 0}
							<div class="flex items-center justify-between gap-2 px-3 pt-2 pb-1 border-t border-border-card mt-1">
								<span class="text-[11px] font-medium text-text-tertiary uppercase tracking-wide">Tags</span>
								{#if includedTagKeys.length > 1}
									<div class="flex border border-border-input rounded-tag overflow-hidden text-[11px] font-medium" role="group" aria-label="Match included tags">
										{#each [['any', 'Any'], ['all', 'All']] as const as [value, label] (value)}
											<button
												class="px-2 py-0.5 cursor-pointer {tagMatch === value ? 'bg-accent-bg text-accent' : 'text-text-dim hover:bg-surface'}"
												aria-pressed={tagMatch === value}
												title={value === 'any' ? 'Show projects with any of the included tags' : 'Show projects with every included tag'}
												onclick={() => (tagMatch = value)}
											>
												{label}
											</button>
										{/each}
									</div>
								{/if}
							</div>
							{#if tagSearchShown}
								<div class="mx-2 mb-1 border border-border-input rounded-tag flex gap-1.5 items-center px-2 py-1">
									<Search size={12} class="text-text-placeholder shrink-0" />
									<input
										bind:value={tagSearch}
										placeholder="Find a tag..."
										class="flex-1 bg-transparent text-xs outline-none placeholder:text-text-placeholder font-medium min-w-0"
									/>
								</div>
							{/if}
							{#if visibleProgramTags.length > 0}
								<div class="px-3 pt-1 pb-0.5 text-[11px] font-medium text-text-tertiary">{data.program.name}</div>
								{#each visibleProgramTags as tag (tag.key)}
									{@render tagRow(tag)}
								{/each}
							{/if}
							{#if visibleCustomTags.length > 0}
								<div class="px-3 pt-1 pb-0.5 text-[11px] font-medium text-text-tertiary">Custom</div>
								{#each visibleCustomTags as tag (tag.key)}
									{@render tagRow(tag)}
								{/each}
							{/if}
							{#if visibleProgramTags.length + visibleCustomTags.length === 0}
								<div class="px-3 py-1.5 text-xs text-text-tertiary">No tags match</div>
							{/if}
						{/if}
						{#if activeFilterCount > 0}
							<button
								class="w-full text-left px-3 py-1.5 text-xs text-text-tertiary hover:bg-surface cursor-pointer border-t border-border-card mt-1"
								onclick={clearFilters}
							>
								Clear filters
							</button>
						{/if}
					</div>
				{/if}
			</div>
			<div class="relative" data-sort-dropdown>
				<button
					class="border border-border-input rounded-tag flex gap-2 items-center px-3 py-1.5 cursor-pointer hover:bg-surface min-w-0"
					onclick={() => (sortDropdownOpen = !sortDropdownOpen)}
				>
					<ArrowUpDown size={14} class="text-text-dim shrink-0" />
					<span class="font-medium text-sm text-text-dim truncate">{sortLabel}</span>
					<ChevronDown size={12} class="text-text-dim shrink-0" />
				</button>
				{#if sortDropdownOpen}
					<div class="absolute top-full left-0 mt-1 bg-page border border-border-card rounded-input shadow-lg z-30 min-w-[170px] py-1">
						{#each SORT_OPTIONS as opt (opt.value)}
							<button
								class="w-full text-left px-3 py-1.5 text-sm hover:bg-surface cursor-pointer flex items-center justify-between gap-2"
								onclick={() => { sortMode = opt.value; sortDropdownOpen = false; }}
							>
								{opt.label}
								{#if sortMode === opt.value}
									<Check size={14} class="text-accent shrink-0" />
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
		<div class="flex items-center gap-2 shrink-0 max-md:shrink max-md:w-full max-md:justify-between">
			<span class="font-medium text-sm text-text-muted whitespace-nowrap max-md:whitespace-normal">
				{#if filtersActive}
					{filteredProjects.length + filteredHqProjects.length} of {data.projects.length + data.hqProjects.length} shown
				{:else}
					{Math.max(0, data.pendingCount - data.heldInQueueCount)} pending review{#if data.pendingHqCount > 0}, {data.pendingHqCount} under HQ review{/if}
				{/if}
			</span>
		{#if allExportableProjects.length > 0}
			<div class="relative shrink-0" data-csv-dropdown>
				<button
					class="border border-border-input rounded-tag flex gap-1.5 items-center px-2.5 py-1 cursor-pointer hover:bg-surface text-sm font-medium text-text-dim whitespace-nowrap"
					onclick={() => (csvDropdownOpen = !csvDropdownOpen)}
				>
					{#if csvCopied}
						<Check size={13} class="shrink-0 text-check-pass" />
						<span class="text-check-pass">Copied!</span>
					{:else}
						<Download size={13} class="shrink-0" />
						<span>CSV</span>
						<ChevronDown size={12} class="shrink-0" />
					{/if}
				</button>
				{#if csvDropdownOpen}
					<div class="absolute top-full right-0 mt-1 bg-page border border-border-card rounded-input shadow-lg z-30 min-w-[180px] py-1">
						<button
							class="w-full text-left px-3 py-1.5 text-sm hover:bg-surface cursor-pointer flex items-center gap-2"
							onclick={() => startCsvExport('download')}
						>
							<Download size={13} class="shrink-0" />
							Download CSV
						</button>
						<button
							class="w-full text-left px-3 py-1.5 text-sm hover:bg-surface cursor-pointer flex items-center gap-2"
							onclick={() => startCsvExport('copy')}
						>
							<Copy size={13} class="shrink-0" />
							Copy CSV
						</button>
					</div>
				{/if}
			</div>
		{/if}
		</div>
	</div>
	{#if activeFilterCount > 0}
		<div class="flex items-center flex-wrap gap-1.5 text-xs font-medium">
			{#if shipKind !== 'all'}
				<span class="border border-border-input rounded-tag flex items-center gap-1 pl-2 pr-1 py-0.5 text-text-dim">
					{SHIP_KIND_OPTIONS.find((o) => o.value === shipKind)?.label}
					<button class="p-0.5 rounded hover:bg-surface cursor-pointer" aria-label="Remove submission filter" onclick={() => (shipKind = 'all')}>
						<X size={12} />
					</button>
				</span>
			{/if}
			{#if includedTagKeys.length > 0}
				<span class="text-text-tertiary">
					{#if includedTagKeys.length === 1}
						With
					{:else}
						With
						<button
							class="underline decoration-dotted underline-offset-2 text-text-dim cursor-pointer hover:text-text-primary"
							title="Switch between any and all"
							onclick={() => (tagMatch = tagMatch === 'any' ? 'all' : 'any')}
						>
							{tagMatch === 'any' ? 'any of' : 'all of'}
						</button>
					{/if}
				</span>
				{#each includedTagKeys as key (key)}
					{@const tag = describeTag(key)}
					<span class="border border-border-input rounded-tag flex items-center gap-1 pl-1 pr-1 py-0.5">
						<ProjectTags tags={[tag]} />
						<button class="p-0.5 rounded hover:bg-surface cursor-pointer text-text-dim" aria-label="Remove {tag.label}" onclick={() => tagFilters.delete(key)}>
							<X size={12} />
						</button>
					</span>
				{/each}
			{/if}
			{#if excludedTagKeys.length > 0}
				<span class="text-text-tertiary">Without</span>
				{#each excludedTagKeys as key (key)}
					{@const tag = describeTag(key)}
					<span class="border border-dashed border-check-fail/50 rounded-tag flex items-center gap-1 pl-1 pr-1 py-0.5">
						<ProjectTags tags={[tag]} class="opacity-60" />
						<button class="p-0.5 rounded hover:bg-surface cursor-pointer text-text-dim" aria-label="Stop excluding {tag.label}" onclick={() => tagFilters.delete(key)}>
							<X size={12} />
						</button>
					</span>
				{/each}
			{/if}
			<button class="text-text-tertiary hover:text-text-primary cursor-pointer px-1" onclick={clearFilters}>Clear all</button>
		</div>
	{/if}
	</div>

	{#if data.fraudApprovals.length > 0}
		<div class="flex flex-col gap-2">
			<div class="flex items-center gap-2">
				<ShieldAlert size={16} />
				<h2 class="font-bold text-sm tracking-[-0.3px]">Fraud Review</h2>
				<span class="text-xs text-text-tertiary">{data.fraudApprovals.length} approval{data.fraudApprovals.length === 1 ? '' : 's'} awaiting fraud check</span>
			</div>
			{#each data.fraudApprovals as pa (pa.projectId)}
				{@const project = projectMap[pa.projectId]}
				{@const reviewer = data.actors[pa.reviewerId]}
				<a
					href={resolve(`/program/${data.program.id}/review/${pa.projectId}`)}
					class="border-2 border-dashed border-rose-300 bg-rose-50/30 rounded-section p-4 max-md:p-3 flex items-center gap-4 max-md:gap-3 hover:border-rose-400 hover:bg-rose-50/50 transition-colors"
				>
					{#if project?.screenshotUrl}
						<img src={project.screenshotUrl} alt="" class="w-16 h-10 rounded-tag object-cover shrink-0" />
					{:else}
						<div class="w-16 h-10 rounded-tag bg-surface shrink-0"></div>
					{/if}
					<div class="flex-1 min-w-0">
						<div class="flex max-md:flex-wrap items-center gap-1.5 mb-0.5">
							<span class="text-text-tertiary text-xs font-mono" title={isUuid(pa.projectId) ? pa.projectId : undefined}>#{shortenId(pa.projectId)}</span>
							<span class="font-bold text-sm tracking-[-0.3px] truncate max-md:flex-1 max-md:min-w-0">{project?.title ?? shortenId(pa.projectId)}</span>
							<ProjectTags tags={[...(project?.tags ?? []), ...customTagsFor(pa.projectId)]} class="shrink-0 max-md:basis-full" />
						</div>
						<div class="flex items-center gap-1.5 text-xs text-text-secondary tracking-[-0.24px]">
							<Avatar name={reviewer?.name ?? pa.reviewerId} url={reviewer?.avatarUrl} size="xs" />
							<span class="truncate">
								{reviewer?.name ?? shortenId(pa.reviewerId)} approved for {formatHours(pa.hoursAssigned)}
								<span class="text-text-tertiary">&middot; {new Date(pa.createdAt).toLocaleDateString()}</span>
							</span>
						</div>
					</div>
				</a>
			{/each}
		</div>
	{/if}

	{#if data.pendingApprovals.length > 0}
		<div class="flex flex-col gap-2">
			<button
				type="button"
				class="flex items-center gap-2 text-left cursor-pointer"
				aria-expanded={!pendingAuthCollapsed}
				onclick={togglePendingAuth}
			>
				<ChevronDown size={16} class="transition-transform {pendingAuthCollapsed ? '-rotate-90' : ''}" />
				<Clock size={16} />
				<h2 class="font-bold text-sm tracking-[-0.3px]">Pending Authorization</h2>
				<span class="text-xs text-text-tertiary">{data.pendingApprovals.length} approval{data.pendingApprovals.length === 1 ? '' : 's'} awaiting authorization</span>
			</button>
			{#each pendingAuthCollapsed ? [] : data.pendingApprovals as pa (pa.projectId)}
				{@const project = projectMap[pa.projectId]}
				{@const reviewer = data.actors[pa.reviewerId]}
				<a
					href={resolve(`/program/${data.program.id}/review/${pa.projectId}`)}
					class="border-2 border-dashed border-amber-300 bg-amber-50/30 rounded-section p-4 max-md:p-3 flex items-center gap-4 max-md:gap-3 hover:border-amber-400 hover:bg-amber-50/50 transition-colors"
				>
					{#if project?.screenshotUrl}
						<img src={project.screenshotUrl} alt="" class="w-16 h-10 rounded-tag object-cover shrink-0" />
					{:else}
						<div class="w-16 h-10 rounded-tag bg-surface shrink-0"></div>
					{/if}
					<div class="flex-1 min-w-0">
						<div class="flex max-md:flex-wrap items-center gap-1.5 mb-0.5">
							<span class="text-text-tertiary text-xs font-mono" title={isUuid(pa.projectId) ? pa.projectId : undefined}>#{shortenId(pa.projectId)}</span>
							<span class="font-bold text-sm tracking-[-0.3px] truncate max-md:flex-1 max-md:min-w-0">{project?.title ?? shortenId(pa.projectId)}</span>
							<ProjectTags tags={[...(project?.tags ?? []), ...customTagsFor(pa.projectId)]} class="shrink-0 max-md:basis-full" />
						</div>
						<div class="flex items-center gap-1.5 text-xs text-text-secondary tracking-[-0.24px]">
							<Avatar name={reviewer?.name ?? pa.reviewerId} url={reviewer?.avatarUrl} size="xs" />
							<span class="truncate">
								{reviewer?.name ?? shortenId(pa.reviewerId)} approved for {formatHours(pa.hoursAssigned)}
								<span class="text-text-tertiary">&middot; {new Date(pa.createdAt).toLocaleDateString()}</span>
							</span>
						</div>
					</div>
				</a>
			{/each}
		</div>
	{/if}

	{#if filteredHqProjects.length > 0}
		<div class="flex flex-col gap-2">
			<div class="flex items-center gap-2">
				<ShieldCheck size={16} />
				<h2 class="font-bold text-sm tracking-[-0.3px]">Under HQ Review</h2>
				<span class="text-xs text-text-tertiary">{filteredHqProjects.length} project{filteredHqProjects.length === 1 ? '' : 's'}</span>
			</div>
			{#each filteredHqProjects as project (project.id)}
				{@const hqShip = project.ships.find((s) => s.status === 'pending_hq')}
				{@const approvedHours = project.ships
					.filter((s) => s.status === 'approved')
					.reduce((max, s) => Math.max(max, s.hoursSubmitted), 0)}
				{@const actor = data.actors[project.authorId]}
				<a
					href={resolve(`/program/${data.program.id}/review/${project.id}`)}
					class="border-2 border-dashed border-violet-300 bg-violet-50/30 rounded-section p-4 max-md:p-3 flex items-center gap-4 max-md:gap-3 hover:border-violet-400 hover:bg-violet-50/50 transition-colors"
				>
					{#if project.screenshotUrl}
						<img src={project.screenshotUrl} alt="" class="w-16 h-10 rounded-tag object-cover shrink-0" />
					{:else}
						<div class="w-16 h-10 rounded-tag bg-surface shrink-0"></div>
					{/if}
					<div class="flex-1 min-w-0">
						<div class="flex max-md:flex-wrap items-center gap-1.5 mb-0.5">
							<span class="text-text-tertiary text-xs font-mono" title={isUuid(project.id) ? project.id : undefined}>#{shortenId(project.id)}</span>
							<span class="font-bold text-sm tracking-[-0.3px] truncate max-md:flex-1 max-md:min-w-0">{project.title}</span>
							<ProjectTags tags={[...(project.tags ?? []), ...customTagsFor(project.id)]} class="shrink-0 max-md:basis-full" />
						</div>
						<div class="flex items-center gap-1.5 text-xs text-text-secondary tracking-[-0.24px]">
							<Avatar name={actor?.name ?? project.authorId} url={actor?.avatarUrl} size="xs" />
							<span class="truncate">
								{actor?.name ?? shortenId(project.authorId)}
								{#if hqShip}
									<span class="text-text-tertiary">&middot; {new Date(hqShip.submittedAt).toLocaleDateString()}</span>
								{/if}
								{#if project.ships.length > 1}
									<span class="text-violet-500 font-medium">&middot; Update ({project.ships.length} ships)</span>
								{/if}
							</span>
						</div>
					</div>
					<div class="flex max-md:flex-col items-center max-md:items-end gap-4 max-md:gap-1 shrink-0 text-xs text-text-secondary">
						{#if hqShip}
							<div class="flex items-center gap-1" title="Reported hours (this ship)">
								<Hourglass size={12} class="text-text-tertiary" />
								<span>{formatHours(hqShip.hoursSubmitted)}</span>
							</div>
						{/if}
						{#if approvedHours > 0}
							<div class="flex items-center gap-1" title="Prior approved hours">
								<CheckCircle size={12} class="text-check-pass" />
								<span>{formatHours(approvedHours)}</span>
							</div>
						{/if}
					</div>
				</a>
			{/each}
		</div>
	{/if}

	{#if data.projects.length === 0 && data.hqProjects.length === 0}
		<div class="flex items-center justify-center h-32 text-text-tertiary text-sm">
			No projects pending review. Nice work!
		</div>
	{:else if filteredProjects.length === 0 && filteredHqProjects.length === 0}
		<div class="flex items-center justify-center h-32 text-text-tertiary text-sm">
			No projects match your filters.
		</div>
	{:else if filteredProjects.length > 0}
		<div class="flex flex-col gap-2">
			<div class="flex items-center gap-2">
				<Scale size={16} />
				<h2 class="font-bold text-sm tracking-[-0.3px]">Pending Review</h2>
				<span class="text-xs text-text-tertiary">{filteredProjects.length} project{filteredProjects.length === 1 ? '' : 's'}</span>
			</div>
			{#each filteredProjects as project (project.id)}
				{@const pendingShip = project.ships.find((s) => s.status === 'pending')}
				{@const approvedHours = project.ships
					.filter((s) => s.status === 'approved')
					.reduce((max, s) => Math.max(max, s.hoursSubmitted), 0)}
				{@const actor = data.actors[project.authorId]}
				<a
					href={resolve(`/program/${data.program.id}/review/${project.id}`)}
					class="border border-border-card rounded-section p-4 max-md:p-3 flex items-center gap-4 max-md:gap-3 hover:border-accent hover:bg-accent-bg transition-colors"
				>
					{#if project.screenshotUrl}
						<img src={project.screenshotUrl} alt="" class="w-16 h-10 rounded-tag object-cover shrink-0" />
					{:else}
						<div class="w-16 h-10 rounded-tag bg-surface shrink-0"></div>
					{/if}
					<div class="flex-1 min-w-0">
						<div class="flex max-md:flex-wrap items-center gap-1.5 mb-0.5">
							<span class="text-text-tertiary text-xs font-mono" title={isUuid(project.id) ? project.id : undefined}>#{shortenId(project.id)}</span>
							<span class="font-bold text-sm tracking-[-0.3px] truncate max-md:flex-1 max-md:min-w-0">{project.title}</span>
							<ProjectTags tags={[...(project.tags ?? []), ...customTagsFor(project.id)]} class="shrink-0 max-md:basis-full" />
						</div>
						<div class="flex items-center gap-1.5 text-xs text-text-secondary tracking-[-0.24px]">
							<Avatar name={actor?.name ?? project.authorId} url={actor?.avatarUrl} size="xs" />
							<span class="truncate">
								{actor?.name ?? shortenId(project.authorId)}
								{#if pendingShip}
									<span class="text-text-tertiary">&middot; {new Date(pendingShip.submittedAt).toLocaleDateString()}</span>
								{/if}
								{#if project.ships.length > 1}
									<span class="text-accent font-medium">&middot; Update ({project.ships.length} ships)</span>
								{/if}
							</span>
						</div>
					</div>
					<div class="flex max-md:flex-col items-center max-md:items-end gap-4 max-md:gap-1 shrink-0 text-xs text-text-secondary">
						{#if pendingShip}
							<div class="flex items-center gap-1" title="Reported hours (this ship)">
								<Hourglass size={12} class="text-text-tertiary" />
								<span>{formatHours(pendingShip.hoursSubmitted)}</span>
							</div>
						{/if}
						{#if approvedHours > 0}
							<div class="flex items-center gap-1" title="Prior approved hours">
								<CheckCircle size={12} class="text-check-pass" />
								<span>{formatHours(approvedHours)}</span>
							</div>
						{/if}
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>

{#if csvModalOpen}
	<CsvExportModal
		mode={csvExportMode}
		totalCount={allExportableProjects.length}
		selectedCount={includedProjects.length}
		onclose={() => (csvModalOpen = false)}
		onexport={executeCsvExport}
		class="w-[700px] xl:w-[900px]"
	>
		{#snippet header()}
			<div class="w-8 px-2 py-1.5 flex items-center justify-center">
				<input
					type="checkbox"
					checked={excludedProjectIds.size === 0}
					indeterminate={excludedProjectIds.size > 0 && excludedProjectIds.size < allExportableProjects.length}
					onchange={toggleAllProjects}
					class="cursor-pointer accent-accent"
				/>
			</div>
			<div class="flex-[2] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">Title</div>
			<div class="flex-[2] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">Author</div>
			<div class="flex-[3] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">Demo URL</div>
			<div class="flex-[3] text-left text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">Code URL</div>
			<div class="flex-[1] text-right text-text-tertiary font-medium tracking-[-0.3px] px-2 py-1.5">Hours</div>
		{/snippet}
		{#each allExportableProjects as project (project.id)}
			{@const pendingShip = project.ships.find(s => s.status === 'pending' || s.status === 'pending_hq')}
			{@const actor = data.actors[project.authorId]}
			<button
				class="flex items-center w-full text-sm border-b border-border-card last:border-b-0 hover:bg-surface/50 cursor-pointer text-left"
				onclick={() => toggleProjectExclusion(project.id)}
			>
				<div class="w-8 px-2 py-1.5 flex items-center justify-center">
					<input
						type="checkbox"
						checked={!excludedProjectIds.has(project.id)}
						onchange={() => toggleProjectExclusion(project.id)}
						onclick={(e) => e.stopPropagation()}
						class="cursor-pointer accent-accent"
					/>
				</div>
				<div class="flex-[2] text-text-primary tracking-[-0.3px] px-2 py-1.5 truncate">{project.title}</div>
				<div class="flex-[2] text-text-primary tracking-[-0.3px] px-2 py-1.5 truncate" title={!actor?.name && isUuid(project.authorId) ? project.authorId : undefined}>{actor?.name ?? shortenId(project.authorId)}</div>
				<div class="flex-[3] text-text-secondary tracking-[-0.3px] px-2 py-1.5 truncate font-mono text-xs">{project.demoUrl ?? ''}</div>
				<div class="flex-[3] text-text-secondary tracking-[-0.3px] px-2 py-1.5 truncate font-mono text-xs">{project.codeUrl}</div>
				<div class="flex-[1] text-text-secondary tracking-[-0.3px] px-2 py-1.5 text-right">{pendingShip ? formatHours(pendingShip.hoursSubmitted) : ''}</div>
			</button>
		{/each}
	</CsvExportModal>
{/if}
