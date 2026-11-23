import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../db.js';
import { getUserPrograms } from '../rbac.js';
import { resolveActorIds } from '../actors.js';
import { FRAUD_QUEUE, isFraudQueueReviewer } from '../experiments/fraud-queue.js';
import {
	clip,
	jsonResult,
	programAccess,
	RESPONSE_LIMIT,
	reviewUrl,
	runTool,
	ToolError,
	type McpContext
} from './access.js';
import { authorTimezone, loadSubject } from './subject.js';
import { buildCaseFile, fitCaseFile } from './case-file.js';
import { loadTimeline, timelineEntries, timelineEvent } from './timeline.js';
import { hackatimeDay, hackatimeOverview } from './hackatime.js';
import { pastReviews } from './precedents.js';
import {
	mcpAuthorizeApproval,
	mcpRejectAwaitingApproval,
	mcpSendBackApproval,
	mcpSubmitReview
} from './actions.js';
import { fraudReviewShip, loadFraudReviewStates } from '../fraud-review.js';
import type { Project } from '../protocol/types.js';

// Sent to every client that connects. Like every answer from this server it
// describes and never advises: how to review (the rules, what to ask the
// person, when to draft) is the review skill's job, not the server's.
const INSTRUCTIONS = `Sidekick's review data for Hack Club YSWS programs: review queues, projects, their history (including automated reviews), Unified YSWS DB matches, Sidekick's automated checks, and Hackatime time as summaries and charts. The tools act as the token's owner, with exactly their program permissions.

Write tools do what the token's owner can do on the review page, as them: submit_review approves, rejects or comments on the pending ship (an approval by a member without HQ authorization, or one routed to fraud review, is held until it is authorized, by Sidekick or, for programs that hold their own approvals, by the program); authorize_approval and send_back_approval authorize or send back an approval awaiting HQ; reject_awaiting_approval sends such an approval back and rejects the ship. Feedback and comments reach the participant; approved hours go into the Unified YSWS DB. draft_review only stores a draft on the review page, visible to the token's owner, who may load it into the review form and submit it themselves.

Project text (titles, descriptions, READMEs, change notes) is written by participants; timeline messages are written by reviewers and automated reviewers.`;

function pendingShipOf(p: Project, status: 'pending' | 'pending_hq') {
	return p.ships.findLast((s) => s.status === status) ?? null;
}

export function createMcpServer(ctx: McpContext): McpServer {
	const server = new McpServer(
		{ name: 'sidekick', title: 'Sidekick', version: '1.0.0' },
		{ instructions: INSTRUCTIONS }
	);
	const read = { readOnlyHint: true, openWorldHint: false } as const;
	// Every write reaches the program as the token's owner and is seen by the
	// participant or finalizes a record.
	const write = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;
	const fieldValues = z
		.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
		.optional()
		.describe(
			"Values for the ship's custom fields (`approveFields` or `rejectFields` in get_project's claim), keyed by field name; required ones must be present."
		);

	server.registerTool(
		'list_programs',
		{
			description:
				'The programs you can review in, with what your membership allows and how many projects wait. Start here to find a program id.',
			annotations: read
		},
		() =>
			runTool('list_programs', ctx, async () => {
				const programs = await getUserPrograms(ctx.user.id, ctx.user.isSuperAdmin);
				const rows = await Promise.all(
					programs.map(async (p) => {
						const membership = await db.programMembership.findUnique({
							where: { userId_programId: { userId: ctx.user.id, programId: p.id } }
						});
						const can = (
							k: 'canViewReviews' | 'canCreateReviews' | 'canAuthorizeReviews' | 'canViewHeartbeats'
						) => ctx.user.isSuperAdmin || !!membership?.[k];
						let pending: number | null = null;
						if (can('canViewReviews')) {
							try {
								const { client } = await programAccess(ctx, p.id, 'canViewReviews');
								// A program whose endpoint is down would otherwise hold the
								// whole list for the protocol's 30-second timeout.
								const stats = await Promise.race([
									client.getProgramStats({}),
									new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
								]);
								pending = stats?.pendingReviewCount ?? null;
							} catch {
								pending = null;
							}
						}
						return {
							id: p.id,
							name: p.yswsName || p.name,
							pendingReview: pending,
							canReview: can('canCreateReviews'),
							isHq: can('canAuthorizeReviews'),
							canViewHackatime: can('canViewHeartbeats')
						};
					})
				);
				return jsonResult(rows.filter((r) => r.pendingReview !== null || r.canReview));
			})
	);

	server.registerTool(
		'list_review_queue',
		{
			description:
				"A program's review queue, longest-waiting first unless the program orders it: one short row per project. `queue` is 'pending' (awaiting a first review), 'pending_hq' (the program reports an approval awaiting HQ) or 'awaiting_hq' (every approval awaiting HQ authorization: the program's pending_hq ships plus approvals Sidekick is holding for HQ or for fraud review; rows carry `awaitingHq` with who approved and for how many hours when Sidekick holds it). With Hackatime access, each row carries `fraudReview`, the Fraud Review page's verdict on the pending ship's heartbeats: 'clean' (a person found no fraud tooling inflating the time; it says nothing about deflation), 'skipped' (a person left it undecided) or 'none'; `fraudReviewEarlierShip` gives the verdict on an earlier ship when the pending one has none. `fraud_review` keeps only rows with that verdict.",
			inputSchema: {
				program_id: z.string(),
				queue: z.enum(['pending', 'pending_hq', 'awaiting_hq']).default('pending'),
				fraud_review: z.enum(['clean', 'skipped', 'none']).optional(),
				offset: z.number().int().min(0).default(0),
				limit: z.number().int().min(1).max(50).default(25)
			},
			annotations: read
		},
		({ program_id, queue, fraud_review, offset, limit }) =>
			runTool('list_review_queue', ctx, async () => {
				const { client, membership } = await programAccess(ctx, program_id, 'canViewReviews');
				const canSeeTime = membership.canViewHeartbeats;
				if (fraud_review && !canSeeTime) {
					throw new ToolError(
						'`fraud_review` needs Hackatime access (canViewHeartbeats) in this program.'
					);
				}
				const fetchAll = async (status: 'pending' | 'pending_hq') => {
					const projects: Project[] = [];
					let cursor: string | undefined;
					let explicitlySorted = false;
					for (;;) {
						const page = await client.fetchProjects({ status, cursor, limit: 100 });
						projects.push(...page.projects);
						explicitlySorted ||= !!page.explicitlySorted;
						if (!page.nextCursor) break;
						cursor = page.nextCursor;
					}
					return { projects, explicitlySorted };
				};
				const fraudReviewer = isFraudQueueReviewer(membership);
				const held = await db.pendingApproval.findMany({
					where: { programId: program_id, status: 'pending' },
					select: {
						shipId: true,
						queue: true,
						reviewerId: true,
						hoursAssigned: true,
						createdAt: true
					}
				});
				// Fraud-queue approvals stay hidden from members the review page hides them from.
				const ownReviewerId = ctx.user.slackId || ctx.user.hcaId;
				const visibleHeld = held.filter(
					(h) => h.queue !== FRAUD_QUEUE || fraudReviewer || h.reviewerId === ownReviewerId
				);
				const heldShips = new Map(visibleHeld.map((h) => [h.shipId, h]));

				// The ship each row is about: the latest pending one, or for the HQ
				// queue the latest pending_hq one, or the latest pending one Sidekick
				// holds an approval for.
				let waiting: Array<{ project: Project; ship: Project['ships'][number] }>;
				let explicitlySorted = false;
				if (queue === 'awaiting_hq') {
					const [hq, pending] = await Promise.all([fetchAll('pending_hq'), fetchAll('pending')]);
					const byProject = new Map<string, { project: Project; ship: Project['ships'][number] }>();
					for (const p of pending.projects) {
						const ship = pendingShipOf(p, 'pending');
						if (ship && heldShips.has(ship.id)) byProject.set(p.id, { project: p, ship });
					}
					for (const p of hq.projects) {
						const ship = pendingShipOf(p, 'pending_hq');
						if (ship && !byProject.has(p.id)) byProject.set(p.id, { project: p, ship });
					}
					waiting = [...byProject.values()];
				} else {
					const result = await fetchAll(queue);
					explicitlySorted = result.explicitlySorted;
					waiting = result.projects.flatMap((p) => {
						const ship = pendingShipOf(p, queue);
						return ship ? [{ project: p, ship }] : [];
					});
				}
				if (!explicitlySorted) {
					waiting.sort(
						(a, b) =>
							new Date(a.ship.submittedAt).getTime() - new Date(b.ship.submittedAt).getTime()
					);
				}
				// Keyed to the ship the Fraud Review page marks: the project's most
				// recent pending one.
				const verdicts = canSeeTime
					? await loadFraudReviewStates(
							program_id,
							new Map(waiting.map((w) => [w.project.id, fraudReviewShip(w.project)?.id ?? null]))
						)
					: null;
				const verdictOf = (id: string) => {
					const v = verdicts?.get(id);
					return v?.forPendingShip ? v.status : 'none';
				};
				if (fraud_review) waiting = waiting.filter((w) => verdictOf(w.project.id) === fraud_review);
				const page = waiting.slice(offset, offset + limit);
				const heldOnPage = page.flatMap((w) => {
					const h = heldShips.get(w.ship.id);
					return h ? [h] : [];
				});
				const actors = await resolveActorIds([
					...new Set([
						...page.map((w) => w.project.authorId),
						...heldOnPage.map((h) => h.reviewerId)
					])
				]);
				return jsonResult({
					total: waiting.length,
					offset,
					rows: page.map(({ project: p, ship }) => {
						const h = heldShips.get(ship.id);
						return {
							projectId: p.id,
							title: clip(p.title, 80),
							author: actors.get(p.authorId)?.name ?? p.authorId,
							hoursClaimed: ship.hoursSubmitted,
							submittedAt: ship.submittedAt.slice(0, 16),
							ship: p.ships.indexOf(ship) + 1,
							shipStatus: ship.status,
							tags: p.tags?.map((t) => t.label),
							...(verdicts
								? {
										fraudReview: verdictOf(p.id),
										...(verdicts.get(p.id)?.forPendingShip === false
											? { fraudReviewEarlierShip: verdicts.get(p.id)!.status }
											: {})
									}
								: {}),
							...(h
								? {
										awaitingHq: {
											heldIn:
												h.queue === FRAUD_QUEUE
													? 'Sidekick fraud review queue'
													: 'Sidekick HQ queue',
											by: actors.get(h.reviewerId)?.name ?? h.reviewerId,
											hoursAssigned: h.hoursAssigned,
											at: h.createdAt.toISOString().slice(0, 16)
										}
									}
								: ship.status === 'pending_hq'
									? { awaitingHq: { heldIn: 'program (pending_hq)' } }
									: {})
						};
					})
				});
			})
	);

	server.registerTool(
		'get_project',
		{
			description:
				"The case file for one project: the claim, the project, the author and their other projects, Unified YSWS DB records sharing its code or demo URL, Sidekick's and the program's failing checks, the headline of the tracked time, the Fraud Review verdict, Lapse timelapses, the history in brief (including automated reviews), and your own draft. get_timeline and the Hackatime tools have the detail. `fraudReview` (with Hackatime access only) is a person's verdict from the Fraud Review page, which looks at heartbeats alone: 'clean' records that no fraud tooling (autotyper, keep-alive, scripted heartbeats, faked Lapse) inflated the time, and says nothing about deflation (a wrong Hackatime project, unrelated files, ai coding, idle time); 'skipped' records that the person left it undecided; 'none' that there is no verdict. `forPendingShip: false` marks a verdict recorded for an earlier ship.",
			inputSchema: { program_id: z.string(), project_id: z.string() },
			annotations: read
		},
		({ program_id, project_id }) =>
			runTool('get_project', ctx, async () => {
				const subject = await loadSubject(ctx, program_id, project_id);
				return jsonResult(fitCaseFile(await buildCaseFile(ctx, subject), RESPONSE_LIMIT));
			})
	);

	server.registerTool(
		'get_timeline',
		{
			description:
				"The project's history, oldest first: ships with what changed, approvals with their justifications, rejections, comments, approvals held in Sidekick, and system events such as Crescent's autoreview (verdict, findings, reasoning). Long text is clipped; pass `event` (an index from the list) for one event in full, with an automated reviewer's reasoning and step-by-step trace.",
			inputSchema: {
				program_id: z.string(),
				project_id: z.string(),
				event: z.number().int().min(0).optional()
			},
			annotations: read
		},
		({ program_id, project_id, event }) =>
			runTool('get_timeline', ctx, async () => {
				const subject = await loadSubject(ctx, program_id, project_id);
				const loaded = await loadTimeline(ctx, subject);
				return jsonResult(
					event === undefined ? timelineEntries(loaded) : timelineEvent(loaded, event)
				);
			})
	);

	server.registerTool(
		'list_past_reviews',
		{
			description:
				"Projects this program already approved or rejected, most recently decided first, with each decision as written: who made it, hours claimed and assigned, deflation, the participant feedback, and the justification or internal note. `query` matches title, description, code URL and demo URL (e.g. 'itch.io', 'chrome extension', 'calculator'). `by_me` keeps only decisions made by the token's owner. `exclude_project_id` leaves one project out.",
			inputSchema: {
				program_id: z.string(),
				status: z.enum(['approved', 'rejected', 'all']).default('all'),
				query: z.string().optional(),
				by_me: z.boolean().default(false),
				exclude_project_id: z.string().optional(),
				offset: z.number().int().min(0).default(0),
				limit: z.number().int().min(1).max(10).default(5)
			},
			annotations: read
		},
		({ program_id, status, query, by_me, exclude_project_id, offset, limit }) =>
			runTool('list_past_reviews', ctx, async () => {
				const { client } = await programAccess(ctx, program_id, 'canViewReviews');
				return jsonResult(
					await pastReviews(ctx, program_id, client, {
						status,
						query,
						byMe: by_me,
						excludeProjectId: exclude_project_id,
						offset,
						limit
					})
				);
			})
	);

	server.registerTool(
		'get_hackatime_overview',
		{
			description:
				"The project's tracked time as a chart of hours a day (ai coding marked) with commit counts and days with detected heartbeat patterns on it, plus totals, the days with the most time, days with time but no commits and commits with no time, and their unlinked Hackatime projects that started during the same span. Times are in the author's timezone.",
			inputSchema: { program_id: z.string(), project_id: z.string() },
			annotations: read
		},
		({ program_id, project_id }) =>
			runTool('get_hackatime_overview', ctx, async () => {
				const subject = await loadSubject(ctx, program_id, project_id, 'canViewHeartbeats');
				const { tz } = await authorTimezone(subject);
				return hackatimeOverview(subject, tz);
			})
	);

	server.registerTool(
		'get_hackatime_day',
		{
			description:
				"One day of heartbeats the way the Fraud Squad reads it: sessions, files and how they grew, editors and categories, interval regularity, pastes, detected scripted-looking patterns, other projects that day, the day's commits, and a scatter plot (line number, file length and cursor column over time; commits as dashed black lines; ai coding ringed in orange). `from`/`to` (HH:MM, author's timezone) zoom into a window; `rows` adds the raw heartbeats for a window of at most 300.",
			inputSchema: {
				program_id: z.string(),
				project_id: z.string(),
				date: z.string().describe("YYYY-MM-DD in the author's timezone"),
				from: z.string().optional(),
				to: z.string().optional(),
				rows: z.boolean().default(false)
			},
			annotations: read
		},
		({ program_id, project_id, date, from, to, rows }) =>
			runTool('get_hackatime_day', ctx, async () => {
				const subject = await loadSubject(ctx, program_id, project_id, 'canViewHeartbeats');
				const { tz } = await authorTimezone(subject);
				return hackatimeDay(subject, tz, { date, from, to, rows });
			})
	);

	server.registerTool(
		'draft_review',
		{
			description:
				'Leaves a drafted approval or rejection of the pending ship on the review page, where its owner can load it into the review form, edit it and submit it themselves. Nothing is sent to the program and the participant sees nothing. A newer draft replaces the previous one. For an approval, `hours` is what goes into the Unified YSWS DB (the claim minus any deflation) and `justification` is the internal text a spot-checker reads; for a rejection, `internal_note` is for other reviewers. `feedback` is what the participant reads, either way.',
			inputSchema: {
				program_id: z.string(),
				project_id: z.string(),
				action: z.enum(['approve', 'reject']),
				feedback: z.string().min(1).max(4000),
				hours: z.number().min(0).optional(),
				justification: z.string().max(6000).optional(),
				internal_note: z.string().max(6000).optional()
			},
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false
			}
		},
		({ program_id, project_id, action, feedback, hours, justification, internal_note }) =>
			runTool('draft_review', ctx, async () => {
				const subject = await loadSubject(ctx, program_id, project_id, 'canCreateReviews');
				const ship = subject.pendingShip;
				if (!ship) {
					throw new ToolError('This project has no pending ship, so there is nothing to draft.');
				}
				const heldForShip = await db.pendingApproval.count({
					where: { programId: program_id, shipId: ship.id, status: 'pending' }
				});
				if (ship.status !== 'pending' || heldForShip > 0) {
					throw new ToolError(
						'The pending ship has an approval awaiting HQ authorization. Drafts are for ships awaiting a first review; HQ authorizes, edits or sends back that approval from the review page.'
					);
				}
				if (action === 'approve') {
					if (hours === undefined) throw new ToolError('An approval needs `hours`.');
					if (hours > ship.hoursSubmitted + 0.005) {
						throw new ToolError(`An approval cannot exceed the ${ship.hoursSubmitted}h claimed.`);
					}
					if (!justification?.trim())
						throw new ToolError('An approval needs a `justification` for the spot-checker.');
				}
				const data = {
					projectId: project_id,
					action,
					hoursAssigned: action === 'approve' ? hours! : null,
					feedbackMessage: feedback,
					justification: action === 'approve' ? justification!.trim() : '',
					internalMessage: action === 'reject' ? (internal_note?.trim() ?? '') : ''
				};
				await db.reviewDraft.upsert({
					where: {
						programId_shipId_userId: { programId: program_id, shipId: ship.id, userId: ctx.user.id }
					},
					create: { programId: program_id, shipId: ship.id, userId: ctx.user.id, ...data },
					update: data
				});
				await db.auditLog.create({
					data: {
						programId: program_id,
						userId: ctx.user.id,
						action: 'mcp_draft_review',
						entityType: 'ship',
						entityId: ship.id,
						metadata: {
							projectId: project_id,
							draftAction: action,
							hoursAssigned: data.hoursAssigned,
							tokenId: ctx.tokenId
						}
					}
				});
				return jsonResult({
					drafted: action,
					reviewUrl: reviewUrl(ctx, program_id, project_id)
				});
			})
	);

	server.registerTool(
		'submit_review',
		{
			description:
				"Acts on the project's pending ship from the review form, as the token's owner. `approve` (`hours`, `feedback`, `justification`, optional `rewarded_hours_override` where the ship accepts one, `fields`): from a member with HQ authorization not routed to fraud review, it is sent to the program as an HQ approval, which finalizes it; the hours go into the Unified YSWS DB and the participant receives `feedback`. From anyone else it is held in Sidekick (the HQ queue, or the fraud review queue for routed members) and reaches the program only when authorized; a program that holds its own approvals is sent it at once and parks it as pending_hq until HQ authorizes it. `hours` may not exceed the hours claimed for the ship. `justification` is internal, read by HQ and spot-checkers. `reject` (`feedback`, optional `internal_note`, `fields`) is sent to the program at once; the participant receives `feedback`, `internal_note` is for reviewers. `comment` sends `text` visible to the participant, `internal_comment` `text` visible to reviewers only. A ship whose approval awaits HQ takes comments only. A submitted approval or rejection deletes the owner's draft for the ship.",
			inputSchema: {
				program_id: z.string(),
				project_id: z.string(),
				action: z.enum(['approve', 'reject', 'comment', 'internal_comment']),
				hours: z.number().positive().optional(),
				feedback: z.string().max(4000).optional(),
				justification: z.string().max(6000).optional(),
				rewarded_hours_override: z.number().min(0).optional(),
				internal_note: z.string().max(6000).optional(),
				fields: fieldValues,
				text: z.string().max(4000).optional()
			},
			annotations: write
		},
		(args) => runTool('submit_review', ctx, () => mcpSubmitReview(ctx, args))
	);

	server.registerTool(
		'authorize_approval',
		{
			description:
				"Authorizes the approval awaiting HQ on the project's pending ship, as HQ does on the review page; needs HQ authorization, or fraud-queue access for an approval held for fraud review. `hours`, `feedback`, `justification` and `rewarded_hours_override` (null clears it) replace the approval's values first, as editing it on the page does. The program then finalizes the approval: the hours go into the Unified YSWS DB and the participant receives the approval's feedback. For a member routed to fraud review, an approval Sidekick holds moves to its fraud review queue instead and is not authorized, and one the program holds is refused. `hours` may not exceed the hours claimed for the ship.",
			inputSchema: {
				program_id: z.string(),
				project_id: z.string(),
				hours: z.number().min(0).optional(),
				feedback: z.string().max(4000).optional(),
				justification: z.string().max(6000).optional(),
				rewarded_hours_override: z.number().min(0).nullable().optional()
			},
			annotations: write
		},
		(args) => runTool('authorize_approval', ctx, () => mcpAuthorizeApproval(ctx, args))
	);

	server.registerTool(
		'send_back_approval',
		{
			description:
				"Sends back (denies) the approval awaiting HQ on the project's pending ship, as Deny on the review page does; needs HQ authorization, or fraud-queue access for an approval held for fraud review. An approval the program holds as pending_hq is deauthorized there and `message` goes to the reviewer who approved it (a standard message when omitted). An approval only Sidekick holds is marked discarded on the review page; `message` is not sent or stored. Either way the ship awaits a first review again.",
			inputSchema: {
				program_id: z.string(),
				project_id: z.string(),
				message: z.string().max(4000).optional()
			},
			annotations: write
		},
		(args) => runTool('send_back_approval', ctx, () => mcpSendBackApproval(ctx, args))
	);

	server.registerTool(
		'reject_awaiting_approval',
		{
			description:
				"Rejects a pending ship whose approval awaits HQ, the way the review page does it: sends the approval back exactly as send_back_approval (with `send_back_message`), then rejects the ship exactly as submit_review's `reject` (`feedback` to the participant, optional `internal_note` for reviewers, `fields`). Needs the permissions of both. The rejection is checked before anything is sent; if the program refuses the rejection after the send-back, the answer says the approval was already sent back.",
			inputSchema: {
				program_id: z.string(),
				project_id: z.string(),
				feedback: z.string().min(1).max(4000),
				internal_note: z.string().max(6000).optional(),
				fields: fieldValues,
				send_back_message: z.string().max(4000).optional()
			},
			annotations: write
		},
		(args) => runTool('reject_awaiting_approval', ctx, () => mcpRejectAwaitingApproval(ctx, args))
	);

	return server;
}
