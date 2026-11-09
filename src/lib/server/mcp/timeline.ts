import { db } from '../db.js';
import { resolveActorIds } from '../actors.js';
import { FRAUD_QUEUE, isFraudQueueReviewer } from '../experiments/fraud-queue.js';
import { clip, ToolError, type McpContext } from './access.js';
import type { Subject } from './subject.js';
import type { Block, TimelineEvent, TraceStep } from '../protocol/types.js';

const SUMMARY_TEXT = 600;
const SUMMARY_REASONING = 1500;
const FULL_TEXT = 20_000;
const TRACE_STEP = 1500;
const TRACE_STEPS = 80;

function blocksToText(blocks: Block[] | undefined, max: number): string | null {
	if (!blocks?.length) return null;
	const out: string[] = [];
	for (const b of blocks) {
		const internal = b.isInternal ? '(internal) ' : '';
		switch (b.type) {
			case 'section':
				out.push(
					[
						b.title ? `${internal}${b.title}:` : internal.trim(),
						b.text,
						...(b.fields ?? []).map((f) => `${f.label}: ${f.value}`)
					]
						.filter(Boolean)
						.join('\n')
				);
				break;
			case 'callout':
				out.push(`${internal}[${b.tone}] ${b.title ? `${b.title}: ` : ''}${b.text}`);
				break;
			case 'context':
				out.push(b.elements.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join(' · '));
				break;
			case 'image':
				out.push(
					`${internal}[image${b.title ? ` "${b.title}"` : ''}: ${b.imageUrl}]${b.caption ? ` ${b.caption}` : ''}`
				);
				break;
		}
	}
	return clip(out.filter(Boolean).join('\n\n'), max);
}

function traceToSteps(trace: TraceStep[] | undefined) {
	if (!trace?.length) return null;
	const steps = trace.slice(0, TRACE_STEPS).map((s) =>
		s.type === 'tool_call'
			? {
					tool: s.name,
					input: clip(typeof s.input === 'string' ? s.input : JSON.stringify(s.input ?? null), 400),
					output: clip(
						typeof s.output === 'string' ? s.output : JSON.stringify(s.output ?? null),
						TRACE_STEP
					),
					...(s.isError ? { isError: true } : {})
				}
			: { [s.type]: clip(s.text, TRACE_STEP) }
	);
	return { steps, omitted: Math.max(0, trace.length - TRACE_STEPS) };
}

type HeldEvent = {
	type: 'held_approval';
	actorId: string;
	shipId: string;
	queue: string;
	status: string;
	hoursAssigned: number;
	feedbackMessage: string;
	justification: string;
	timestamp: string;
};

/**
 * The project's whole history: the program's timeline (ships, reviews,
 * comments, and the system events automated reviewers such as Crescent's
 * autoreview publish) plus approvals Sidekick is holding for HQ. Held
 * approvals in the fraud queue stay hidden from anyone the review page hides
 * them from.
 */
export async function loadTimeline(ctx: McpContext, subject: Subject) {
	const [{ events }, held] = await Promise.all([
		subject.client.fetchProjectTimeline({ projectId: subject.project.id }),
		db.pendingApproval.findMany({
			where: { programId: subject.program.id, projectId: subject.project.id }
		})
	]);
	const ownReviewerId = ctx.user.slackId || ctx.user.hcaId;
	const fraudReviewer = isFraudQueueReviewer(subject.membership);
	const visibleHeld: HeldEvent[] = held
		.filter(
			(pa) => !(pa.queue === FRAUD_QUEUE && !fraudReviewer && pa.reviewerId !== ownReviewerId)
		)
		.map((pa) => ({
			type: 'held_approval',
			actorId: pa.reviewerId,
			shipId: pa.shipId,
			queue: pa.queue,
			status: pa.status,
			hoursAssigned: pa.hoursAssigned,
			feedbackMessage: pa.feedbackMessage,
			justification: pa.justification,
			timestamp: pa.createdAt.toISOString()
		}));

	const all: Array<TimelineEvent | HeldEvent> = [...events, ...visibleHeld].sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
	);
	const actorIds = new Set<string>();
	for (const e of all) {
		if (e.type === 'system') continue;
		actorIds.add(e.actorId);
		if (e.type === 'discarded_approval') actorIds.add(e.discardedByActorId);
		if (e.type === 'authorized_approval') actorIds.add(e.authorizedByActorId);
	}
	const actors = await resolveActorIds([...actorIds]);
	const name = (id: string) => actors.get(id)?.name ?? id;
	const shipNumber = new Map(subject.project.ships.map((s, i) => [s.id, i + 1]));
	return { events: all, name, shipNumber };
}

type Loaded = Awaited<ReturnType<typeof loadTimeline>>;

/** One event as the agent reads it; `full` lifts the clipping and adds an agent's trace. */
export function describeEvent(
	loaded: Loaded,
	e: TimelineEvent | HeldEvent,
	index: number,
	full: boolean
) {
	const text = full ? FULL_TEXT : SUMMARY_TEXT;
	const ship =
		'shipId' in e && e.shipId ? `ship ${loaded.shipNumber.get(e.shipId) ?? e.shipId}` : undefined;
	const base = { index, at: e.timestamp, type: e.type, ...(ship ? { ship } : {}) };
	switch (e.type) {
		case 'ship':
			return {
				...base,
				by: loaded.name(e.actorId),
				hoursClaimed: e.hoursSubmitted,
				changes: e.changes?.length
					? e.changes.map(
							(c) =>
								`${c.label}: ${clip(c.oldValue, 200) || '(empty)'} -> ${clip(c.newValue, 200) || '(empty)'}`
						)
					: undefined,
				fields: e.displayFields?.length
					? e.displayFields.map(
							(f) => `${f.isInternal ? '(internal) ' : ''}${f.label}: ${clip(f.value, text)}`
						)
					: undefined,
				blocks: blocksToText(e.blocks, text) ?? undefined
			};
		case 'approval':
		case 'pending_approval':
		case 'authorized_approval':
		case 'discarded_approval':
			return {
				...base,
				by: loaded.name(e.actorId),
				...(e.type === 'authorized_approval'
					? { authorizedBy: loaded.name(e.authorizedByActorId) }
					: {}),
				...(e.type === 'discarded_approval'
					? { discardedBy: loaded.name(e.discardedByActorId) }
					: {}),
				hoursAssigned: e.hoursAssigned,
				...('hoursDeflated' in e && e.hoursDeflated ? { hoursDeflated: e.hoursDeflated } : {}),
				feedback: clip(e.feedbackMessage, text),
				justification: clip(e.justification, text)
			};
		case 'held_approval':
			return {
				...base,
				by: loaded.name(e.actorId),
				note: `approval held in Sidekick's ${e.queue === FRAUD_QUEUE ? 'fraud review' : 'HQ'} queue (${e.status})`,
				hoursAssigned: e.hoursAssigned,
				feedback: clip(e.feedbackMessage, text),
				justification: clip(e.justification, text)
			};
		case 'rejection':
			return {
				...base,
				by: loaded.name(e.actorId),
				feedback: clip(e.feedbackMessage, text),
				internal: clip(e.internalMessage, text) ?? undefined
			};
		case 'comment':
			return {
				...base,
				by: loaded.name(e.actorId),
				internal: e.isInternal,
				message: clip(e.message, text)
			};
		case 'system':
			return {
				...base,
				source: e.source.name,
				summary: e.summary,
				tone: e.tone ?? 'neutral',
				body: blocksToText(e.blocks, full ? FULL_TEXT : 2000) ?? undefined,
				reasoning: clip(e.reasoning, full ? FULL_TEXT : SUMMARY_REASONING) ?? undefined,
				...(full
					? { trace: traceToSteps(e.trace) ?? undefined }
					: e.trace?.length
						? { traceSteps: e.trace.length }
						: {})
			};
	}
}

export function timelineEntries(loaded: Loaded) {
	return loaded.events.map((e, i) => describeEvent(loaded, e, i, false));
}

export function timelineEvent(loaded: Loaded, index: number) {
	const e = loaded.events[index];
	if (!e)
		throw new ToolError(
			`No event ${index}; the timeline has ${loaded.events.length} (0 to ${loaded.events.length - 1}).`
		);
	return describeEvent(loaded, e, index, true);
}
