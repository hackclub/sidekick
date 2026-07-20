<script lang="ts">
	import { createLogger } from '$lib/logger.js';
	import { CircleCheck, CircleX, MessageSquare, Eye, AlertTriangle, Loader2, X, Copy, Sparkles, CircleHelp, Zap, ChevronDown } from 'lucide-svelte';
	import MarkdownTextarea from '$lib/components/ui/MarkdownTextarea.svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import { evaluateArithmetic } from '$lib/utils/math-expr.js';
	import type { ReviewFieldDefinition, ReviewFieldValues } from '$lib/server/protocol/types.js';

	const log = createLogger('ReviewActionPanel');

	type ActionType = 'approve' | 'reject' | 'comment' | 'internal_comment';

	interface PrefillData {
		action: ActionType;
		hoursAssigned?: number;
		feedbackMessage?: string;
		justification?: string;
		internalMessage?: string;
	}

	interface ChangelogContext {
		programId: string;
		repoUrl: string;
		previousShipDate: string;
		currentShipDate: string;
	}

	interface RejectionTemplate {
		id: string;
		name: string;
		feedbackMessage: string;
		internalMessage: string;
	}

	interface OverviewContext {
		programId: string;
		repoUrl: string;
		projectTitle: string;
		projectDescription: string;
	}

	interface Props {
		remainingHours: number;
		onsubmit: (data: {
			action: ActionType;
			hoursAssigned?: number;
			rewardedHoursOverride?: number;
			feedbackMessage?: string;
			justification?: string;
			internalMessage?: string;
			commentText?: string;
			fields?: ReviewFieldValues;
		}) => void;
		submitting?: boolean;
		prefill?: PrefillData | null;
		changelog?: ChangelogContext | null;
		overview?: OverviewContext | null;
		draftKey?: string;
		approveFields?: ReviewFieldDefinition[];
		rejectFields?: ReviewFieldDefinition[];
		rejectionTemplates?: RejectionTemplate[];
		supportsRewardedOverride?: boolean;
		// An approval on this ship is already awaiting HQ authorization — hide the
		// Approve/Reject tabs so a second verdict can't be stacked on top of it.
		hasPendingApproval?: boolean;
	}

	let { remainingHours, onsubmit, submitting = false, prefill = null, changelog = null, overview = null, draftKey = '', approveFields = [], rejectFields = [], rejectionTemplates = [], supportsRewardedOverride = false, hasPendingApproval = false }: Props = $props();

	let selectedAction: ActionType = $state('approve');
	let hoursAssigned = $state(0);
	// A text box rather than a number input so reviewers can type arithmetic
	// like "10.49 - 0.3" — the expression is folded into hoursAssigned as they
	// type, and collapsed to its result on blur. NaN while unparseable.
	let hoursRaw = $state('0');

	function setHours(value: number) {
		hoursAssigned = value;
		hoursRaw = String(value);
	}

	function collapseHoursExpression() {
		const value = evaluateArithmetic(hoursRaw);
		if (value !== null) {
			setHours(Math.round(value * 100) / 100);
		}
	}
	// Kept as a string so an empty input means "no override" — 0 is a valid override.
	let rewardedOverrideRaw = $state('');
	let showOverrideHelp = $state(false);

	// ±1h quick adjust. An empty (or unparseable) box starts from the assigned
	// hours, so the first click reads as "assigned hours, one more/less".
	function bumpOverride(delta: number) {
		const parsed = parseFloat(rewardedOverrideRaw);
		const base = Number.isFinite(parsed) ? parsed : Number(hoursAssigned) || 0;
		rewardedOverrideRaw = String(Math.max(0, Math.round((base + delta) * 100) / 100));
	}
	let userEditedHours = false;
	$effect(() => {
		if (!userEditedHours) {
			setHours(Math.max(0, Math.round(remainingHours * 100) / 100));
		}
	});

	type DraftFields = { feedbackMessage: string; justification: string; internalMessage: string; commentText: string; customFields: ReviewFieldValues };
	const emptyDraft = (): DraftFields => ({ feedbackMessage: '', justification: '', internalMessage: '', commentText: '', customFields: {} });

	function storageKey() { return draftKey ? `review-draft:${draftKey}` : ''; }

	function loadDrafts(): Record<ActionType, DraftFields> {
		const blank = { approve: emptyDraft(), reject: emptyDraft(), comment: emptyDraft(), internal_comment: emptyDraft() };
		const key = storageKey();
		if (!key)
			return blank;
		try {
			const raw = localStorage.getItem(key);
			if (!raw)
				return blank;
			const parsed = JSON.parse(raw);
			if (parsed.selectedAction) {
				selectedAction = parsed.selectedAction;
			}
				const merged = { ...blank, ...parsed.drafts };
			for (const key of Object.keys(blank) as ActionType[]) {
				merged[key] = { ...emptyDraft(), ...merged[key] };
			}
			return merged;
		} catch { return blank; }
	}

	let drafts = $state<Record<ActionType, DraftFields>>(loadDrafts());

	function saveDrafts() {
		const key = storageKey();
		if (!key)
			return;
		localStorage.setItem(key, JSON.stringify({ drafts, selectedAction }));
	}

	$effect(() => {
		void JSON.stringify(drafts);
		void selectedAction;
		saveDrafts();
	});

	const feedbackMessage = $derived(drafts[selectedAction].feedbackMessage);
	const justification = $derived(drafts[selectedAction].justification);
	const internalMessage = $derived(drafts[selectedAction].internalMessage);
	const commentText = $derived(drafts[selectedAction].commentText);
	const customFields = $derived(drafts[selectedAction].customFields);

	const activeFieldDefs = $derived(
		selectedAction === 'approve' ? (approveFields ?? []) :
		selectedAction === 'reject' ? (rejectFields ?? []) :
		[]
	);

	function setCustomField(name: string, value: string | number | boolean) {
		drafts[selectedAction] = { ...drafts[selectedAction], customFields: { ...drafts[selectedAction].customFields, [name]: value } };
	}

	function getCustomFieldDefault(def: ReviewFieldDefinition): string | number | boolean {
		if (def.defaultValue !== undefined) return def.defaultValue;
		if (def.type === 'boolean') return false;
		if (def.type === 'integer') return 0;
		return '';
	}

	$effect(() => {
		for (const def of activeFieldDefs) {
			if (def.defaultValue !== undefined && customFields[def.name] === undefined) {
				setCustomField(def.name, def.defaultValue);
			}
		}
	});

	function setDraft(field: keyof DraftFields, value: string) {
		drafts[selectedAction] = { ...drafts[selectedAction], [field]: value };
	}

	let prefillOpen = $state(false);

	// Prefill only — the reviewer still has to press Reject themselves.
	function applyRejectionTemplate(tpl: RejectionTemplate) {
		drafts.reject = {
			...drafts.reject,
			feedbackMessage: tpl.feedbackMessage,
			internalMessage: tpl.internalMessage
		};
		prefillOpen = false;
	}

	function clearAllDrafts() {
		for (const key of Object.keys(drafts) as ActionType[]) {
			drafts[key] = emptyDraft();
		}
		const sk = storageKey();
		if (sk) {
			localStorage.removeItem(sk);
		}
	}

	let changelogLoading = $state(false);
	let changelogStatus = $state('');
	let changelogThinking = $state('');
	let changelogError = $state('');
	let changelogResult = $state('');
	let changelogCopied = $state(false);

	$effect(() => {
		if (prefill) {
			selectedAction = prefill.action;
			if (prefill.hoursAssigned !== undefined) {
				setHours(prefill.hoursAssigned);
			}
			if (prefill.feedbackMessage !== undefined) {
				setDraft('feedbackMessage', prefill.feedbackMessage);
			}
			if (prefill.justification !== undefined) {
				setDraft('justification', prefill.justification);
			}
			if (prefill.internalMessage !== undefined) {
				setDraft('internalMessage', prefill.internalMessage);
			}
			userEditedHours = true;
		}
	});

	const exceedsRemaining = $derived(hoursAssigned > remainingHours + 0.005);

	const rewardedOverride = $derived.by(() => {
		const trimmed = rewardedOverrideRaw.trim();
		if (!trimmed) return undefined;
		const parsed = parseFloat(trimmed);
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
	});
	const rewardedOverrideInvalid = $derived(rewardedOverrideRaw.trim() !== '' && rewardedOverride === undefined);
	// Warning only — rewarding more than the assigned hours is legitimate, but
	// unusual enough that it's worth flagging as a possible typo.
	const overrideExceedsAssigned = $derived(
		rewardedOverride !== undefined && rewardedOverride > (Number(hoursAssigned) || 0)
	);

	function requiredCustomFieldsFilled(): boolean {
		for (const def of activeFieldDefs) {
			if (!def.required) continue;
			const val = customFields[def.name];
			if (val === undefined || val === null) return false;
			if ((def.type === 'string' || def.type === 'markdown') && typeof val === 'string' && !val.trim()) return false;
		}
		return true;
	}

	const canSubmit = $derived.by(() => {
		if (submitting)
			return false;
		switch (selectedAction) {
			case 'approve':
				return hoursAssigned > 0 && feedbackMessage.trim() && justification.trim() && requiredCustomFieldsFilled() && !rewardedOverrideInvalid;
			case 'reject':
				return feedbackMessage.trim().length > 0 && requiredCustomFieldsFilled();
			case 'comment':
			case 'internal_comment':
				return commentText.trim().length > 0;
		}
	});

	function buildFieldValues(): ReviewFieldValues | undefined {
		if (activeFieldDefs.length === 0) return undefined;
		const values: ReviewFieldValues = {};
		for (const def of activeFieldDefs) {
			const val = customFields[def.name];
			const dflt = getCustomFieldDefault(def);
			if (val !== undefined && val !== null && val !== '' && val !== dflt) {
				values[def.name] = val;
			} else if (def.required) {
				values[def.name] = val ?? dflt;
			}
		}
		return Object.keys(values).length > 0 ? values : undefined;
	}

	function handleSubmit() {
		if (!canSubmit)
			return;
		log.info('Submitting review action', { action: selectedAction });
		const payload: Parameters<typeof onsubmit>[0] = { action: selectedAction };
		if (selectedAction === 'approve') {
			payload.hoursAssigned = hoursAssigned;
			if (supportsRewardedOverride && rewardedOverride !== undefined) {
				payload.rewardedHoursOverride = rewardedOverride;
			}
			payload.feedbackMessage = feedbackMessage;
			payload.justification = justification;
			payload.fields = buildFieldValues();
		} else if (selectedAction === 'reject') {
			payload.feedbackMessage = feedbackMessage;
			payload.internalMessage = internalMessage || undefined;
			payload.fields = buildFieldValues();
		} else {
			payload.commentText = commentText;
		}
		onsubmit(payload);
		clearAllDrafts();
		rewardedOverrideRaw = '';
		log.debug('Drafts cleared after submit');
	}

	async function streamAiGeneration(url: string, body: Record<string, unknown>) {
		changelogLoading = true;
		changelogStatus = 'Starting...';
		changelogThinking = '';
		changelogError = '';
		changelogResult = '';
		log.info('Starting AI generation stream', { url });
		const t = log.time('streamAiGeneration');

		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			log.debug('AI generation response', { status: res.status });

			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Request failed' }));
				throw new Error(err.message || `HTTP ${res.status}`);
			}

			const reader = res.body?.getReader();
			if (!reader) {
				throw new Error('No response stream');
			}

			const decoder = new TextDecoder();
			let buffer = '';
			let eventCount = 0;

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					log.debug('SSE stream ended', { totalEvents: eventCount });
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n\n');
				buffer = lines.pop() ?? '';

				for (const chunk of lines) {
					const dataLine = chunk.trim();
					if (!dataLine.startsWith('data: '))
						continue;
					const event = JSON.parse(dataLine.slice(6));
					eventCount++;
					log.trace('SSE event received', { type: event.type, eventCount });

					if (event.type === 'status') {
						changelogStatus = event.message;
						changelogThinking = '';
					} else if (event.type === 'thinking') {
						changelogThinking = event.message;
					} else if (event.type === 'tool') {
						changelogStatus = event.message;
						changelogThinking = '';
					} else if (event.type === 'done') {
						changelogResult = event.changelog;
						log.info('AI generation complete', { resultLength: changelogResult.length });
					} else if (event.type === 'error') {
						log.error('SSE error event received', { message: event.message });
						throw new Error(event.message);
					}
				}
			}
			t.end('events', eventCount);
		} catch (e) {
			changelogError = e instanceof Error ? e.message : 'Failed to generate';
			log.error('AI generation failed', e);
		} finally {
			changelogLoading = false;
			changelogStatus = '';
			changelogThinking = '';
		}
	}

	function generateChangelog() {
		if (!changelog)
			return;
		log.info('Generating changelog', { repoUrl: changelog.repoUrl, sinceDate: changelog.previousShipDate, untilDate: changelog.currentShipDate });
		streamAiGeneration(`/api/programs/${changelog.programId}/changelog`, {
			repoUrl: changelog.repoUrl,
			sinceDate: changelog.previousShipDate,
			untilDate: changelog.currentShipDate
		});
	}

	function generateOverview() {
		if (!overview)
			return;
		log.info('Generating overview', { repoUrl: overview.repoUrl, projectTitle: overview.projectTitle });
		streamAiGeneration(`/api/programs/${overview.programId}/overview`, {
			repoUrl: overview.repoUrl,
			projectTitle: overview.projectTitle,
			projectDescription: overview.projectDescription
		});
	}

	const allTabs = [
		{ id: 'approve', label: 'Approve', icon: CircleCheck, color: 'text-check-pass' },
		{ id: 'reject', label: 'Reject', icon: CircleX, color: 'text-check-fail' },
		{ id: 'comment', label: 'Comment', icon: MessageSquare, color: 'text-text-primary' },
		{ id: 'internal_comment', label: 'Internal', icon: Eye, color: 'text-accent' }
	];
	const tabs = $derived(
		hasPendingApproval ? allTabs.filter((t) => t.id === 'comment' || t.id === 'internal_comment') : allTabs
	);

	// A restored draft (or a just-queued approval) may leave a verdict tab
	// selected that no longer exists — snap to the first available one.
	// Structured as early returns rather than `a && (b || c)` — Svelte 5.55's
	// transform drops the parentheses when reprinting such expressions, which
	// silently changes the operator precedence (see isExternalPreviousRecord).
	$effect(() => {
		if (!hasPendingApproval) return;
		if (selectedAction === 'approve' || selectedAction === 'reject') {
			selectedAction = 'comment';
		}
	});
</script>

<div class="border border-border-card rounded-card overflow-hidden">
	<TabBar {tabs} active={selectedAction} onchange={(id) => (selectedAction = id as ActionType)} />

	<div class="p-5 flex flex-col gap-4">
		{#if selectedAction === 'approve'}
			<div class="flex gap-3 items-start">
				<div class="flex flex-col gap-1.5 flex-1 min-w-0">
					<label class="font-bold text-sm tracking-[-0.3px]" for="hours">
						Hours to assign
					</label>
					<input
						id="hours"
						type="text"
						inputmode="decimal"
						value={hoursRaw}
						oninput={(e) => {
							userEditedHours = true;
							hoursRaw = e.currentTarget.value;
							hoursAssigned = evaluateArithmetic(hoursRaw) ?? NaN;
						}}
						onchange={collapseHoursExpression}
						class="border border-border-input rounded-section px-3.5 py-2.5 text-sm w-full bg-white outline-none focus:border-accent transition-colors"
					/>
					{#if exceedsRemaining}
						<div class="flex items-center gap-1.5 text-accent">
							<AlertTriangle size={14} />
							<span class="text-sm font-medium">Exceeds remaining hours ({Math.round(remainingHours * 100) / 100}h)</span>
						</div>
					{/if}
				</div>

				{#if supportsRewardedOverride}
					<div class="flex flex-col gap-1.5 flex-1 min-w-0">
						<label class="font-bold text-sm tracking-[-0.3px] flex items-center gap-1.5" for="rewarded-override">
							Rewarded hours override
							<span class="font-normal text-text-secondary">(optional)</span>
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<span
								class="relative inline-flex"
								onmouseenter={() => (showOverrideHelp = true)}
								onmouseleave={() => (showOverrideHelp = false)}
							>
								<CircleHelp size={14} class="text-text-tertiary cursor-help" />
								{#if showOverrideHelp}
									<div class="override-help-tooltip">
										Rewards the author for a different number of hours than what lands in the Unified YSWS DB. Leave empty to reward the assigned hours.
									</div>
								{/if}
							</span>
						</label>
						<div class="flex w-full">
							<input
								id="rewarded-override"
								type="number"
								step="0.01"
								min="0"
								value={rewardedOverrideRaw}
								oninput={(e) => (rewardedOverrideRaw = e.currentTarget.value)}
								placeholder="Same as assigned hours"
								class="border border-border-input rounded-l-section px-3.5 py-2.5 text-sm w-full min-w-0 bg-white outline-none focus:border-accent transition-colors"
							/>
							<button
								type="button"
								class="bg-white border-y border-r border-border-input px-3 text-sm font-medium shrink-0 hover:bg-surface transition-colors cursor-pointer"
								onclick={() => bumpOverride(-1)}
								title="Reward one hour less"
							>
								-1
							</button>
							<button
								type="button"
								class="bg-white border-y border-r border-border-input rounded-r-section px-3 text-sm font-medium shrink-0 hover:bg-surface transition-colors cursor-pointer"
								onclick={() => bumpOverride(1)}
								title="Reward one hour more"
							>
								+1
							</button>
						</div>
						{#if rewardedOverrideInvalid}
							<div class="flex items-center gap-1.5 text-check-fail">
								<AlertTriangle size={14} />
								<span class="text-sm font-medium">Override must be a non-negative number</span>
							</div>
						{:else if overrideExceedsAssigned}
							<div class="flex items-center gap-1.5 text-accent">
								<AlertTriangle size={14} />
								<span class="text-sm font-medium">Exceeds assigned hours ({Math.round((Number(hoursAssigned) || 0) * 100) / 100}h)</span>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<div class="flex flex-col gap-1.5">
				<label class="font-bold text-sm tracking-[-0.3px]" for="feedback">
					Feedback message
					<span class="font-normal text-text-secondary">(visible to author)</span>
				</label>
				<MarkdownTextarea
					id="feedback"
					value={feedbackMessage}
					onchange={(v) => setDraft('feedbackMessage', v)}
					placeholder="Great work! Your project looks awesome."
				/>
			</div>

			<div class="flex flex-col gap-1.5">
				<label class="font-bold text-sm tracking-[-0.3px]" for="justification">
					Internal justification
					<span class="font-normal text-text-secondary">(staff only)</span>
				</label>
				{#if changelogError}
					<div class="flex items-center gap-1.5 text-check-fail text-xs">
						<AlertTriangle size={12} />
						<span>{changelogError}</span>
					</div>
				{/if}
				<MarkdownTextarea
					id="justification"
					value={justification}
					onchange={(v) => setDraft('justification', v)}
					variant="internal"
					placeholder="Why are we approving this? What did you verify?"
				/>
			</div>

			{#if (approveFields ?? []).length > 0}
				<div class="flex flex-col gap-4 py-1">
					{#each approveFields ?? [] as fieldDef (fieldDef.name)}
						{#if fieldDef.type === 'markdown'}
							<div class="flex flex-col gap-1.5">
								<label class="font-bold text-sm tracking-[-0.3px]" for="field-{fieldDef.name}">
									{fieldDef.label}
									{#if !fieldDef.required}
										<span class="font-normal text-text-secondary">(optional)</span>
									{/if}
								</label>
								<MarkdownTextarea
									id="field-{fieldDef.name}"
									value={String(customFields[fieldDef.name] ?? '')}
									onchange={(v) => setCustomField(fieldDef.name, v)}
									placeholder={fieldDef.placeholder ?? ''}
									rows={3}
								/>
							</div>
						{:else if fieldDef.type === 'boolean'}
							<Checkbox
								checked={!!customFields[fieldDef.name]}
								onchange={() => setCustomField(fieldDef.name, !customFields[fieldDef.name])}
							>
								<div class="flex flex-col">
									<span class="font-bold text-sm tracking-[-0.3px]">
										{fieldDef.label}
										{#if !fieldDef.required}
											<span class="font-normal text-text-secondary">(optional)</span>
										{/if}
									</span>
									{#if fieldDef.placeholder}
										<span class="text-sm text-text-secondary">{fieldDef.placeholder}</span>
									{/if}
								</div>
							</Checkbox>
						{:else}
							<div class="flex items-baseline gap-3">
								<label class="font-bold text-sm tracking-[-0.3px] shrink-0" for="field-{fieldDef.name}">
									{fieldDef.label}
									{#if !fieldDef.required}
										<span class="font-normal text-text-secondary">(optional)</span>
									{/if}
								</label>
								{#if fieldDef.type === 'integer'}
									<input
										id="field-{fieldDef.name}"
										type="number"
										step="1"
										value={customFields[fieldDef.name] ?? ''}
										oninput={(e) => setCustomField(fieldDef.name, parseInt(e.currentTarget.value) || 0)}
										placeholder={fieldDef.placeholder ?? ''}
										class="border border-border-input rounded-section px-3.5 py-2.5 text-sm w-full bg-white outline-none focus:border-accent transition-colors"
									/>
								{:else}
									<input
										id="field-{fieldDef.name}"
										type="text"
										value={customFields[fieldDef.name] ?? ''}
										oninput={(e) => setCustomField(fieldDef.name, e.currentTarget.value)}
										placeholder={fieldDef.placeholder ?? ''}
										class="border border-border-input rounded-section px-3.5 py-2.5 text-sm w-full bg-white outline-none focus:border-accent transition-colors"
									/>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			{/if}

			{#if changelogResult}
				<div class="flex flex-col gap-2 border border-border-card rounded-section bg-surface/50 p-4">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
							<Sparkles size={12} />
							<span>Generated changelog</span>
						</div>
						<div class="flex items-center gap-1">
							<button
								type="button"
								class="flex items-center gap-1 px-2 py-1 rounded-tag text-xs text-text-secondary hover:text-text-primary hover:bg-surface transition-colors cursor-pointer"
								onclick={async () => {
									await navigator.clipboard.writeText(changelogResult);
									changelogCopied = true;
									setTimeout(() => (changelogCopied = false), 2000);
								}}
							>
								{#if changelogCopied}
									<span class="text-check-pass font-medium">Copied!</span>
								{:else}
									<Copy size={12} />
									<span>Copy</span>
								{/if}
							</button>
							<button
								type="button"
								class="flex items-center justify-center size-6 rounded-tag text-text-tertiary hover:text-text-primary hover:bg-surface transition-colors cursor-pointer"
								onclick={() => (changelogResult = '')}
							>
								<X size={14} />
							</button>
						</div>
					</div>
					<p class="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">{changelogResult}</p>
				</div>
			{/if}

		{:else if selectedAction === 'reject'}
			<div class="flex flex-col gap-1.5">
				<div class="flex items-center justify-between">
					<label class="font-bold text-sm tracking-[-0.3px]" for="reject-feedback">
						Rejection message
						<span class="font-normal text-text-secondary">(visible to author)</span>
					</label>
					{#if (rejectionTemplates ?? []).length > 0}
						<div class="relative">
							<button
								type="button"
								class="flex items-center gap-1.5 px-2.5 py-1 rounded-tag border border-border-input text-xs font-medium text-text-subtle hover:bg-surface transition-colors cursor-pointer"
								title="Fill the rejection form with a quick rejection template"
								onclick={() => (prefillOpen = !prefillOpen)}
							>
								<Zap size={12} />
								Pre-fill
								<ChevronDown size={12} class="transition-transform {prefillOpen ? 'rotate-180' : ''}" />
							</button>
							{#if prefillOpen}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<div class="fixed inset-0 z-40" onclick={() => (prefillOpen = false)}></div>
								<div class="absolute right-0 top-[calc(100%+4px)] z-50 w-[280px] bg-white border border-border-card rounded-input shadow-lg overflow-hidden">
									{#each rejectionTemplates ?? [] as tpl (tpl.id)}
										<button
											type="button"
											class="w-full flex flex-col items-start px-3 py-2 text-left hover:bg-surface/50 transition-colors cursor-pointer"
											onclick={() => applyRejectionTemplate(tpl)}
										>
											<span class="text-sm font-medium text-text-primary truncate w-full">{tpl.name}</span>
											<span class="text-[11px] text-text-tertiary truncate w-full">{tpl.feedbackMessage}</span>
										</button>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
				<MarkdownTextarea
					id="reject-feedback"
					value={feedbackMessage}
					onchange={(v) => setDraft('feedbackMessage', v)}
					placeholder="Please fix the following issues..."
					rows={5}
				/>
			</div>

			<div class="flex flex-col gap-1.5">
				<label class="font-bold text-sm tracking-[-0.3px]" for="reject-internal">
					Internal note
					<span class="font-normal text-text-secondary">(optional, staff only)</span>
				</label>
				<MarkdownTextarea
					id="reject-internal"
					value={internalMessage}
					onchange={(v) => setDraft('internalMessage', v)}
					variant="internal"
					placeholder="Optional internal context..."
					rows={3}
				/>
			</div>

			{#if (rejectFields ?? []).length > 0}
				<div class="flex flex-col gap-4 py-1">
					{#each rejectFields ?? [] as fieldDef (fieldDef.name)}
						{#if fieldDef.type === 'markdown'}
							<div class="flex flex-col gap-1.5">
								<label class="font-bold text-sm tracking-[-0.3px]" for="field-{fieldDef.name}">
									{fieldDef.label}
									{#if !fieldDef.required}
										<span class="font-normal text-text-secondary">(optional)</span>
									{/if}
								</label>
								<MarkdownTextarea
									id="field-{fieldDef.name}"
									value={String(customFields[fieldDef.name] ?? '')}
									onchange={(v) => setCustomField(fieldDef.name, v)}
									placeholder={fieldDef.placeholder ?? ''}
									rows={3}
								/>
							</div>
						{:else if fieldDef.type === 'boolean'}
							<Checkbox
								checked={!!customFields[fieldDef.name]}
								onchange={() => setCustomField(fieldDef.name, !customFields[fieldDef.name])}
							>
								<div class="flex flex-col">
									<span class="font-bold text-sm tracking-[-0.3px]">
										{fieldDef.label}
										{#if !fieldDef.required}
											<span class="font-normal text-text-secondary">(optional)</span>
										{/if}
									</span>
									{#if fieldDef.placeholder}
										<span class="text-sm text-text-secondary">{fieldDef.placeholder}</span>
									{/if}
								</div>
							</Checkbox>
						{:else}
							<div class="flex items-baseline gap-3">
								<label class="font-bold text-sm tracking-[-0.3px] shrink-0" for="field-{fieldDef.name}">
									{fieldDef.label}
									{#if !fieldDef.required}
										<span class="font-normal text-text-secondary">(optional)</span>
									{/if}
								</label>
								{#if fieldDef.type === 'integer'}
									<input
										id="field-{fieldDef.name}"
										type="number"
										step="1"
										value={customFields[fieldDef.name] ?? ''}
										oninput={(e) => setCustomField(fieldDef.name, parseInt(e.currentTarget.value) || 0)}
										placeholder={fieldDef.placeholder ?? ''}
										class="border border-border-input rounded-section px-3.5 py-2.5 text-sm w-full bg-white outline-none focus:border-accent transition-colors"
									/>
								{:else}
									<input
										id="field-{fieldDef.name}"
										type="text"
										value={customFields[fieldDef.name] ?? ''}
										oninput={(e) => setCustomField(fieldDef.name, e.currentTarget.value)}
										placeholder={fieldDef.placeholder ?? ''}
										class="border border-border-input rounded-section px-3.5 py-2.5 text-sm w-full bg-white outline-none focus:border-accent transition-colors"
									/>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			{/if}

		{:else}
			<div class="flex flex-col gap-1.5">
				<label class="font-bold text-sm tracking-[-0.3px]" for="comment-text">
					{selectedAction === 'internal_comment' ? 'Internal comment' : 'Comment'}
					<span class="font-normal text-text-secondary">
						({selectedAction === 'internal_comment' ? 'staff only' : 'visible to author'})
					</span>
				</label>
				<MarkdownTextarea
					id="comment-text"
					value={commentText}
					onchange={(v) => setDraft('commentText', v)}
					variant={selectedAction === 'internal_comment' ? 'internal' : 'default'}
					placeholder="Write your comment..."
					rows={5}
				/>
			</div>
		{/if}

		{#if changelogLoading}
			<div class="flex flex-col gap-1 px-3.5 py-2.5 bg-surface rounded-section">
				<div class="flex items-center gap-2 text-sm text-text-primary font-medium">
					<Loader2 size={14} class="animate-spin shrink-0 text-accent" />
					<span>{changelogStatus}</span>
				</div>
				{#if changelogThinking}
					<p class="text-xs text-text-secondary italic pl-[22px]">{changelogThinking}</p>
				{/if}
			</div>
		{/if}

		<div class="flex items-center justify-end gap-2">
			{#if selectedAction === 'approve' && changelog}
				<button
					type="button"
					class="flex items-center gap-1.5 px-4 py-2.5 rounded-section text-sm font-medium transition-colors cursor-pointer
						border border-border-card text-text-secondary hover:text-text-primary hover:bg-surface
						disabled:opacity-50 disabled:cursor-not-allowed"
					disabled={changelogLoading}
					onclick={generateChangelog}
				>
					<Sparkles size={14} />
					Generate Git changelog w/ AI
				</button>
			{:else if selectedAction === 'approve' && overview}
				<button
					type="button"
					class="flex items-center gap-1.5 px-4 py-2.5 rounded-section text-sm font-medium transition-colors cursor-pointer
						border border-border-card text-text-secondary hover:text-text-primary hover:bg-surface
						disabled:opacity-50 disabled:cursor-not-allowed"
					disabled={changelogLoading}
					onclick={generateOverview}
				>
					<Sparkles size={14} />
					Generate overview w/ AI
				</button>
			{/if}
			<button
				class="px-5 py-2.5 rounded-section font-bold text-sm transition-colors cursor-pointer
					{selectedAction === 'approve'
					? 'bg-check-pass text-white hover:opacity-90'
					: selectedAction === 'reject'
						? 'bg-check-fail text-white hover:opacity-90'
						: 'bg-accent text-white hover:opacity-90'}
					disabled:opacity-50 disabled:cursor-not-allowed"
				disabled={!canSubmit || submitting}
				onclick={handleSubmit}
			>
				{#if submitting}
					Submitting...
				{:else if selectedAction === 'approve'}
					Approve
				{:else if selectedAction === 'reject'}
					Reject
				{:else}
					Submit Comment
				{/if}
			</button>
		</div>
	</div>
</div>

<style>
	/* Matches UserCard's trust tooltip. Anchored to the help icon's right edge
	   and opening downward so it stays inside the panel's overflow-hidden card. */
	.override-help-tooltip {
		position: absolute;
		right: 0;
		top: calc(100% + 8px);
		background: var(--color-page, #fff);
		border: 1px solid var(--color-border-card);
		border-radius: 8px;
		padding: 10px 12px;
		width: 300px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		z-index: 50;
		font-weight: 400;
		font-size: 12px;
		letter-spacing: -0.24px;
		line-height: 1.4;
		color: var(--color-text-secondary, #737373);
	}
</style>
