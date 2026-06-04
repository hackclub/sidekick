<script lang="ts">
	import type { PageData } from './$types.js';
	import { resolve } from '$app/paths';
	import { LogIn, Scale, Package, Shield, ArrowRight } from 'lucide-svelte';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
</script>

{#if !data.user}
	<div class="min-h-screen bg-sidebar flex items-center justify-center p-6">
		<div class="flex rounded-card overflow-hidden shadow-card max-w-[900px] w-full min-h-[520px]">
			<div class="bg-accent flex-1 p-12 flex flex-col justify-between text-white">
				<div class="flex flex-col gap-8">
					<div class="flex flex-col gap-3">
						<h1 class="font-bold text-[40px] tracking-[-1.6px] leading-none">Sidekick</h1>
						<p class="text-[18px] tracking-[-0.36px] text-white/80 leading-relaxed">
							Review projects, fulfill orders, and manage YSWS programs.
						</p>
					</div>

					<div class="flex flex-col gap-5 mt-4">
						<div class="flex items-center gap-4">
							<Scale size={22} class="text-white/70 shrink-0" />
							<span class="text-[16px] tracking-[-0.32px] text-white/90">Project review with automated checks</span>
						</div>
						<div class="flex items-center gap-4">
							<Package size={22} class="text-white/70 shrink-0" />
							<span class="text-[16px] tracking-[-0.32px] text-white/90">Multi-format order fulfillment</span>
						</div>
						<div class="flex items-center gap-4">
							<Shield size={22} class="text-white/70 shrink-0" />
							<span class="text-[16px] tracking-[-0.32px] text-white/90">Hackatime fraud detection</span>
						</div>
					</div>
				</div>

				<p class="text-sm text-white/50 tracking-[-0.26px]">Hack Club Internal</p>
			</div>

			<div class="bg-page flex-1 p-12 flex flex-col justify-center">
				<div class="flex flex-col gap-10 max-w-[320px] mx-auto w-full">
					<h2 class="font-bold text-[28px] tracking-[-0.84px] text-text-primary">
						Sign in to Sidekick
					</h2>

					<a
						href={resolve('/auth/login')}
						class="group flex items-center justify-center gap-3 bg-accent hover:bg-accent/90 text-white rounded-input h-[52px] transition-colors"
					>
						<LogIn size={18} />
						<span class="font-bold text-[16px] tracking-[-0.32px]">Continue with Hack Club</span>
					</a>

					<p class="text-[14px] text-text-tertiary tracking-[-0.28px] text-center leading-relaxed">
						You'll be redirected to Hack Club Auth. Only authorized Hack Club staff can access Sidekick.
					</p>
				</div>
			</div>
		</div>
	</div>
{:else if data.programs.length > 0}
	<div class="flex items-center justify-center h-full">
		<div class="flex flex-col items-center gap-6 max-w-md w-full">
			<div class="flex flex-col items-center gap-1">
				<h1 class="font-bold text-[22px] tracking-[-0.66px]">Welcome back, {data.user.name}</h1>
				<p class="text-[14px] text-text-secondary tracking-[-0.28px]">Select a program to get started.</p>
			</div>
			<div class="flex flex-col gap-2 w-full">
				{#each data.programs as program (program.id)}
					<a
						href={resolve(`/program/${program.id}`)}
						class="group border border-border-card rounded-section px-5 py-3.5 flex items-center gap-3 hover:border-accent hover:bg-accent-bg transition-all"
					>
						{#if program.iconUrl}
							<img src={program.iconUrl} alt="" class="size-9 object-cover rounded-tag" />
						{:else}
							<div class="size-9 bg-surface rounded-tag flex items-center justify-center font-bold text-sm">
								{program.name.charAt(0)}
							</div>
						{/if}
						<div class="flex-1 min-w-0">
							<span class="font-bold text-[14px] tracking-[-0.28px] block">{program.name}</span>
							{#if program.description}
								<span class="text-[12px] text-text-secondary truncate block">{program.description}</span>
							{/if}
						</div>
						<ArrowRight size={16} class="text-text-tertiary group-hover:text-accent transition-colors shrink-0" />
					</a>
				{/each}
			</div>
		</div>
	</div>
{:else}
	<div class="flex items-center justify-center h-full">
		<div class="text-center flex flex-col items-center gap-3">
			<div class="size-12 bg-surface rounded-full flex items-center justify-center">
				<Package size={22} class="text-text-tertiary" />
			</div>
			<h1 class="font-bold text-[22px] tracking-[-0.66px]">Welcome to Sidekick</h1>
			<p class="text-[14px] text-text-secondary tracking-[-0.28px] max-w-sm">
				You don't have access to any programs yet. Ask a program author to invite you.
			</p>
		</div>
	</div>
{/if}
