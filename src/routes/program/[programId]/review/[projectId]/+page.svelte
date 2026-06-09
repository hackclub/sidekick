<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types.js';
	import UserCard from '$lib/components/ui/UserCard.svelte';
	import HourBreakdown from '$lib/components/review/HourBreakdown.svelte';
	import ProjectCard from '$lib/components/review/ProjectCard.svelte';
	import CheckList from '$lib/components/review/CheckList.svelte';
	import Timeline from '$lib/components/review/Timeline.svelte';
	import ReviewActionPanel from '$lib/components/review/ReviewActionPanel.svelte';
	import MultiSourceDetails from '$lib/components/review/MultiSourceDetails.svelte';
	import AirtableRecords from '$lib/components/review/AirtableRecords.svelte';
	import HackatimeViewer from '$lib/components/review/HackatimeViewer.svelte';
	import { ChevronLeft } from 'lucide-svelte';
	import type { TimelineEvent as TEvent } from '$lib/server/protocol/types.js';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	let submitting = $state(false);
	let reviewPanelRef = $state<HTMLElement | null>(null);
	let authorizing = $state<string | null>(null);

	function normalizeForCompare(s: string): string {
		return s.toLowerCase().replace(/[^a-z0-9]/g, '');
	}

	let hackatime = $state<Awaited<typeof data.hackatimeData> | null>(null);
	let airtable = $state<Awaited<typeof data.airtableData> | null>(null);
	let github = $state<Awaited<typeof data.githubData> | null>(null);
	let lapse = $state<Awaited<typeof data.lapseData> | null>(null);

	$effect(() => { hackatime = null; data.hackatimeData.then((v) => { hackatime = v; }); });
	$effect(() => { airtable = null; data.airtableData.then((v) => { airtable = v; }); });
	$effect(() => { github = null; data.githubData.then((v) => { github = v; }); });
	$effect(() => { lapse = null; data.lapseData.then((v) => { lapse = v; }); });

	let polledChecks = $state<typeof data.checks | null>(null);
	const checks = $derived(polledChecks ?? data.checks);

	$effect(() => {
		const shipId = data.checkShipId;
		const programId = data.program.id;
		if (!shipId)
			return;

		let active = true;

		const poll = async () => {
			if (!active)
				return;
			try {
				const res = await fetch(`/api/programs/${programId}/checks/${shipId}`);
				if (!res.ok || !active)
					return;
				const result = await res.json();
				polledChecks = result.checks;
				if (result.allCompleted) { active = false; }
			} catch { /* expected */ }
		};

		const interval = setInterval(poll, 1500);
		const timeout = setTimeout(() => { active = false; }, 120000);

		return () => {
			active = false;
			clearInterval(interval);
			clearTimeout(timeout);
		};
	});

	const changelogContext = $derived.by(() => {
		const ships = data.project.ships;
		if (ships.length < 2 || !data.pendingShip || !data.project.codeUrl)
			return null;
		const pendingIdx = ships.findIndex((s) => s.id === data.pendingShip!.id);
		const prevShip = pendingIdx > 0 ? ships[pendingIdx - 1] : ships.length >= 2 ? ships[ships.length - 2] : null;
		if (!prevShip)
			return null;

		const dayMs = 86400000;
		const sinceDate = new Date(new Date(prevShip.submittedAt).getTime() - dayMs).toISOString();
		const untilRaw = new Date(new Date(data.pendingShip.submittedAt).getTime() + dayMs);
		const today = new Date();
		const untilDate = (untilRaw > today ? today : untilRaw).toISOString();

		return {
			programId: data.program.id,
			repoUrl: data.project.codeUrl,
			previousShipDate: sinceDate,
			currentShipDate: untilDate
		};
	});

	const overviewContext = $derived.by(() => {
		const ships = data.project.ships;
		if (ships.length >= 2 || !data.pendingShip || !data.project.codeUrl)
			return null;
		return {
			programId: data.program.id,
			repoUrl: data.project.codeUrl,
			projectTitle: data.project.title,
			projectDescription: data.project.description
		};
	});

	const shippedDeltaHours = $derived.by(() => {
		if (!data.pendingShip)
			return undefined;
		const ships = data.project.ships;
		const priorHours = ships
			.filter((s) => s.id !== data.pendingShip!.id)
			.reduce((sum, s) => sum + s.hoursSubmitted, 0);
		return Math.max(0, data.pendingShip.hoursSubmitted - priorHours);
	});

	const externalPreviousHours = $derived.by(() => {
		if (!airtable?.airtableRecords)
			return 0;
		const normYsws = normalizeForCompare(data.programYswsName);
		return airtable.airtableRecords
			.filter((r) => r.hours > 0 && normalizeForCompare(r.id.split('–')[0]?.trim() || r.id) !== normYsws)
			.reduce((sum, r) => sum + r.hours, 0);
	});

	const remainingHours = $derived.by(() => {
		const delta = shippedDeltaHours;
		if (!hackatime?.hackatime)
			return delta ?? 0;
		const totalH = hackatime.hackatime.totalSeconds / 3600;
		const baseH = delta != null ? Math.min(totalH, delta) : totalH;
		const aiRatio = totalH > 0 ? hackatime.hackatime.aiSeconds / 3600 / totalH : 0;
		const scaledAiH = baseH * aiRatio;
		return Math.max(0, baseH - scaledAiH - externalPreviousHours);
	});

	function handleReviewSubmit(reviewData: {
		action: string;
		hoursAssigned?: number;
		feedbackMessage?: string;
		justification?: string;
		internalMessage?: string;
		commentText?: string;
	}) {
		submitting = true;

		const form = document.createElement('form');
		form.method = 'POST';
		form.action = '?/review';

		if (data.pendingShip) {
			const shipInput = document.createElement('input');
			shipInput.type = 'hidden';
			shipInput.name = 'shipId';
			shipInput.value = data.pendingShip.id;
			form.appendChild(shipInput);
		}

		for (const [key, value] of Object.entries(reviewData)) {
			if (value !== undefined) {
				const input = document.createElement('input');
				input.type = 'hidden';
				input.name = key;
				input.value = String(value);
				form.appendChild(input);
			}
		}

		document.body.appendChild(form);
		form.submit();
	}

	async function handleSaveReview(editData: {
		event: TEvent;
		feedbackMessage: string;
		internalMessage?: string;
		justification?: string;
	}) {
		const event = editData.event;
		if (event.type !== 'approval' && event.type !== 'rejection')
			return;

		const res = await fetch(`/api/programs/${data.program.id}/review/${event.shipId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				type: event.type,
				reviewerId: event.actorId,
				feedbackMessage: editData.feedbackMessage,
				justification: editData.justification,
				internalMessage: editData.internalMessage
			})
		});

		if (res.ok) {
			await invalidateAll();
		}
	}

	async function handleAuthorize(pendingApprovalId: string) {
		authorizing = pendingApprovalId;
		try {
			const res = await fetch(`/api/programs/${data.program.id}/review/authorize`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pendingApprovalId })
			});
			if (res.ok) {
				await invalidateAll();
			}
		} finally {
			authorizing = null;
		}
	}

	async function handleDeletePending(pendingApprovalId: string) {
		authorizing = pendingApprovalId;
		try {
			const res = await fetch(`/api/programs/${data.program.id}/review/authorize`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pendingApprovalId })
			});
			if (res.ok) {
				await invalidateAll();
			}
		} finally {
			authorizing = null;
		}
	}

	async function handleEditPending(pendingApprovalId: string, feedbackMessage: string, justification: string) {
		await fetch(`/api/programs/${data.program.id}/review/authorize`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ pendingApprovalId, feedbackMessage, justification })
		});
	}
</script>

<div class="flex flex-col h-full">
	<div class="border-b border-border-input flex h-11 items-center justify-between px-4 shrink-0 min-w-0">
		<div class="flex gap-4 items-center min-w-0 flex-1">
			<a
				href={resolve(`/program/${data.program.id}/review`)}
				class="shrink-0 border border-border-button rounded-md flex gap-1.5 h-8 items-center justify-center px-3 hover:bg-surface transition-colors"
			>
				<ChevronLeft size={14} />
				<span class="font-medium text-sm text-text-subtle tracking-[-0.3px]">Queue</span>
			</a>

			<div class="flex gap-1.5 items-center text-sm tracking-[-0.4px] min-w-0 truncate">
				<span class="text-text-secondary shrink-0">#{data.project.id}</span>
				<span class="font-bold truncate">{data.project.title}</span>
				<span class="shrink-0">by</span>
				<div class="flex gap-1 items-center shrink-0">
					{#if data.author.avatarUrl}
						<img src={data.author.avatarUrl} alt="" class="size-[18px] rounded-full object-cover" />
					{/if}
					<span class="font-bold">{data.author.name}</span>
				</div>
			</div>
		</div>

		<div class="flex gap-4 items-center shrink-0 ml-4">
			<span class="text-sm tracking-[-0.3px] hidden lg:inline">
				<span class="font-bold">{data.pendingCount}</span> projects left in queue.
			</span>
		</div>
	</div>

	<div class="flex-1 overflow-auto px-4 md:px-6 wide:px-16 py-10">
		<div class="review-bento gap-3">
			<div class="flex flex-col gap-3" style="grid-area: user">
				<UserCard
					name={data.author.name}
					avatarUrl={data.author.avatarUrl}
					joinDate={data.author.joinDate}
					slackId={data.author.slackId}
					hackatimeId={data.author.hackatimeId}
					email={data.author.email}
					trustLevel={hackatime?.trustLevel ?? null}
					loading={!hackatime}
				/>
				<HourBreakdown
					aggregatedSeconds={hackatime?.hackatime?.totalSeconds ?? 0}
					shippedHours={shippedDeltaHours}
					aiSeconds={hackatime?.hackatime?.aiSeconds ?? 0}
					previousShips={(airtable?.airtableRecords ?? [])
						.filter((r) => r.hours > 0 && normalizeForCompare(r.id.split('–')[0]?.trim() || r.id) !== normalizeForCompare(data.programYswsName))
						.map((r) => ({ programName: r.id.split('–')[0]?.trim() || r.id, date: '', hours: r.hours, url: r.url }))}
					loading={!hackatime}
					class="flex-1"
				/>
			</div>

			<div class="project-checks-wrapper">
				<div class="flex-1 min-w-0" style="grid-area: project">
					<ProjectCard
						id={data.project.id}
						title={data.project.title}
						description={data.project.description}
						screenshotUrl={data.project.screenshotUrl}
						demoUrl={data.project.demoUrl ?? ''}
						codeUrl={data.project.codeUrl}
						class="h-full"
					/>
				</div>

				<div style="grid-area: checks">
					<CheckList
						{checks}
						class="h-full"
					/>
				</div>
			</div>

			<div class="flex flex-col gap-3" style="grid-area: timeline">
				<Timeline
					events={data.timeline}
					actors={data.actors}
					shipHours={Object.fromEntries(data.project.ships.map((s) => [s.id, s.hoursSubmitted]))}
					canAuthorize={data.canAuthorize}
					onsave={handleSaveReview}
					onauthorize={handleAuthorize}
					ondelete={handleDeletePending}
					oneditpending={handleEditPending}
					{authorizing}
				/>

				{#if data.canReview && data.pendingShip}
					<div bind:this={reviewPanelRef}>
						<ReviewActionPanel
							remainingHours={remainingHours}
							onsubmit={handleReviewSubmit}
							{submitting}
							changelog={changelogContext}
							overview={overviewContext}
							draftKey={data.project.id}
						/>
					</div>
				{/if}
			</div>

			<div class="wide:relative" style="grid-area: multi">
				<div class="flex flex-col gap-3 wide:absolute wide:inset-0 wide:overflow-y-auto">
					<AirtableRecords
						records={airtable?.airtableRecords ?? []}
						loading={!airtable}
					/>
					<MultiSourceDetails
						commits={github?.githubCommits ?? []}
						repoUrl={data.project.codeUrl}
						loading={!github}
						markers={data.timeline
							.filter((e) => e.type === 'ship' || e.type === 'approval' || e.type === 'rejection')
							.map((e) => ({
								type: e.type as 'ship' | 'approval' | 'rejection',
								label: e.type === 'ship'
									? `${data.actors[e.actorId]?.name ?? 'Unknown'} shipped`
									: e.type === 'approval'
										? `Approved for ${(e as Extract<typeof e, { type: 'approval' }>).hoursAssigned}h`
										: `${data.actors[e.actorId]?.name ?? 'Unknown'} rejected`,
								date: e.timestamp
							}))}
						timelapses={lapse?.lapseTimelapses ?? []}
						class="flex-1 min-h-0"
					/>
				</div>
			</div>

			{#if data.hackatimeUser && data.project.hackatimeProjectKeys.length > 0}
				<div style="grid-area: heartbeats">
					<HackatimeViewer
						hackatimeUser={data.hackatimeUser}
						hackatimeProjectKeys={data.project.hackatimeProjectKeys}
						programId={data.program.id}
						defaultDate={data.pendingShip?.submittedAt?.split('T')[0]}
						projectBreakdown={hackatime?.projectBreakdown ?? []}
					/>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.review-bento {
		display: grid;
		grid-template-columns: 1fr;
		grid-template-areas:
			"user"
			"project"
			"checks"
			"multi"
			"heartbeats"
			"timeline";
	}

	@media (min-width: 768px) {
		.review-bento {
			grid-template-columns: minmax(0, 380px) minmax(0, 1fr);
			grid-template-areas:
				"user       project"
				"checks     multi"
				"heartbeats heartbeats"
				"timeline   timeline";
		}
	}

	.project-checks-wrapper {
		display: contents;
	}

	@media (min-width: 1600px) {
		.review-bento {
			grid-template-columns: minmax(0, 380px) minmax(0, 1fr) minmax(0, 540px);
			grid-template-areas:
				"user       top             top"
				"heartbeats heartbeats       multi"
				"timeline   timeline         timeline";
		}

		.project-checks-wrapper {
			grid-area: top;
			display: flex;
			gap: 0.75rem;
			align-items: stretch;
		}
	}
</style>
