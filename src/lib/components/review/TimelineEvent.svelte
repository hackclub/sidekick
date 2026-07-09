<script lang="ts">
	import { Ship, CircleX, CircleCheck, MessageSquare, Eye, Pencil, X, Check, Clock, ShieldCheck, Loader2, Type, Link, Image, Gift, AlertTriangle } from 'lucide-svelte';
	import type { TimelineEvent as TEvent, ReviewFieldDefinition } from '$lib/server/protocol/types.js';
	import { wordDiff } from '$lib/utils/diff.js';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { marked, Renderer } from 'marked';

	const mdRenderer = new Renderer();
	mdRenderer.link = ({ href, text }) =>
		`<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

	interface EditData {
		event: TEvent;
		feedbackMessage: string;
		internalMessage?: string;
		justification?: string;
	}

	interface Props {
		event: TEvent;
		actors: Record<string, { name: string; avatarUrl: string | null }>;
		shipHourInfo?: Record<string, { delta: number; cumulative: number }>;
		approvalHourInfo?: Record<string, { cumulative: number }>;
		canAuthorize?: boolean;
		// Save handlers resolve to null on success, or an error message to show
		// the reviewer. Edits are only committed to the display on success.
		onsave?: (data: EditData) => Promise<string | null>;
		onauthorize?: (id: string) => void;
		ondelete?: (id: string) => void;
		oneditpending?: (id: string, reviewerId: string, feedbackMessage: string, justification: string, hoursAssigned: number) => Promise<string | null>;
		authorizing?: string | null;
		// Field definitions by name (from the ships' approveFields/rejectFields),
		// used to label custom field values and render markdown fields as boxes.
		fieldDefs?: Record<string, ReviewFieldDefinition>;
	}

	let { event, actors, shipHourInfo = {}, approvalHourInfo = {}, canAuthorize = false, onsave, onauthorize, ondelete, oneditpending, authorizing = null, fieldDefs = {} }: Props = $props();

	const actor = $derived(actors[event.actorId] ?? { name: event.actorId, avatarUrl: null });

	let editing = $state(false);
	let saving = $state(false);
	let editError = $state<string | null>(null);
	let editFeedback = $state('');
	let editInternal = $state('');
	let editHours = $state(0);
	let savedFeedback: string | null = $state(null);
	let savedInternal: string | null = $state(null);
	let savedHours: number | null = $state(null);

	const displayFeedback = $derived(
		savedFeedback ?? (event.type === 'approval' || event.type === 'authorized_approval' || event.type === 'rejection' || event.type === 'pending_approval' ? event.feedbackMessage : '')
	);
	const displayInternal = $derived(
		savedInternal ?? (event.type === 'approval' || event.type === 'authorized_approval' || event.type === 'pending_approval' ? event.justification : event.type === 'rejection' ? (event.internalMessage ?? '') : '')
	);

	const displayHours = $derived(
		savedHours ?? (event.type === 'pending_approval' ? event.hoursAssigned : 0)
	);

	// Kept as its own derived: inlining `(a === x || a === y) && b` in the template
	// gets miscompiled by Svelte 5.55's strict_equals dev transform, which drops
	// the parentheses and changes the operator precedence.
	const isEditableReview = $derived(event.type === 'rejection' || event.type === 'approval');

	function startEditing() {
		editFeedback = displayFeedback;
		editInternal = displayInternal;
		editHours = displayHours;
		editError = null;
		editing = true;
	}

	function cancelEditing() {
		editing = false;
		editError = null;
	}

	async function saveEditing() {
		if (saving) return;
		saving = true;
		editError = null;

		// Commit-on-success: the displayed values only change once the master
		// endpoint accepted the edit. On failure the editor stays open with the
		// draft and the upstream error, and the display keeps the old values.
		let error: string | null = null;
		if (event.type === 'approval') {
			error = (await onsave?.({
				event,
				feedbackMessage: editFeedback,
				justification: editInternal
			})) ?? null;
		} else if (event.type === 'rejection') {
			error = (await onsave?.({
				event,
				feedbackMessage: editFeedback,
				internalMessage: editInternal
			})) ?? null;
		} else if (event.type === 'pending_approval') {
			error = (await oneditpending?.(event.id, event.actorId, editFeedback, editInternal, editHours)) ?? null;
		}
		saving = false;

		if (error) {
			editError = error;
			return;
		}

		savedFeedback = editFeedback;
		savedInternal = editInternal;
		if (event.type === 'pending_approval') savedHours = editHours;
		editing = false;
	}

	function timeAgo(timestamp: string): string {
		const date = new Date(timestamp);
		const diff = Date.now() - date.getTime();
		const mins = Math.floor(diff / 60000);
		const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
		if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
		const absolute = date.toLocaleDateString('en-US', opts);
		if (mins < 1)
			return 'just now';
		if (mins < 60)
			return `${mins}m ago`;
		const hours = Math.floor(diff / 3600000);
		if (hours < 24)
			return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days === 1)
			return `1 day ago (${absolute})`;
		return `${days} days ago (${absolute})`;
	}

	const URL_RE = /(https?:\/\/[^\s<>)"']+)/g;

	function linkify(text: string): Array<{ type: 'text' | 'link'; value: string }> {
		if (!text) return [];
		const parts: Array<{ type: 'text' | 'link'; value: string }> = [];
		let lastIndex = 0;
		for (const match of text.matchAll(URL_RE)) {
			if (match.index > lastIndex) {
				parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
			}
			parts.push({ type: 'link', value: match[0] });
			lastIndex = match.index + match[0].length;
		}
		if (lastIndex < text.length) {
			parts.push({ type: 'text', value: text.slice(lastIndex) });
		}
		return parts;
	}

	function fmtHours(h: number): string {
		const hours = Math.floor(h);
		const mins = Math.round((h - hours) * 60);
		return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
	}
</script>

{#snippet linkedText(text: string)}
	{#each linkify(text) as part, i (i)}
		{#if part.type === 'link'}
			<!-- eslint-disable svelte/no-navigation-without-resolve --><a href={part.value} target="_blank" rel="noopener noreferrer" class="text-accent underline underline-offset-2 break-all hover:opacity-80">{part.value}</a><!-- eslint-enable svelte/no-navigation-without-resolve -->
		{:else}
			{part.value}
		{/if}
	{/each}
{/snippet}

{#snippet markdownText(text: string)}
	<div class="prose prose-sm max-w-none text-sm tracking-[-0.3px] break-words">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html marked(text, { renderer: mdRenderer, breaks: true })}
	</div>
{/snippet}

{#snippet rewardedOverrideTag(hours: number | undefined)}
	{#if hours !== undefined}
		<span
			class="inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded-tag bg-violet-50 border border-violet-200 text-violet-700 text-[11px] font-medium"
			title="Rewarded hours override — the author is rewarded for this many hours instead of the assigned hours"
		>
			<Gift size={10} />
			rewards {fmtHours(hours)}
		</span>
	{/if}
{/snippet}

{#snippet fieldValues(fields: Record<string, string | number | boolean> | undefined)}
	{#if fields && Object.keys(fields).length > 0}
		{@const entries = Object.entries(fields)}
		{@const mdKeys = new Set(
			entries
				.filter(([k, v]) => fieldDefs[k]?.type === 'markdown' && typeof v === 'string' && v.trim())
				.map(([k]) => k)
		)}
		{#if mdKeys.size > 0}
			<div class="flex flex-col gap-1.5 w-full">
				{#each entries.filter(([k]) => mdKeys.has(k)) as [key, value] (key)}
					<div class="bg-surface rounded-tag p-3 flex flex-col gap-1.5 min-w-0">
						<p class="font-bold text-sm tracking-[-0.3px]">{fieldDefs[key]?.label ?? key}</p>
						{@render markdownText(String(value))}
					</div>
				{/each}
			</div>
		{/if}
		{#if entries.some(([k]) => !mdKeys.has(k))}
			<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary mt-0.5">
				{#each entries.filter(([k]) => !mdKeys.has(k)) as [key, value] (key)}
					<span>
						<span class="font-medium">{fieldDefs[key]?.label ?? key}:</span>
						{#if typeof value === 'boolean'}
							<span class={value ? 'text-check-pass' : 'text-check-fail'}>{value ? 'Yes' : 'No'}</span>
						{:else}
							<span>{value}</span>
						{/if}
					</span>
				{/each}
			</div>
		{/if}
	{/if}
{/snippet}

<div class="flex gap-3 items-start w-full">
	<div class="flex gap-3 items-center shrink-0">
		<div class="size-6 flex items-center justify-center">
			{#if event.type === 'ship'}
				<Ship size={24} class="text-text-primary" />
			{:else if event.type === 'rejection'}
				<CircleX size={24} class="text-check-fail" />
			{:else if event.type === 'approval' || event.type === 'authorized_approval'}
				<CircleCheck size={24} class="text-check-pass" />
			{:else if event.type === 'pending_approval'}
				<Clock size={24} class="text-amber-500" />
			{:else if event.type === 'discarded_approval'}
				<CircleX size={24} class="text-text-tertiary" />
			{:else}
				{#if event.isInternal}
					<Eye size={24} class="text-accent" />
				{:else}
					<MessageSquare size={24} class="text-text-secondary" />
				{/if}
			{/if}
		</div>

		<Avatar name={actor.name} url={actor.avatarUrl} size="md" class="border border-border-card relative z-10" />
	</div>

	<div class="flex flex-col gap-1.5 flex-1 min-w-0">
		<div class="flex items-center justify-between w-full">
			<div class="flex flex-col gap-0.5">
				{#if event.type === 'ship'}
					{@const info = shipHourInfo[event.shipId]}
					{@const delta = info?.delta ?? event.hoursSubmitted ?? 0}
					{@const cumulative = info?.cumulative ?? 0}
					<p class="text-sm tracking-[-0.3px]">
						<!-- eslint-disable svelte/no-useless-mustaches -->
						<span class="font-bold">{actor.name}</span> shipped{#if delta > 0}{' '}<span class="font-bold">{fmtHours(delta)}</span>{/if}{#if cumulative > 0 && cumulative !== delta}{' '}<span class="text-text-tertiary">(total {fmtHours(cumulative)})</span>{/if}
						<!-- eslint-enable svelte/no-useless-mustaches -->
					</p>
				{:else if event.type === 'rejection'}
					<p class="text-sm tracking-[-0.3px]">
						<span class="font-bold">{actor.name}</span> rejected
					</p>
				{:else if event.type === 'authorized_approval'}
					{@const authorizedByActor = actors[event.authorizedByActorId] ?? { name: event.authorizedByActorId, avatarUrl: null }}
					{@const approvalCumulative = approvalHourInfo[event.shipId]?.cumulative ?? 0}
					<p class="text-sm tracking-[-0.3px]">
						<!-- eslint-disable svelte/no-useless-mustaches -->
						<span class="font-bold">{actor.name}</span> approved for <span class="font-bold">{fmtHours(event.hoursAssigned)}</span>
						{#if event.hoursDeflated && event.hoursDeflated > 0}
							<span class="text-text-tertiary">({fmtHours(event.hoursDeflated)} deflation)</span>
						{/if}
						{#if approvalCumulative > 0 && approvalCumulative !== event.hoursAssigned}{' '}<span class="text-text-tertiary">(total {fmtHours(approvalCumulative)})</span>{/if}
						<!-- eslint-enable svelte/no-useless-mustaches -->
						{@render rewardedOverrideTag(event.rewardedHoursOverride)}
						<span class="inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded-tag bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-medium">
							<ShieldCheck size={10} />
							Authorized by
							{#if authorizedByActor.avatarUrl}
								<img src={authorizedByActor.avatarUrl} alt="" class="size-3.5 rounded-full object-cover" />
							{/if}
							{authorizedByActor.name}
						</span>
					</p>
				{:else if event.type === 'approval'}
					{@const approvalCumulative = approvalHourInfo[event.shipId]?.cumulative ?? 0}
					<p class="text-sm tracking-[-0.3px]">
						<!-- eslint-disable svelte/no-useless-mustaches -->
						<span class="font-bold">{actor.name}</span> approved for <span class="font-bold">{fmtHours(event.hoursAssigned)}</span>
						{#if event.hoursDeflated && event.hoursDeflated > 0}
							<span class="text-text-tertiary">({fmtHours(event.hoursDeflated)} deflation)</span>
						{/if}
						{#if approvalCumulative > 0 && approvalCumulative !== event.hoursAssigned}{' '}<span class="text-text-tertiary">(total {fmtHours(approvalCumulative)})</span>{/if}
						<!-- eslint-enable svelte/no-useless-mustaches -->
						{@render rewardedOverrideTag(event.rewardedHoursOverride)}
					</p>
				{:else if event.type === 'pending_approval'}
					<p class="text-sm tracking-[-0.3px]">
						<span class="font-bold">{actor.name}</span> approved for <span class="font-bold">{fmtHours(displayHours)}</span>
						{#if displayHours !== event.hoursAssigned}
							<span class="text-text-tertiary line-through">{fmtHours(event.hoursAssigned)}</span>
						{/if}
						{@render rewardedOverrideTag(event.rewardedHoursOverride)}
						<span class="inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded-tag bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-medium">
							<Clock size={10} />
							Pending authorization
						</span>
					</p>
				{:else if event.type === 'discarded_approval'}
					{@const discardedByActor = actors[event.discardedByActorId] ?? { name: event.discardedByActorId, avatarUrl: null }}
					<p class="text-sm tracking-[-0.3px] text-text-tertiary">
						<span class="font-bold">{actor.name}</span> approved for <span class="font-bold">{fmtHours(event.hoursAssigned)}</span>
						{@render rewardedOverrideTag(event.rewardedHoursOverride)}
						<span class="inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded-tag bg-surface border border-border-card text-text-tertiary text-[11px] font-medium">
							Discarded by
							{#if discardedByActor.avatarUrl}
								<img src={discardedByActor.avatarUrl} alt="" class="size-3.5 rounded-full object-cover" />
							{/if}
							{discardedByActor.name}
						</span>
					</p>
				{:else}
					<p class="text-sm tracking-[-0.3px]">
						<span class="font-bold">{actor.name}</span>
						{event.isInternal ? 'left an internal note' : 'commented'}
					</p>
				{/if}
				<p class="text-xs text-text-primary tracking-[-0.24px]">{timeAgo(event.timestamp)}</p>
			</div>

			{#if event.type === 'pending_approval' && canAuthorize && !editing}
				<div class="flex items-center gap-1.5">
					<button
						class="bg-white border border-border-active rounded-tag p-2 flex items-center justify-center hover:bg-surface transition-colors cursor-pointer"
						onclick={startEditing}
						title="Edit pending approval"
					>
						<Pencil size={14} />
					</button>
					<button
						class="flex items-center gap-1.5 px-3 py-1.5 rounded-tag text-xs font-medium bg-check-pass text-white hover:opacity-90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
						onclick={() => onauthorize?.(event.id)}
						disabled={authorizing === event.id}
						title="Authorize this approval"
					>
						{#if authorizing === event.id}
							<Loader2 size={12} class="animate-spin" />
						{:else}
							<ShieldCheck size={12} />
						{/if}
						Authorize
					</button>
					<button
						class="flex items-center gap-1.5 px-3 py-1.5 rounded-tag text-xs font-medium text-check-fail hover:bg-check-fail/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
						onclick={() => ondelete?.(event.id)}
						disabled={authorizing === event.id}
						title="Discard this pending approval"
					>
						<CircleX size={12} />
						Discard
					</button>
				</div>
			{:else if isEditableReview && onsave && !editing}
				<button
					class="bg-white border border-border-active rounded-tag p-2 flex items-center justify-center hover:bg-surface transition-colors cursor-pointer"
					onclick={startEditing}
					title="Edit review"
				>
					<Pencil size={14} />
				</button>
			{/if}
		</div>

		{#if event.type === 'ship' && event.changes && event.changes.length > 0}
			<div class="flex flex-col gap-1.5 w-full mt-1">
				{#each event.changes as change, i (i)}
					<div class="flex flex-col gap-0.5 min-w-0">
						<span class="flex items-center gap-1 text-text-tertiary text-[12px] font-medium">
							{#if change.diffType === 'url'}
								<Link size={11} />
							{:else if change.diffType === 'image'}
								<Image size={11} />
							{:else}
								<Type size={11} />
							{/if}
							{change.label}
						</span>
						{#if change.diffType === 'text'}
							{@const segments = change.oldValue ? wordDiff(change.oldValue, change.newValue) : [{ type: 'add' as const, value: change.newValue }]}
							<p class="text-[12px] font-mono leading-relaxed break-words">
								{#each segments as seg, i (i)}
									{#if seg.type === 'equal'}
										<span class="text-text-secondary">{seg.value}</span>
									{:else if seg.type === 'remove'}
										<span class="bg-check-fail/10 text-check-fail line-through">{seg.value}</span>
									{:else}
										<span class="bg-check-pass/10 text-check-pass">{seg.value}</span>
									{/if}
								{/each}
							</p>
						{:else}
							<div class="flex items-baseline gap-2 min-w-0">
								{#if change.oldValue}
									<code class="text-check-fail/70 line-through truncate text-[12px]" title={change.oldValue}>{change.oldValue}</code>
									<span class="text-text-tertiary shrink-0 text-[11px]">&rarr;</span>
								{/if}
								<code class="text-text-primary truncate text-[12px]" title={change.newValue}>{change.newValue}</code>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if event.type === 'ship' && event.displayFields && event.displayFields.length > 0}
			<div class="flex flex-col gap-1.5 w-full">
				{#each event.displayFields as field, i (i)}
					<div class="{field.isInternal ? 'bg-accent-bg-warm border border-dashed border-accent' : 'bg-surface'} rounded-tag p-3 flex flex-col gap-1.5 min-w-0">
						<p class="font-bold text-sm tracking-[-0.3px] flex items-center gap-1.5">
							{field.label}
							{#if field.isInternal}
								<Eye size={12} class="text-accent" />
							{/if}
						</p>
						<p class="text-sm tracking-[-0.3px] break-words">{@render linkedText(field.value)}</p>
					</div>
				{/each}
			</div>
		{/if}

		{#if event.type === 'rejection'}
			<div class="flex gap-1.5 w-full">
				<div class="bg-surface rounded-tag p-3 flex flex-col gap-1.5 flex-1 basis-0 min-w-0">
					<p class="font-bold text-sm tracking-[-0.3px]">Reviewer message</p>
					{#if editing}
						<textarea
							bind:value={editFeedback}
							rows="3"
							class="text-sm tracking-[-0.3px] bg-white border border-border-input rounded-tag px-2.5 py-2 resize-y outline-none focus:border-accent transition-colors"
						></textarea>
					{:else}
						{@render markdownText(displayFeedback)}
					{/if}
				</div>
				{#if displayInternal || editing}
					<div class="bg-accent-bg-warm border border-dashed border-accent rounded-tag p-3 flex flex-col gap-1.5 flex-1 basis-0 min-w-0">
						<p class="font-bold text-sm tracking-[-0.3px]">Internal note</p>
						{#if editing}
							<textarea
								bind:value={editInternal}
								rows="3"
								class="text-sm tracking-[-0.3px] bg-white border border-dashed border-accent rounded-tag px-2.5 py-2 resize-y outline-none focus:border-accent transition-colors"
							></textarea>
						{:else}
							{@render markdownText(displayInternal)}
						{/if}
					</div>
				{/if}
			</div>
			{@render fieldValues(event.fields)}
		{:else if event.type === 'authorized_approval'}
			<div class="flex gap-1.5 w-full">
				<div class="bg-surface rounded-tag p-3 flex flex-col gap-1.5 flex-1 basis-0 min-w-0">
					<p class="font-bold text-sm tracking-[-0.3px]">Reviewer message</p>
					{@render markdownText(displayFeedback)}
				</div>
				<div class="bg-accent-bg-warm border border-dashed border-accent rounded-tag p-3 flex flex-col gap-1.5 flex-1 basis-0 min-w-0">
					<p class="font-bold text-sm tracking-[-0.3px]">Justification</p>
					{@render markdownText(displayInternal)}
				</div>
			</div>
			{@render fieldValues(event.fields)}
		{:else if event.type === 'approval'}
			<div class="flex gap-1.5 w-full">
				<div class="bg-surface rounded-tag p-3 flex flex-col gap-1.5 flex-1 basis-0 min-w-0">
					<p class="font-bold text-sm tracking-[-0.3px]">Reviewer message</p>
					{#if editing}
						<textarea
							bind:value={editFeedback}
							rows="3"
							class="text-sm tracking-[-0.3px] bg-white border border-border-input rounded-tag px-2.5 py-2 resize-y outline-none focus:border-accent transition-colors"
						></textarea>
					{:else}
						{@render markdownText(displayFeedback)}
					{/if}
				</div>
				<div class="bg-accent-bg-warm border border-dashed border-accent rounded-tag p-3 flex flex-col gap-1.5 flex-1 basis-0 min-w-0">
					<p class="font-bold text-sm tracking-[-0.3px]">Justification</p>
					{#if editing}
						<textarea
							bind:value={editInternal}
							rows="3"
							class="text-sm tracking-[-0.3px] bg-white border border-dashed border-accent rounded-tag px-2.5 py-2 resize-y outline-none focus:border-accent transition-colors"
						></textarea>
					{:else}
						{@render markdownText(displayInternal)}
					{/if}
				</div>
			</div>
			{@render fieldValues(event.fields)}
		{:else if event.type === 'pending_approval'}
			{#if editing}
				<div class="flex flex-col gap-1 w-full">
					<label class="font-bold text-sm tracking-[-0.3px]">Hours to assign</label>
					<input
						type="number"
						step="0.01"
						min="0"
						bind:value={editHours}
						class="border border-amber-300 rounded-tag px-2.5 py-2 text-sm w-full bg-white outline-none focus:border-accent transition-colors"
					/>
				</div>
			{/if}
			<div class="flex gap-1.5 w-full">
				<div class="border border-dashed border-amber-300 bg-amber-50/50 rounded-tag p-3 flex flex-col gap-1.5 flex-1 basis-0 min-w-0">
					<p class="font-bold text-sm tracking-[-0.3px]">Reviewer message</p>
					{#if editing}
						<textarea
							bind:value={editFeedback}
							rows="3"
							class="text-sm tracking-[-0.3px] bg-white border border-amber-300 rounded-tag px-2.5 py-2 resize-y outline-none focus:border-accent transition-colors"
						></textarea>
					{:else}
						{@render markdownText(displayFeedback)}
					{/if}
				</div>
				<div class="border border-dashed border-amber-300 bg-amber-50/50 rounded-tag p-3 flex flex-col gap-1.5 flex-1 basis-0 min-w-0">
					<p class="font-bold text-sm tracking-[-0.3px]">Justification</p>
					{#if editing}
						<textarea
							bind:value={editInternal}
							rows="3"
							class="text-sm tracking-[-0.3px] bg-white border border-amber-300 rounded-tag px-2.5 py-2 resize-y outline-none focus:border-accent transition-colors"
						></textarea>
					{:else}
						{@render markdownText(displayInternal)}
					{/if}
				</div>
			</div>
			{@render fieldValues(event.fields)}
		{:else if event.type === 'discarded_approval'}
			<div class="flex gap-1.5 w-full opacity-50">
				<div class="border border-border-card bg-surface/50 rounded-tag p-3 flex flex-col gap-1.5 flex-1 basis-0 min-w-0">
					<p class="font-bold text-sm tracking-[-0.3px] text-text-tertiary">Reviewer message</p>
					<p class="text-sm tracking-[-0.3px] text-text-tertiary break-words">{@render linkedText(event.feedbackMessage)}</p>
				</div>
				<div class="border border-border-card bg-surface/50 rounded-tag p-3 flex flex-col gap-1.5 flex-1 basis-0 min-w-0">
					<p class="font-bold text-sm tracking-[-0.3px] text-text-tertiary">Justification</p>
					<p class="text-sm tracking-[-0.3px] text-text-tertiary break-words">{@render linkedText(event.justification)}</p>
				</div>
			</div>
			{@render fieldValues(event.fields)}
		{:else if event.type === 'comment'}
			<div class="{event.isInternal ? 'bg-accent-bg-warm border border-dashed border-accent' : 'bg-surface'} rounded-tag p-3">
				<p class="text-sm tracking-[-0.3px]">{@render linkedText(event.message)}</p>
			</div>
		{/if}

		{#if editing}
			{#if editError}
				<div class="flex items-center gap-1.5 text-check-fail">
					<AlertTriangle size={14} class="shrink-0" />
					<span class="text-sm font-medium">{editError}</span>
				</div>
			{/if}
			<div class="flex items-center justify-end gap-1.5">
				<button
					class="flex items-center gap-1.5 px-3 py-1.5 rounded-tag text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface transition-colors cursor-pointer"
					onclick={cancelEditing}
					disabled={saving}
				>
					<X size={12} />
					Cancel
				</button>
				<button
					class="flex items-center gap-1.5 px-3 py-1.5 rounded-tag text-xs font-medium bg-accent text-white hover:opacity-90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
					onclick={saveEditing}
					disabled={saving}
				>
					{#if saving}
						<Loader2 size={12} class="animate-spin" />
					{:else}
						<Check size={12} />
					{/if}
					{saving ? 'Saving...' : 'Save'}
				</button>
			</div>
		{/if}
	</div>
</div>
