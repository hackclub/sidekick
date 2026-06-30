<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { sidebarExpanded } from '$lib/stores/sidebar.js';
	import type { ProgramSummary, SessionUser } from '$lib/types.js';
	import SidebarButton from './SidebarButton.svelte';
	import ProgramSwitcher from './ProgramSwitcher.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import {
		House,
		Scale,
		Package,
		FolderGit2,
		PanelLeftOpen,
		PanelLeftClose,
		Plus,
		ChevronsUpDown,
		ChevronUp,
		ChevronDown,
		ShieldCheck,
		LogOut
	} from 'lucide-svelte';

	interface Permissions {
		canViewReviews: boolean;
		canViewFulfillments: boolean;
	}

	interface Features {
		projects: boolean;
	}

	interface Props {
		user: SessionUser;
		programs: ProgramSummary[];
		currentProgram?: ProgramSummary | null;
		permissions?: Permissions | null;
		features?: Features | null;
	}

	let {
		user,
		programs,
		currentProgram = null,
		permissions = null,
		features = null
	}: Props = $props();
	const canReview = $derived(permissions?.canViewReviews ?? true);
	const canFulfill = $derived(permissions?.canViewFulfillments ?? true);
	// The Projects browser is an optional endpoint capability; only show it when
	// the connected endpoint advertises support and the user can view reviews.
	const canBrowseProjects = $derived(canReview && (features?.projects ?? false));
	let showProgramSwitcher = $state(false);
	let showUserMenu = $state(false);

	const programBase = $derived(currentProgram ? `/program/${currentProgram.id}` : '');

	function isActive(path: string): boolean {
		if (path === programBase) return $page.url.pathname === path;
		return $page.url.pathname.startsWith(path);
	}

	function navigateTo(path: string) {
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(path);
	}

	function handleProgramSelect(program: ProgramSummary) {
		showProgramSwitcher = false;
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`/program/${program.id}`);
	}
</script>

<aside
	class="bg-sidebar border-r border-sidebar-border flex flex-col justify-between shrink-0 h-screen sticky top-0 transition-all duration-200 overflow-hidden
		{$sidebarExpanded
		? 'w-[var(--sidebar-expanded-width)] px-3 py-4'
		: 'w-[var(--sidebar-collapsed-width)] px-1.5 py-4'}"
>
	<!-- Top section -->
	<div class="flex flex-col gap-3 {$sidebarExpanded ? '' : 'items-center'}">
		<!-- Row 1: Program selector + collapse button -->
		{#if $sidebarExpanded}
			<div class="flex items-center gap-1.5">
				<button
					class="cursor-pointer flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 rounded-sidebar-btn hover:bg-white/50"
					onclick={() => (showProgramSwitcher = !showProgramSwitcher)}
				>
					{#if currentProgram}
						{#if currentProgram.iconUrl}
							<img
								src={currentProgram.iconUrl}
								alt={currentProgram.name}
								class="size-7 object-cover rounded shrink-0"
							/>
						{:else}
							<div
								class="size-7 bg-accent rounded flex items-center justify-center text-white font-bold text-xs shrink-0"
							>
								{currentProgram.name.charAt(0)}
							</div>
						{/if}
						<span class="text-sm font-semibold text-text-primary truncate"
							>{currentProgram.name}</span
						>
						<ChevronsUpDown size={14} class="text-text-tertiary shrink-0" />
					{:else}
						<div class="size-7 bg-border-card rounded flex items-center justify-center shrink-0">
							<Plus size={14} class="text-text-secondary" />
						</div>
						<span class="text-sm font-medium text-text-secondary">Select program</span>
						<ChevronsUpDown size={14} class="text-text-tertiary shrink-0" />
					{/if}
				</button>
				<button
					class="text-text-tertiary hover:text-text-primary cursor-pointer p-1 shrink-0"
					onclick={() => sidebarExpanded.toggle()}
				>
					<PanelLeftClose size={16} />
				</button>
			</div>
		{:else}
			<div class="flex flex-col items-center gap-3">
				<button class="cursor-pointer" onclick={() => (showProgramSwitcher = !showProgramSwitcher)}>
					{#if currentProgram}
						{#if currentProgram.iconUrl}
							<img
								src={currentProgram.iconUrl}
								alt={currentProgram.name}
								class="size-8 object-cover rounded"
							/>
						{:else}
							<div
								class="size-8 bg-accent rounded flex items-center justify-center text-white font-bold text-xs"
							>
								{currentProgram.name.charAt(0)}
							</div>
						{/if}
					{:else}
						<div class="size-8 bg-border-card rounded flex items-center justify-center">
							<Plus size={14} class="text-text-secondary" />
						</div>
					{/if}
				</button>
				<button
					class="text-text-tertiary hover:text-text-primary cursor-pointer"
					onclick={() => sidebarExpanded.toggle()}
				>
					<PanelLeftOpen size={16} />
				</button>
			</div>
		{/if}

		<!-- Navigation -->
		<nav class="flex flex-col {$sidebarExpanded ? 'gap-0.5 w-full' : 'gap-1 items-center'}">
			{#if $sidebarExpanded}
				{#if currentProgram}
					{@const items = [
						{ path: programBase, icon: House, label: 'Home', enabled: true },
						{ path: `${programBase}/review`, icon: Scale, label: 'Review', enabled: canReview },
						...(canBrowseProjects
							? [
									{
										path: `${programBase}/projects`,
										icon: FolderGit2,
										label: 'Projects',
										enabled: true
									}
								]
							: []),
						{
							path: `${programBase}/fulfillment`,
							icon: Package,
							label: 'Fulfillment',
							enabled: canFulfill
						}
					]}
					{#each items as item (item.path)}
						<button
							class="flex items-center gap-2.5 px-2.5 py-2 rounded-sidebar-btn w-full text-left transition-all
								{!item.enabled
								? 'opacity-40 cursor-default font-normal text-[14px]'
								: isActive(item.path)
									? 'bg-white shadow-sidebar-active font-semibold text-[14px] cursor-pointer'
									: 'font-normal text-[14px] text-text-primary hover:bg-white/50 cursor-pointer'}"
							onclick={() => item.enabled && navigateTo(item.path)}
							disabled={!item.enabled}
						>
							<item.icon size={18} strokeWidth={isActive(item.path) ? 2.2 : 1.8} />
							<span>{item.label}</span>
						</button>
					{/each}
				{/if}
				{#if user.isSuperAdmin}
					<button
						class="flex items-center gap-2.5 px-2.5 py-2 rounded-sidebar-btn w-full text-left transition-all cursor-pointer
							{$page.url.pathname.startsWith('/admin')
							? 'bg-white shadow-sidebar-active font-semibold text-[14px]'
							: 'font-normal text-[14px] text-text-secondary hover:bg-white/50'}"
						onclick={() => navigateTo('/admin')}
					>
						<ShieldCheck
							size={18}
							strokeWidth={$page.url.pathname.startsWith('/admin') ? 2.2 : 1.8}
						/>
						<span>Admin</span>
					</button>
				{/if}
			{:else}
				{#if currentProgram}
					<SidebarButton active={isActive(programBase)} onclick={() => navigateTo(programBase)}>
						<House size={18} />
					</SidebarButton>
					<SidebarButton
						active={isActive(`${programBase}/review`)}
						onclick={() => canReview && navigateTo(`${programBase}/review`)}
						disabled={!canReview}
					>
						<Scale size={18} />
					</SidebarButton>
					{#if canBrowseProjects}
						<SidebarButton
							active={isActive(`${programBase}/projects`)}
							onclick={() => navigateTo(`${programBase}/projects`)}
						>
							<FolderGit2 size={18} />
						</SidebarButton>
					{/if}
					<SidebarButton
						active={isActive(`${programBase}/fulfillment`)}
						onclick={() => canFulfill && navigateTo(`${programBase}/fulfillment`)}
						disabled={!canFulfill}
					>
						<Package size={18} />
					</SidebarButton>
				{/if}
				{#if user.isSuperAdmin}
					<SidebarButton
						active={$page.url.pathname.startsWith('/admin')}
						onclick={() => navigateTo('/admin')}
					>
						<ShieldCheck size={18} />
					</SidebarButton>
				{/if}
			{/if}
		</nav>
	</div>

	<!-- User pill -->
	<div class="relative {$sidebarExpanded ? '' : 'flex justify-center'}">
		{#if showUserMenu}
			<div
				class="absolute bottom-full left-0 right-0 mb-1.5 bg-white border border-border-card rounded-sidebar-btn shadow-lg overflow-hidden z-50"
			>
				<div class="px-3 py-2.5 border-b border-border-card">
					<p class="text-sm font-medium text-text-primary truncate">{user.name}</p>
					<p class="text-[11px] text-text-tertiary truncate">{user.email}</p>
				</div>
				<a
					href={resolve('/auth/logout')}
					class="flex items-center gap-2 px-3 py-2.5 text-sm text-check-fail hover:bg-check-fail/5 transition-colors cursor-pointer"
				>
					<LogOut size={14} />
					<span>Log out</span>
				</a>
			</div>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="fixed inset-0 z-40"
				onclick={() => (showUserMenu = false)}
				onkeydown={() => {}}
			></div>
		{/if}

		{#if $sidebarExpanded}
			<button
				class="relative z-50 flex items-center gap-2 bg-white rounded-sidebar-btn px-2.5 py-2 w-full cursor-pointer hover:shadow-sidebar-active transition-shadow"
				onclick={() => (showUserMenu = !showUserMenu)}
			>
				<Avatar name={user.name} url={user.avatarUrl} size="md" />
				<span class="text-sm font-medium text-text-primary truncate flex-1 text-left"
					>{user.name}</span
				>
				{#if showUserMenu}
					<ChevronDown size={14} class="text-text-tertiary shrink-0" />
				{:else}
					<ChevronUp size={14} class="text-text-tertiary shrink-0" />
				{/if}
			</button>
		{:else}
			<button
				class="relative z-50 cursor-pointer"
				onclick={() => {
					sidebarExpanded.set(true);
					showUserMenu = true;
				}}
			>
				<Avatar name={user.name} url={user.avatarUrl} size="lg" />
			</button>
		{/if}
	</div>
</aside>

{#if showProgramSwitcher}
	<ProgramSwitcher
		{programs}
		currentProgramId={currentProgram?.id}
		onselect={handleProgramSelect}
		onclose={() => (showProgramSwitcher = false)}
		onmanage={currentProgram
			? () => {
					showProgramSwitcher = false;
					navigateTo(`${programBase}/manage`);
				}
			: undefined}
		oncreate={() => {
			showProgramSwitcher = false;
			navigateTo('/program/new');
		}}
	/>
{/if}
