<script lang="ts">
	import type { PageData } from './$types.js';
	import { resolve } from '$app/paths';
	import { Clock, CheckCircle, Hourglass, Scale, ShieldCheck, Download, Copy, ChevronDown, Check, Search, Tag, ArrowUpDown } from 'lucide-svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import CsvExportModal from '$lib/components/ui/CsvExportModal.svelte';
	import ProjectTags from '$lib/components/review/ProjectTags.svelte';
	import { isUuid, shortenId } from '$lib/utils/id';
	import { SvelteSet } from 'svelte/reactivity';

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

	let searchInput = $state('');
	const selectedTagIds = new SvelteSet<string>();
	let sortMode = $state<SortMode>('default');
	let tagDropdownOpen = $state(false);
	let sortDropdownOpen = $state(false);

	const sortLabel = $derived(SORT_OPTIONS.find((o) => o.value === sortMode)?.label ?? 'Sort');

	const tagById = $derived(new Map(data.tagDefinitions.map((t) => [t.id, t])));

	function customTagsFor(projectId: string): { label: string; color: string }[] {
		return (data.projectTagIds[projectId] ?? [])
			.map((id) => tagById.get(id))
			.filter((t): t is { id: string; label: string; color: string } => !!t);
	}

	function matchesFilters(project: (typeof data.projects)[number]): boolean {
		const query = searchInput.trim().toLowerCase();
		if (query) {
			const actor = data.actors[project.authorId];
			const haystack = [project.title, project.id, project.authorId, actor?.name ?? '']
				.join('\n')
				.toLowerCase();
			if (!haystack.includes(query)) return false;
		}
		if (selectedTagIds.size > 0) {
			const assigned = new Set(data.projectTagIds[project.id] ?? []);
			for (const id of selectedTagIds) {
				if (!assigned.has(id)) return false;
			}
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

	const filteredProjects = $derived(sortProjects(data.projects.filter(matchesFilters), 'pending'));
	const filteredHqProjects = $derived(sortProjects(data.hqProjects.filter(matchesFilters), 'pending_hq'));
	const filtersActive = $derived(searchInput.trim().length > 0 || selectedTagIds.size > 0);

	function toggleTagFilter(id: string) {
		if (selectedTagIds.has(id)) selectedTagIds.delete(id);
		else selectedTagIds.add(id);
	}

	function handleTagDropdownWindowClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-tag-filter]')) tagDropdownOpen = false;
	}

	function handleSortDropdownWindowClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-sort-dropdown]')) sortDropdownOpen = false;
	}

	$effect(() => {
		if (tagDropdownOpen) {
			window.addEventListener('click', handleTagDropdownWindowClick, true);
			return () => window.removeEventListener('click', handleTagDropdownWindowClick, true);
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

<div class="px-10 py-8 flex flex-col gap-8 max-w-full overflow-hidden">
	<div class="flex items-center justify-between flex-wrap gap-2">
		<div class="flex gap-2 items-center flex-wrap min-w-0">
			<form
				class="border border-border-input rounded-tag flex gap-2 items-center px-3 py-1.5 w-[260px] min-w-0"
				onsubmit={(e) => e.preventDefault()}
			>
				<Search size={14} class="text-text-placeholder shrink-0" />
				<input
					bind:value={searchInput}
					placeholder="Search by user, title, or ID..."
					class="flex-1 bg-transparent text-sm outline-none placeholder:text-text-placeholder font-medium min-w-0"
				/>
			</form>
			{#if data.tagDefinitions.length > 0}
				<div class="relative" data-tag-filter>
					<button
						class="border border-border-input rounded-tag flex gap-2 items-center px-3 py-1.5 cursor-pointer hover:bg-surface min-w-0"
						onclick={() => (tagDropdownOpen = !tagDropdownOpen)}
					>
						<Tag size={14} class="text-text-dim shrink-0" />
						<span class="font-medium text-sm text-text-dim truncate">
							{selectedTagIds.size > 0 ? `Tags (${selectedTagIds.size})` : 'Tags'}
						</span>
						<ChevronDown size={12} class="text-text-dim shrink-0" />
					</button>
					{#if tagDropdownOpen}
						<div class="absolute top-full left-0 mt-1 bg-page border border-border-card rounded-input shadow-lg z-30 min-w-[200px] max-h-[320px] overflow-y-auto py-1">
							{#each data.tagDefinitions as tag (tag.id)}
								<button
									class="w-full text-left px-3 py-1.5 text-sm hover:bg-surface cursor-pointer flex items-center justify-between gap-2"
									onclick={() => toggleTagFilter(tag.id)}
								>
									<ProjectTags tags={[tag]} />
									{#if selectedTagIds.has(tag.id)}
										<Check size={14} class="text-accent shrink-0" />
									{/if}
								</button>
							{/each}
							{#if selectedTagIds.size > 0}
								<button
									class="w-full text-left px-3 py-1.5 text-xs text-text-tertiary hover:bg-surface cursor-pointer border-t border-border-card mt-1"
									onclick={() => selectedTagIds.clear()}
								>
									Clear tag filters
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
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
		<div class="flex items-center gap-2 shrink-0">
			<span class="font-medium text-sm text-text-muted whitespace-nowrap">
				{#if filtersActive}
					{filteredProjects.length + filteredHqProjects.length} of {data.projects.length + data.hqProjects.length} shown
				{:else}
					{data.pendingCount} pending review{#if data.pendingHqCount > 0}, {data.pendingHqCount} under HQ review{/if}
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

	{#if data.canAuthorize && data.pendingApprovals.length > 0}
		<div class="flex flex-col gap-2">
			<div class="flex items-center gap-2">
				<Clock size={16} />
				<h2 class="font-bold text-sm tracking-[-0.3px]">Pending Authorization</h2>
				<span class="text-xs text-text-tertiary">{data.pendingApprovals.length} approval{data.pendingApprovals.length === 1 ? '' : 's'} awaiting authorization</span>
			</div>
			{#each data.pendingApprovals as pa (pa.projectId)}
				{@const project = projectMap[pa.projectId]}
				{@const reviewer = data.actors[pa.reviewerId]}
				<a
					href={resolve(`/program/${data.program.id}/review/${pa.projectId}`)}
					class="border-2 border-dashed border-amber-300 bg-amber-50/30 rounded-section p-4 flex items-center gap-4 hover:border-amber-400 hover:bg-amber-50/50 transition-colors"
				>
					{#if project?.screenshotUrl}
						<img src={project.screenshotUrl} alt="" class="w-16 h-10 rounded-tag object-cover shrink-0" />
					{:else}
						<div class="w-16 h-10 rounded-tag bg-surface shrink-0"></div>
					{/if}
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-1.5 mb-0.5">
							<span class="text-text-tertiary text-xs font-mono" title={isUuid(pa.projectId) ? pa.projectId : undefined}>#{shortenId(pa.projectId)}</span>
							<span class="font-bold text-sm tracking-[-0.3px] truncate">{project?.title ?? shortenId(pa.projectId)}</span>
							<ProjectTags tags={[...(project?.tags ?? []), ...customTagsFor(pa.projectId)]} class="shrink-0" />
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
					class="border-2 border-dashed border-violet-300 bg-violet-50/30 rounded-section p-4 flex items-center gap-4 hover:border-violet-400 hover:bg-violet-50/50 transition-colors"
				>
					{#if project.screenshotUrl}
						<img src={project.screenshotUrl} alt="" class="w-16 h-10 rounded-tag object-cover shrink-0" />
					{:else}
						<div class="w-16 h-10 rounded-tag bg-surface shrink-0"></div>
					{/if}
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-1.5 mb-0.5">
							<span class="text-text-tertiary text-xs font-mono" title={isUuid(project.id) ? project.id : undefined}>#{shortenId(project.id)}</span>
							<span class="font-bold text-sm tracking-[-0.3px] truncate">{project.title}</span>
							<ProjectTags tags={[...(project.tags ?? []), ...customTagsFor(project.id)]} class="shrink-0" />
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
					<div class="flex items-center gap-4 shrink-0 text-xs text-text-secondary">
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
					class="border border-border-card rounded-section p-4 flex items-center gap-4 hover:border-accent hover:bg-accent-bg transition-colors"
				>
					{#if project.screenshotUrl}
						<img src={project.screenshotUrl} alt="" class="w-16 h-10 rounded-tag object-cover shrink-0" />
					{:else}
						<div class="w-16 h-10 rounded-tag bg-surface shrink-0"></div>
					{/if}
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-1.5 mb-0.5">
							<span class="text-text-tertiary text-xs font-mono" title={isUuid(project.id) ? project.id : undefined}>#{shortenId(project.id)}</span>
							<span class="font-bold text-sm tracking-[-0.3px] truncate">{project.title}</span>
							<ProjectTags tags={[...(project.tags ?? []), ...customTagsFor(project.id)]} class="shrink-0" />
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
					<div class="flex items-center gap-4 shrink-0 text-xs text-text-secondary">
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
