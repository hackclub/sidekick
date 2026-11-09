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
	reviewUrl,
	runTool,
	ToolError,
	type McpContext
} from './access.js';
import { authorTimezone, loadSubject } from './subject.js';
import { buildCaseFile } from './case-file.js';
import { loadTimeline, timelineEntries, timelineEvent } from './timeline.js';
import { hackatimeDay, hackatimeOverview } from './hackatime.js';
import { pastReviews } from './precedents.js';
import { fraudReviewShip, loadFraudReviewStates } from '../fraud-review.js';
import type { Project } from '../protocol/types.js';

// Sent to every client that connects. Like every answer from this server it
// describes and never advises: how to review (the rules, what to ask the
// person, when to draft) is the review skill's job, not the server's.
const INSTRUCTIONS = `Sidekick's review data for Hack Club YSWS programs: review queues, projects, their history (including automated reviews), Unified YSWS DB matches, Sidekick's automated checks, and Hackatime time as summaries and charts. The tools act as the token's owner, with exactly their program permissions.

The server never approves, rejects or comments. draft_review only stores a draft on the review page, visible to the token's owner, who may load it into the review form and submit it themselves.

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
				"A program's review queue, longest-waiting first unless the program orders it: one short row per project. `queue` is 'pending' (awaiting a first review) or 'pending_hq' (approved by a community reviewer, awaiting HQ). With Hackatime access, each row carries `fraudReview`, the Fraud Review page's verdict on the pending ship's heartbeats: 'clean' (a person found no fraud tooling inflating the time; it says nothing about deflation), 'skipped' (a person left it undecided) or 'none'; `fraudReviewEarlierShip` gives the verdict on an earlier ship when the pending one has none. `fraud_review` keeps only rows with that verdict.",
			inputSchema: {
				program_id: z.string(),
				queue: z.enum(['pending', 'pending_hq']).default('pending'),
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
				const projects: Project[] = [];
				let cursor: string | undefined;
				let explicitlySorted = false;
				for (;;) {
					const page = await client.fetchProjects({ status: queue, cursor, limit: 100 });
					projects.push(...page.projects);
					explicitlySorted ||= !!page.explicitlySorted;
					if (!page.nextCursor) break;
					cursor = page.nextCursor;
				}
				let waiting = projects.filter((p) => pendingShipOf(p, queue));
				if (!explicitlySorted) {
					waiting.sort(
						(a, b) =>
							new Date(pendingShipOf(a, queue)!.submittedAt).getTime() -
							new Date(pendingShipOf(b, queue)!.submittedAt).getTime()
					);
				}
				const held = await db.pendingApproval.findMany({
					where: { programId: program_id, status: 'pending' },
					select: { shipId: true, queue: true }
				});
				const heldShips = new Map(held.map((h) => [h.shipId, h.queue]));
				// Keyed to the ship the Fraud Review page marks: the project's most
				// recent pending one.
				const verdicts = canSeeTime
					? await loadFraudReviewStates(
							program_id,
							new Map(waiting.map((p) => [p.id, fraudReviewShip(p)?.id ?? null]))
						)
					: null;
				const verdictOf = (id: string) => {
					const v = verdicts?.get(id);
					return v?.forPendingShip ? v.status : 'none';
				};
				if (fraud_review) waiting = waiting.filter((p) => verdictOf(p.id) === fraud_review);
				const page = waiting.slice(offset, offset + limit);
				const actors = await resolveActorIds([...new Set(page.map((p) => p.authorId))]);
				const fraudReviewer = isFraudQueueReviewer(membership);
				return jsonResult({
					total: waiting.length,
					offset,
					rows: page.map((p) => {
						const ship = pendingShipOf(p, queue)!;
						const heldIn = heldShips.get(ship.id);
						return {
							projectId: p.id,
							title: clip(p.title, 80),
							author: actors.get(p.authorId)?.name ?? p.authorId,
							hoursClaimed: ship.hoursSubmitted,
							submittedAt: ship.submittedAt.slice(0, 16),
							ship: p.ships.indexOf(ship) + 1,
							tags: p.tags?.map((t) => t.label),
							...(verdicts
								? {
										fraudReview: verdictOf(p.id),
										...(verdicts.get(p.id)?.forPendingShip === false
											? { fraudReviewEarlierShip: verdicts.get(p.id)!.status }
											: {})
									}
								: {}),
							...(heldIn && (heldIn !== FRAUD_QUEUE || fraudReviewer)
								? { held: heldIn === FRAUD_QUEUE ? 'in fraud review' : 'approval awaiting HQ' }
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
				return jsonResult(await buildCaseFile(ctx, subject));
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
				if (!ship || ship.status !== 'pending') {
					throw new ToolError(
						'This project has no ship awaiting review, so there is nothing to draft.'
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

	return server;
}
