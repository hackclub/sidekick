<script lang="ts">
	import { Ship, CircleCheck, CircleX, ExternalLink } from 'lucide-svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import GitHubIcon from '$lib/components/icons/GitHubIcon.svelte';
	import LapseIcon from '$lib/components/icons/LapseIcon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';

	interface CommitFile {
		filename: string;
		status: string;
		additions: number;
		deletions: number;
	}

	interface GitCommit {
		sha: string;
		message: string;
		author: string;
		authorAvatarUrl?: string | null;
		date: string;
		additions: number;
		deletions: number;
		files?: CommitFile[];
	}

	interface TimelineMarker {
		type: 'ship' | 'approval' | 'rejection';
		label: string;
		date: string;
	}

	interface LapseTimelapse {
		id: string;
		name: string;
		description: string;
		visibility: string;
		thumbnailUrl: string | null;
		playbackUrl: string | null;
		duration: number;
		createdAt: number;
		ownerHandle: string;
		hackatimeProject: string | null;
	}

	interface Props {
		commits: GitCommit[];
		markers?: TimelineMarker[];
		timelapses?: LapseTimelapse[];
		repoUrl?: string;
		loading?: boolean;
		class?: string;
	}

	let { commits, markers = [], timelapses = [], repoUrl = '', loading = false, class: className = '' }: Props = $props();

	let activeTab = $state('github');
	let hoveredCommit: GitCommit | null = $state(null);
	let popupPos: { x: number; y: number } | null = $state(null);
	let popupVisible = $state(false);
	let hoverTimeout: ReturnType<typeof setTimeout> | null = null;
	let fadeTimeout: ReturnType<typeof setTimeout> | null = null;

	function showPopup(commit: GitCommit, el: HTMLElement) {
		if (hoverTimeout) {
			clearTimeout(hoverTimeout);
		}
		if (fadeTimeout) {
			clearTimeout(fadeTimeout);
		}
		hoverTimeout = setTimeout(() => {
			if (!commit.files?.length)
				return;
			const rect = el.getBoundingClientRect();
			popupPos = { x: rect.left - 8, y: rect.top };
			hoveredCommit = commit;
			requestAnimationFrame(() => { popupVisible = true; });
		}, 120);
	}

	function hidePopup() {
		if (hoverTimeout) {
			clearTimeout(hoverTimeout);
		}
		if (fadeTimeout) {
			clearTimeout(fadeTimeout);
		}
		fadeTimeout = setTimeout(() => {
			popupVisible = false;
			setTimeout(() => {
				if (!popupVisible) {
					hoveredCommit = null;
					popupPos = null;
				}
			}, 150);
		}, 150);
	}

	function keepPopup() {
		if (hoverTimeout) {
			clearTimeout(hoverTimeout);
		}
		if (fadeTimeout) {
			clearTimeout(fadeTimeout);
		}
		popupVisible = true;
	}

	const tabs = $derived((() => {
		const t = [
			{ id: 'github', label: 'GitHub', icon: GitHubIcon }
		];
		if (timelapses.length > 0) {
			t.push({ id: 'lapse', label: `Lapse (${timelapses.length})`, icon: LapseIcon });
		}
		return t;
	})());

	function timeAgo(date: string): string {
		const diff = Date.now() - new Date(date).getTime();
		const hours = Math.floor(diff / 3600000);
		if (hours < 1)
			return '<1h';
		if (hours < 24)
			return `${hours}h`;
		const days = Math.floor(hours / 24);
		return `${days}d ${hours % 24}h`;
	}

	function shortDate(date: string): string {
		return new Date(date).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric'
		});
	}

	function fmtDuration(seconds: number): string {
		if (seconds < 60) return `${Math.round(seconds)}s`;
		const mins = Math.floor(seconds / 60);
		const secs = Math.round(seconds % 60);
		if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
		const hrs = Math.floor(mins / 60);
		const remMins = mins % 60;
		return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
	}

	function lapseUrl(id: string): string {
		return `https://lapse.hackclub.com/timelapse/${id}`;
	}

	function daysBetween(a: string, b: string): number {
		return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
	}

	function commitUrl(sha: string): string | null {
		if (!repoUrl)
			return null;
		const clean = repoUrl.replace(/\.git$/, '').replace(/\/$/, '');
		return `${clean}/commit/${sha}`;
	}

	type DisplayItem =
		| { type: 'commit'; commit: GitCommit }
		| { type: 'gap'; days: number }
		| { type: 'marker'; marker: TimelineMarker };

	const displayItems = $derived.by((): DisplayItem[] => {
		const merged: Array<{ date: string; item: DisplayItem }> = [];

		for (const c of commits) {
			merged.push({ date: c.date, item: { type: 'commit', commit: c } });
		}
		for (const m of markers) {
			merged.push({ date: m.date, item: { type: 'marker', marker: m } });
		}

		merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

		const items: DisplayItem[] = [];
		for (let i = 0; i < merged.length; i++) {
			items.push(merged[i].item);
			if (i < merged.length - 1) {
				const cur = merged[i];
				const next = merged[i + 1];
				if (cur.item.type === 'commit' && next.item.type === 'commit') {
					const gap = daysBetween(next.date, cur.date);
					if (gap > 3) {
						items.push({ type: 'gap', days: gap });
					}
				}
			}
		}
		return items;
	});
</script>

<div class="flex flex-col h-full border border-border-card rounded-card shadow-card overflow-hidden {className}">
	<TabBar {tabs} active={activeTab} onchange={(id) => (activeTab = id)} />

	<div class="flex-1 min-h-0 overflow-auto px-8 py-5">
		{#if activeTab === 'github'}
			{#if loading}
				<div class="flex flex-col gap-0.5 animate-pulse">
					<!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
					{#each Array(8) as _, i (i)}
						<div class="flex gap-2.5 items-center h-8 px-1">
							<div class="size-5 rounded-full bg-surface shrink-0"></div>
							<div class="flex flex-1 items-center justify-between">
								<div class="h-3.5 rounded bg-surface" style="width: {50 + (i * 17) % 40}%"></div>
								<div class="flex gap-1.5 items-center shrink-0 ml-2">
									<div class="h-3 w-6 rounded bg-surface"></div>
									<div class="h-3 w-6 rounded bg-surface"></div>
									<div class="h-3 w-8 rounded bg-surface"></div>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{:else}
			<div class="flex flex-col gap-0.5 relative">
				{#if commits.length > 1}
					<div class="absolute left-2.5 top-2.5 bottom-2.5 w-[2px] bg-border-card"></div>
				{/if}

				{#each displayItems as item, i (i)}
					{#if item.type === 'commit' && item.commit}
						{@const url = commitUrl(item.commit.sha)}
						{@const commit = item.commit}
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							href={url ?? '#'}
							target="_blank"
							rel="noopener noreferrer"
							class="flex gap-2.5 items-center h-8 px-1 -mx-1 rounded-tag transition-colors {url ? 'hover:bg-surface cursor-pointer' : ''}"
							onmouseenter={(e) => showPopup(commit, e.currentTarget)}
							onmouseleave={hidePopup}
						>
							<div class="shrink-0 size-5 relative z-10">
								<Avatar name={item.commit.author} url={item.commit.authorAvatarUrl} size="sm" class="border border-border-card" />
							</div>
							<div class="flex flex-1 items-center justify-between min-w-0">
								<p class="font-medium text-sm text-text-primary tracking-[-0.4px] truncate">
									{item.commit.message.split('\n')[0]}
								</p>
								<div class="flex gap-1.5 items-center text-xs shrink-0 ml-2">
									<span class="text-git-added">+{item.commit.additions}</span>
									<span class="text-git-removed">-{item.commit.deletions}</span>
									<span class="text-text-faint">{timeAgo(item.commit.date)}</span>
								</div>
							</div>
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{:else if item.type === 'marker' && item.marker}
						<div class="flex gap-2.5 items-center h-8 px-1 -mx-1">
							<div class="shrink-0 size-5 flex items-center justify-center relative z-10 bg-white rounded
								{item.marker.type === 'approval' ? 'text-check-pass' : item.marker.type === 'rejection' ? 'text-check-fail' : 'text-text-primary'}">
								{#if item.marker.type === 'approval'}
									<CircleCheck size={18} />
								{:else if item.marker.type === 'rejection'}
									<CircleX size={18} />
								{:else}
									<Ship size={18} />
								{/if}
							</div>
							<div class="flex flex-1 items-center justify-between min-w-0">
								<p class="font-semibold text-xs tracking-[-0.24px]
									{item.marker.type === 'approval' ? 'text-check-pass' : item.marker.type === 'rejection' ? 'text-check-fail' : 'text-text-primary'}">
									{item.marker.label}
								</p>
								<span class="text-xs text-text-faint shrink-0 ml-2">{shortDate(item.marker.date)}</span>
							</div>
						</div>
					{:else if item.type === 'gap'}
						<div class="flex gap-2.5 items-center h-8 px-1 -mx-1">
							<div class="shrink-0 size-5 rounded-full bg-surface border border-border-card flex items-center justify-center relative z-10">
								<span class="text-[8px] text-text-faint">···</span>
							</div>
							<p class="font-medium text-sm text-text-faint tracking-[-0.4px]">
								{item.days} days later
							</p>
						</div>
					{/if}
				{/each}
			</div>
			{/if}
		{:else if activeTab === 'lapse'}
			<div class="grid grid-cols-2 gap-3">
				{#each timelapses as tl (tl.id)}
					{@const url = lapseUrl(tl.id)}
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
						href={url}
						target="_blank"
						rel="noopener noreferrer"
						class="group border border-border-card rounded-section overflow-hidden transition-colors hover:border-accent"
					>
						{#if tl.thumbnailUrl}
							<div class="relative aspect-video bg-surface">
								<img src={tl.thumbnailUrl} alt="" class="w-full h-full object-cover" />
								<div class="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
									{fmtDuration(tl.duration)}
								</div>
							</div>
						{:else}
							<div class="relative aspect-video bg-surface flex items-center justify-center">
								<LapseIcon size={24} />
								{#if tl.duration}
									<div class="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
										{fmtDuration(tl.duration)}
									</div>
								{/if}
							</div>
						{/if}
						<div class="px-3 py-2.5 flex flex-col gap-0.5">
							<div class="flex items-center justify-between gap-2">
								<p class="font-semibold text-sm text-text-primary truncate">{tl.name}</p>
								<ExternalLink size={12} class="shrink-0 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
							</div>
							{#if tl.hackatimeProject}
								<p class="text-xs text-text-tertiary font-mono truncate">{tl.hackatimeProject}</p>
							{/if}
							{#if tl.description}
								<p class="text-xs text-text-secondary line-clamp-2">{tl.description}</p>
							{/if}
							{#if tl.visibility === 'UNLISTED'}
								<p class="text-[10px] text-text-faint italic">Unlisted</p>
							{/if}
						</div>
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/each}
			</div>
		{/if}
	</div>
</div>

{#if hoveredCommit && popupPos && hoveredCommit.files?.length}
	{@const files = hoveredCommit.files}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed z-50 transition-opacity duration-150 {popupVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}"
		style="left: {Math.max(0, popupPos.x - 260)}px; top: {popupPos.y}px;"
		onmouseenter={keepPopup}
		onmouseleave={hidePopup}
	>
		<div class="bg-white border border-border-card rounded-section shadow-card px-3 py-2 w-[260px] max-h-[200px] overflow-auto">
			<p class="text-[10px] font-bold text-text-secondary mb-1.5">{files.length} file{files.length !== 1 ? 's' : ''} changed</p>
			<div class="flex flex-col gap-0.5">
				{#each files as file (file.filename)}
					<div class="flex items-center justify-between gap-2 text-[11px]">
						<span class="text-text-primary truncate font-mono">{file.filename.split('/').pop()}<span class="text-text-tertiary font-sans">{file.filename.includes('/') ? ` ${file.filename.slice(0, file.filename.lastIndexOf('/'))}` : ''}</span></span>
						<div class="flex gap-1 shrink-0 text-[10px]">
							{#if file.additions > 0}<span class="text-git-added">+{file.additions}</span>{/if}
							{#if file.deletions > 0}<span class="text-git-removed">-{file.deletions}</span>{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}
