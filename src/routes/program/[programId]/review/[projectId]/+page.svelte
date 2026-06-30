<script lang="ts">
	import { createLogger } from '$lib/logger.js';
	import { invalidateAll } from '$app/navigation';
	import { applyAction, deserialize } from '$app/forms';
	import { resolve } from '$app/paths';
	import { AlertTriangle, X } from 'lucide-svelte';
	import type { PageData } from './$types.js';

	const log = createLogger('ReviewPage');
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
	import {
		PROJECT_DETAILS_EXPORT_SCHEMA_VERSION,
		type ProjectDetailsExport
	} from '$lib/review/projectDetailsExport.js';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	let submitting = $state(false);
	let reviewPanelRef = $state<HTMLElement | null>(null);
	let authorizing = $state<string | null>(null);
	let protocolError = $state<string | null>(null);
	let showFuzzyAirtable = $state(false);

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
		let pollCount = 0;
		log.info('Starting check polling', { shipId, programId });

		const poll = async () => {
			if (!active)
				return;
			pollCount++;
			try {
				const res = await fetch(`/api/programs/${programId}/checks/${shipId}`);
				if (!res.ok || !active) {
					if (!res.ok) log.warn('Check poll returned non-ok', { status: res.status, pollCount });
					return;
				}
				const result = await res.json();
				if (result.checks.length > 0) {
					polledChecks = result.checks;
				}
				log.trace('Check poll result', { pollCount, allCompleted: result.allCompleted, checkCount: result.checks?.length });
				if (result.allCompleted) {
					log.info('All checks completed', { pollCount });
					active = false;
				}
			} catch (e) {
				log.debug('Check poll error (expected during loading)', e);
			}
		};

		const interval = setInterval(poll, 1500);
		const timeout = setTimeout(() => {
			log.warn('Check polling timed out after 120s', { shipId, pollCount });
			active = false;
		}, 120000);

		return () => {
			active = false;
			clearInterval(interval);
			clearTimeout(timeout);
			log.debug('Check polling stopped', { shipId, pollCount });
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

	// Map shipId → approved hours from timeline events (accounts for reviewer deflation)
	const approvedHoursMap = $derived.by(() => {
		const map: Record<string, number> = {};
		for (const event of data.timeline) {
			if (event.type === 'approval' || event.type === 'authorized_approval') {
				map[event.shipId] = event.hoursAssigned;
			}
		}
		return map;
	});

	const shippedDeltaHours = $derived.by(() => {
		if (!data.pendingShip)
			return undefined;
		const ships = data.project.ships;
		const lastApprovedCumulative = ships
			.filter((s) => s.id !== data.pendingShip!.id && s.status === 'approved')
			.reduce((max, s) => Math.max(max, s.hoursSubmitted), 0);
		return Math.max(0, data.pendingShip.hoursSubmitted - lastApprovedCumulative);
	});

	const externalPreviousHours = $derived.by(() => {
		if (!airtable?.airtableRecords)
			return 0;
		const normYsws = normalizeForCompare(data.programYswsName);
		return airtable.airtableRecords
			.filter((r) => (showFuzzyAirtable || r.isExact) && r.hours > 0 && normalizeForCompare(r.id.split('–')[0]?.trim() || r.id) !== normYsws)
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

	// Snapshot of everything the reviewer currently sees, shaped to the shared
	// ProjectDetailsExport schema. Integration sections start null and populate
	// as their async sources resolve, so an early copy may legitimately omit them.
	// `exportedAt` is stamped at copy time by ProjectCard, not here.
	const projectDetailsExport = $derived<ProjectDetailsExport>({
		schemaVersion: PROJECT_DETAILS_EXPORT_SCHEMA_VERSION,
		exportedAt: '',
		program: { id: data.program.id, name: data.program.name },
		project: {
			id: data.project.id,
			title: data.project.title,
			description: data.project.description,
			screenshotUrl: data.project.screenshotUrl ?? null,
			demoUrl: data.project.demoUrl ?? null,
			codeUrl: data.project.codeUrl,
			hackatimeProjectKeys: data.project.hackatimeProjectKeys
		},
		author: {
			name: data.author.name,
			email: data.author.email ?? null,
			avatarUrl: data.author.avatarUrl,
			slackId: data.author.slackId ?? null,
			hackatimeId: data.author.hackatimeId,
			joinDate: data.author.joinDate
		},
		ships: data.project.ships.map((s) => ({
			id: s.id,
			hoursSubmitted: s.hoursSubmitted,
			submittedAt: s.submittedAt,
			status: s.status
		})),
		pendingShipId: data.pendingShip?.id ?? null,
		timeline: data.timeline,
		hackatime: hackatime?.hackatime
			? {
					totalSeconds: hackatime.hackatime.totalSeconds,
					aiSeconds: hackatime.hackatime.aiSeconds,
					trustLevel: hackatime.trustLevel,
					projectBreakdown: hackatime.projectBreakdown
				}
			: null,
		github: github
			? {
					isPublic: github.githubIsPublic,
					readme: github.githubReadme,
					commits: github.githubCommits
				}
			: null,
		airtable: airtable
			? { records: airtable.airtableRecords, previousHours: airtable.airtablePreviousHours }
			: null,
		lapse: lapse ? { timelapses: lapse.lapseTimelapses } : null
	});

	async function handleReviewSubmit(reviewData: {
		action: string;
		hoursAssigned?: number;
		feedbackMessage?: string;
		justification?: string;
		internalMessage?: string;
		commentText?: string;
		fields?: Record<string, string | number | boolean>;
	}) {
		submitting = true;
		log.info('Submitting review', { action: reviewData.action, shipId: data.pendingShip?.id });
		const t = log.time('handleReviewSubmit');

		const formData = new FormData();
		if (data.pendingShip) {
			formData.set('shipId', data.pendingShip.id);
		}
		for (const [key, value] of Object.entries(reviewData)) {
			if (value !== undefined) {
				if (key === 'fields') {
					formData.set(key, JSON.stringify(value));
				} else {
					formData.set(key, String(value));
				}
			}
		}

		const response = await fetch('?/review', { method: 'POST', body: formData });
		const result = deserialize(await response.text());
		t.end('resultType', result.type);
		if (result.type === 'success') {
			protocolError = null;
			log.info('Review submitted successfully');
			await invalidateAll();
		} else if (result.type === 'failure' && result.data?.protocolError) {
			protocolError = result.data.protocolError as string;
			log.error('Review submission protocol error', { protocolError });
		}
		await applyAction(result);
		submitting = false;
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

		log.info('Saving review edit', { shipId: event.shipId, type: event.type });
		const t = log.time('handleSaveReview');
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

		t.end('status', res.status);
		if (res.ok) {
			log.debug('Review edit saved successfully');
			await invalidateAll();
		} else {
			log.error('Failed to save review edit', { status: res.status });
		}
	}

	async function handleAuthorize(pendingApprovalId: string) {
		authorizing = pendingApprovalId;
		log.info('Authorizing pending approval', { pendingApprovalId });
		const t = log.time('handleAuthorize');
		try {
			const res = await fetch(`/api/programs/${data.program.id}/review/authorize`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pendingApprovalId })
			});
			t.end('status', res.status);
			if (res.ok) {
				protocolError = null;
				log.info('Authorization successful', { pendingApprovalId });
				await invalidateAll();
			} else {
				const body = await res.json().catch(() => null);
				protocolError = body?.message ?? `Authorization failed (HTTP ${res.status})`;
				log.error('Authorization failed', { pendingApprovalId, status: res.status, protocolError });
			}
		} finally {
			authorizing = null;
		}
	}

	async function handleDeletePending(pendingApprovalId: string) {
		authorizing = pendingApprovalId;
		log.info('Deleting pending approval', { pendingApprovalId });
		const t = log.time('handleDeletePending');
		try {
			const res = await fetch(`/api/programs/${data.program.id}/review/authorize`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pendingApprovalId })
			});
			t.end('status', res.status);
			if (res.ok) {
				protocolError = null;
				log.info('Pending approval deleted', { pendingApprovalId });
				await invalidateAll();
			} else {
				const body = await res.json().catch(() => null);
				protocolError = body?.message ?? `Discard failed (HTTP ${res.status})`;
				log.error('Failed to delete pending approval', { pendingApprovalId, status: res.status, protocolError });
			}
		} finally {
			authorizing = null;
		}
	}

	async function handleEditPending(pendingApprovalId: string, reviewerId: string, feedbackMessage: string, justification: string, hoursAssigned: number) {
		log.info('Editing pending approval', { pendingApprovalId, hoursAssigned });
		const t = log.time('handleEditPending');
		const res = await fetch(`/api/programs/${data.program.id}/review/authorize`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ pendingApprovalId, reviewerId, feedbackMessage, justification, hoursAssigned })
		});
		t.end('status', res.status);
		if (!res.ok) {
			log.error('Failed to edit pending approval', { pendingApprovalId, status: res.status });
		} else {
			log.debug('Pending approval edited successfully');
			await invalidateAll();
		}
	}
</script>

<svelte:head>
	<title>{data.project.title} - {data.program.name} - Sidekick</title>
</svelte:head>

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
					trustLogs={hackatime?.trustLogs ?? []}
					loading={!hackatime}
				/>
				<HourBreakdown
					aggregatedSeconds={hackatime?.hackatime?.totalSeconds ?? 0}
					shippedHours={shippedDeltaHours}
					aiSeconds={hackatime?.hackatime?.aiSeconds ?? 0}
					previousShips={(airtable?.airtableRecords ?? [])
						.filter((r) => (showFuzzyAirtable || r.isExact) && r.hours > 0 && normalizeForCompare(r.id.split('–')[0]?.trim() || r.id) !== normalizeForCompare(data.programYswsName))
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
						details={projectDetailsExport}
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
				{#if protocolError}
					<div class="flex items-start gap-2 px-4 py-3 rounded-section bg-check-fail/10 border border-check-fail/30 text-sm text-check-fail">
						<AlertTriangle size={16} class="shrink-0 mt-0.5" />
						<span class="flex-1">{protocolError}</span>
						<button onclick={() => (protocolError = null)} class="shrink-0 cursor-pointer hover:opacity-70">
							<X size={14} />
						</button>
					</div>
				{/if}
				<Timeline
					events={data.timeline}
					actors={data.actors}
					shipHours={Object.fromEntries(data.project.ships.map((s) => [s.id, s.hoursSubmitted]))}
					approvedShipHours={approvedHoursMap}
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
							approveFields={data.pendingShip.approveFields}
							rejectFields={data.pendingShip.rejectFields}
						/>
					</div>
				{/if}
			</div>

			<div class="md:relative md:min-h-[32rem]" style="grid-area: multi">
				<div class="flex flex-col gap-3 md:absolute md:inset-0 md:overflow-y-auto">
					<AirtableRecords
						records={airtable?.airtableRecords ?? []}
						loading={!airtable}
						bind:showFuzzy={showFuzzyAirtable}
					/>
					<MultiSourceDetails
						commits={github?.githubCommits ?? []}
						repoUrl={data.project.codeUrl}
						programId={data.program.id}
						loading={!github}
						markers={data.timeline
							.filter((e) => e.type === 'ship' || e.type === 'approval' || e.type === 'authorized_approval' || e.type === 'rejection')
							.map((e) => ({
								type: (e.type === 'authorized_approval' ? 'approval' : e.type) as 'ship' | 'approval' | 'rejection',
								label: e.type === 'ship'
									? `${data.actors[e.actorId]?.name ?? 'Unknown'} shipped`
									: e.type === 'approval' || e.type === 'authorized_approval'
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
						defaultDate={data.pendingShip?.submittedAt
							? new Date(data.pendingShip.submittedAt).toLocaleDateString('sv-SE', { timeZone: data.authorTimezone })
							: undefined}
						projectBreakdown={hackatime?.projectBreakdown ?? []}
						authorTimezone={data.authorTimezone}
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
