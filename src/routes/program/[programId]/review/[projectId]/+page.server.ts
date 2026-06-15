import { redirect, error, fail } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient, ProtocolError } from '$lib/server/protocol/client.js';
import { resolveActorIds } from '$lib/server/actors.js';
import { getProjectDetails, getUserTrustFactor, getHeartbeatMetrics } from '$lib/server/integrations/hackatime.js';
import { findRecordsByUrl, airtableRecordUrl } from '$lib/server/integrations/airtable.js';
import { parseRepoUrl, getCommits, getRepoInfo, getReadme } from '$lib/server/integrations/github.js';
import { getLapseTimelapses } from '$lib/server/integrations/lapse.js';
import { CHECKS } from '$lib/server/checks/registry.js';
import { enqueueChecks } from '$lib/server/queue/checks.js';
import { createLogger } from '$lib/server/logger.js';
import type { CheckContext } from '$lib/server/checks/types.js';
import type { SubmitReviewActionInput } from '$lib/server/protocol/types.js';
import type { PageServerLoad, Actions } from './$types.js';

const log = createLogger('page:review');

export const load: PageServerLoad = async ({ params, parent }) => {
	const tTotal = log.time('load');
	log.info('loading review detail', { projectId: params.projectId, programId: params.programId });

	const tParent = log.time('parent()');
	const { user } = await parent();
	if (!user) throw redirect(302, '/auth/login');
	tParent.end();

	const tAuth = log.time('auth + program');
	const membership = await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});
	tAuth.end();

	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);

	const tProtocol = log.time('protocol (project+timeline+stats)');
	const [project, timeline, stats] = await Promise.all([
		client.fetchProjectDetail({ projectId: params.projectId }),
		client.fetchProjectTimeline({ projectId: params.projectId }),
		client.getProgramStats({})
	]);
	tProtocol.end();

	const pendingShip = project.ships.find((s) => s.status === 'pending' || s.status === 'pending_hq');

	// Resolve author and all timeline actors in one batch
	const actorIds = new Set([project.authorId]);
	for (const event of timeline.events) {
		actorIds.add(event.actorId);
	}
	const tActors = log.time('resolveActorIds');
	const actors = await resolveActorIds([...actorIds]);
	const author = actors.get(project.authorId)!;
	tActors.end({ actorCount: actorIds.size });

	const hackatimeUser = project.hackatimeId ?? project.authorId;

	// Look up author's user record for join date and hackatime ID
	const tAuthorUser = log.time('authorUser query');
	const authorUser = await db.user.findFirst({
		where: project.authorId.startsWith('U')
			? { slackId: project.authorId }
			: { hcaId: project.authorId },
		select: { createdAt: true, hackatimeId: true }
	});
	tAuthorUser.end();

	// Stream integration data — each resolves independently for incremental rendering
	type GhCommit = {
		sha: string;
		message: string;
		author: string;
		authorAvatarUrl: string | null;
		date: string;
		additions: number;
		deletions: number;
		files: Array<{ filename: string; status: string; additions: number; deletions: number }>;
	};
	type LapseEntry = {
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
	};
	type AirtableMatch = {
		id: string;
		url: string;
		hours: number;
		approvedAt: string | null;
	};

	const repo = parseRepoUrl(project.codeUrl);
	const checkShipId = pendingShip?.id ?? params.projectId;

	// Clear stale check results eagerly so the client's first poll doesn't
	// pick up completed results from a previous run and stop polling before
	// enqueueChecks (which is fire-and-forget) creates fresh pending results.
	await db.checkResult.deleteMany({ where: { programId: params.programId, shipId: checkShipId } });

	const hackatimeData = (async () => {
		if (!(hackatimeUser && project.hackatimeProjectKeys.length > 0)) {
			return { hackatime: null as { totalSeconds: number; aiSeconds: number; quirkSeconds: number } | null, trustLevel: null as string | null, projectBreakdown: [] as { name: string; totalSeconds: number }[] };
		}
		try {
			const [projectDetails, trust, metrics] = await Promise.all([
				getProjectDetails(hackatimeUser, project.hackatimeProjectKeys),
				getUserTrustFactor(hackatimeUser),
				getHeartbeatMetrics(hackatimeUser, project.hackatimeProjectKeys)
			]);
			const { aiSeconds, quirkSeconds } = metrics;
			const totalSeconds = projectDetails.projects.reduce((s, p) => s + p.totalSeconds, 0);
			log.debug('hackatime data loaded', { totalSeconds, aiSeconds, quirkSeconds, trustLevel: trust.trustLevel });
			return {
				hackatime: { totalSeconds, aiSeconds, quirkSeconds },
				trustLevel: trust.trustLevel,
				projectBreakdown: projectDetails.projects.map((p) => ({ name: p.name, totalSeconds: p.totalSeconds }))
			};
		} catch (e) {
			log.error('hackatime integration failed', e);
			return { hackatime: null, trustLevel: null, projectBreakdown: [] };
		}
	})();

	const airtableData = (async () => {
		try {
			const records = await findRecordsByUrl(project.demoUrl ?? '', project.codeUrl);
			const airtableRecords: AirtableMatch[] = records.map((r) => ({
				id: r.fields['ID'] ?? r.id,
				url: airtableRecordUrl(r.id),
				hours: r.fields['Override Hours Spent'] ?? r.fields['Hours Spent'] ?? 0,
				approvedAt: r.fields['Approved At'] ?? r.fields['Created'] ?? null
			}));
			const airtablePreviousHours = airtableRecords.reduce((s, r) => s + r.hours, 0);
			log.debug('airtable data loaded', { recordCount: airtableRecords.length, previousHours: airtablePreviousHours });
			return { airtableRecords, airtablePreviousHours };
		} catch (e) {
			log.error('airtable integration failed', e);
			return { airtableRecords: [] as AirtableMatch[], airtablePreviousHours: 0 };
		}
	})();

	const githubData = (async () => {
		if (!repo) return { githubCommits: [] as GhCommit[], githubReadme: null as string | null, githubIsPublic: false };
		try {
			const [commits, repoInfo, readme] = await Promise.all([
				getCommits(repo.owner, repo.repo),
				getRepoInfo(repo.owner, repo.repo),
				getReadme(repo.owner, repo.repo)
			]);
			log.debug('github data loaded', { commitCount: commits.length, isPublic: repoInfo.isPublic });
			return { githubCommits: commits, githubIsPublic: repoInfo.isPublic, githubReadme: readme };
		} catch (e) {
			log.error('github integration failed', e);
			return { githubCommits: [] as GhCommit[], githubReadme: null as string | null, githubIsPublic: false };
		}
	})();

	const lapseData = (async () => {
		if (!(hackatimeUser && project.hackatimeProjectKeys.length > 0)) return { lapseTimelapses: [] as LapseEntry[] };
		try {
			const timelapses = await getLapseTimelapses(hackatimeUser, project.hackatimeProjectKeys);
			log.debug('lapse data loaded', { timelapseCount: timelapses.length });
			return { lapseTimelapses: timelapses.map((t) => ({ ...t })) };
		} catch (e) {
			log.error('lapse integration failed', e);
			return { lapseTimelapses: [] as LapseEntry[] };
		}
	})();

	// Enqueue checks once hackatime + github + airtable resolve (don't wait for lapse)
	Promise.all([hackatimeData, airtableData, githubData]).then(([ht, at, gh]) => {
		log.debug('checks context ready', { projectId: params.projectId });
		const checkCtx: CheckContext = {
			project,
			ship: pendingShip ?? {
				id: params.projectId,
				hoursSubmitted: 0,
				submittedAt: new Date().toISOString(),
				status: 'pending' as const
			},
			timeline: timeline.events,
			hackatime:
				hackatimeUser && project.hackatimeProjectKeys.length > 0
					? {
							username: hackatimeUser,
							totalSeconds: ht.hackatime?.totalSeconds ?? 0,
							aiSeconds: ht.hackatime?.aiSeconds ?? 0,
							projectKeys: project.hackatimeProjectKeys,
							trustLevel: ht.trustLevel
						}
					: null,
			github: repo
				? {
						owner: repo.owner,
						repo: repo.repo,
						commits: gh.githubCommits.map((c) => ({
							sha: c.sha,
							message: c.message,
							date: c.date,
							files: c.files.map((f) => ({ filename: f.filename }))
						})),
						readmeContent: gh.githubReadme,
						isPublic: gh.githubIsPublic
					}
				: null,
			airtable: {
				existingRecords: [],
				totalPreviousHours: at.airtablePreviousHours
			}
		};
		enqueueChecks(params.programId, checkShipId, checkCtx).catch((e) => {
			log.error('failed to enqueue checks', e);
		});
	}).catch((e) => {
		log.error('failed to build checks context', e);
	});
	tTotal.end({ projectId: params.projectId });

	// Serialize actors map for the client
	const actorsObj: Record<string, { name: string; avatarUrl: string | null }> = {};
	for (const [id, actor] of actors) {
		actorsObj[id] = { name: actor.name, avatarUrl: actor.avatarUrl };
	}

	function formatJoinDate(date: Date): string {
		const diffMs = Date.now() - date.getTime();
		const days = Math.floor(diffMs / 86400000);
		if (days < 30) return `Joined ${days}d ago`;
		const months = Math.floor(days / 30.44);
		if (months < 12) return `Joined ${months}mo ago`;
		const years = Math.floor(months / 12);
		const remainMonths = months % 12;
		if (remainMonths === 0) return `Joined ${years}yr ago`;
		return `Joined ${years}yr ${remainMonths}mo ago`;
	}

	// Merge pending approvals into timeline
	const pendingApprovals = await db.pendingApproval.findMany({
		where: { programId: params.programId, projectId: params.projectId }
	});

	const shipStatusMap = Object.fromEntries(project.ships.map((s) => [s.id, s.status]));
	const pendingHqShipIds = new Set(
		project.ships.filter((s) => s.status === 'pending_hq').map((s) => s.id)
	);

	// Group approval events by ship to detect multi-approval (HQ authorization) patterns.
	const approvalsByShip = new Map<string, Array<Extract<typeof timeline.events[number], { type: 'approval' }>>>();
	for (const event of timeline.events) {
		if (event.type === 'approval') {
			const list = approvalsByShip.get(event.shipId) ?? [];
			list.push(event);
			approvalsByShip.set(event.shipId, list);
		}
	}

	// Ships with 2+ approvals where the ship is now approved = HQ authorized.
	// First approval is the reviewer, last is the HQ authorizer.
	const authorizedByActor: Record<string, string> = {};
	const hqApprovalEvents = new Set<typeof timeline.events[number]>();
	for (const [shipId, approvals] of approvalsByShip) {
		if (approvals.length >= 2 && shipStatusMap[shipId] === 'approved') {
			const sorted = approvals.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
			authorizedByActor[shipId] = sorted[sorted.length - 1].actorId;
			hqApprovalEvents.add(sorted[sorted.length - 1]);
		}
	}

	// Find approval events whose ship is no longer approved/pending_hq (i.e. deauthorized).
	// For each, find the subsequent rejection to identify who discarded it.
	const discardedShipIds = new Set<string>();
	const discardedByActor: Record<string, string> = {};
	for (const event of timeline.events) {
		if (event.type === 'approval') {
			const status = shipStatusMap[event.shipId];
			if (status && status !== 'approved' && status !== 'pending_hq') {
				discardedShipIds.add(event.shipId);
			}
		}
	}
	for (const event of timeline.events) {
		if (event.type === 'rejection' && discardedShipIds.has(event.shipId) && !discardedByActor[event.shipId]) {
			discardedByActor[event.shipId] = event.actorId;
		}
	}

	const mergedTimeline = [...timeline.events]
		.map((event) => {
			if (event.type === 'approval' && pendingHqShipIds.has(event.shipId)) {
				return {
					type: 'pending_approval' as const,
					id: `hq:${event.shipId}`,
					shipId: event.shipId,
					actorId: event.actorId,
					hoursAssigned: event.hoursAssigned,
					feedbackMessage: event.feedbackMessage,
					justification: event.justification,
					fields: event.fields,
					timestamp: event.timestamp
				};
			}
			if (event.type === 'approval' && discardedShipIds.has(event.shipId)) {
				return {
					type: 'discarded_approval' as const,
					id: `disc:${event.shipId}`,
					shipId: event.shipId,
					actorId: event.actorId,
					discardedByActorId: discardedByActor[event.shipId] ?? event.actorId,
					hoursAssigned: event.hoursAssigned,
					feedbackMessage: event.feedbackMessage,
					justification: event.justification,
					fields: event.fields,
					timestamp: event.timestamp
				};
			}
			if (event.type === 'approval' && authorizedByActor[event.shipId] && !hqApprovalEvents.has(event)) {
				return {
					type: 'authorized_approval' as const,
					shipId: event.shipId,
					actorId: event.actorId,
					authorizedByActorId: authorizedByActor[event.shipId],
					hoursAssigned: event.hoursAssigned,
					hoursDeflated: event.hoursDeflated,
					feedbackMessage: event.feedbackMessage,
					justification: event.justification,
					fields: event.fields,
					timestamp: event.timestamp
				};
			}
			return event;
		})
		.filter((event) => {
			if (event.type === 'rejection' && discardedShipIds.has(event.shipId)) {
				const actorId = discardedByActor[event.shipId];
				if (actorId === event.actorId) {
					delete discardedByActor[event.shipId];
					return false;
				}
			}
			// Filter out the HQ approval event (absorbed into the authorized_approval pill)
			if (hqApprovalEvents.has(event as typeof timeline.events[number])) {
				return false;
			}
			return true;
		});

	for (const pa of pendingApprovals) {
		actorIds.add(pa.reviewerId);
		if (pa.discardedById) actorIds.add(pa.discardedById);

		if (pa.status === 'discarded') {
			mergedTimeline.push({
				type: 'discarded_approval',
				id: pa.id,
				shipId: pa.shipId,
				actorId: pa.reviewerId,
				discardedByActorId: pa.discardedById!,
				hoursAssigned: pa.hoursAssigned,
				feedbackMessage: pa.feedbackMessage,
				justification: pa.justification,
				fields: (pa.fields as Record<string, string | number | boolean>) ?? undefined,
				timestamp: pa.createdAt.toISOString()
			});
		} else {
			mergedTimeline.push({
				type: 'pending_approval',
				id: pa.id,
				shipId: pa.shipId,
				actorId: pa.reviewerId,
				hoursAssigned: pa.hoursAssigned,
				feedbackMessage: pa.feedbackMessage,
				justification: pa.justification,
				fields: (pa.fields as Record<string, string | number | boolean>) ?? undefined,
				timestamp: pa.createdAt.toISOString()
			});
		}
	}

	mergedTimeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

	// Re-resolve actors if we added new ones from pending approvals
	if (pendingApprovals.length > 0) {
		const allActors = await resolveActorIds([...actorIds]);
		for (const [id, actor] of allActors) {
			actorsObj[id] = { name: actor.name, avatarUrl: actor.avatarUrl };
		}
	}

	return {
		project,
		pendingShip: pendingShip ?? null,
		author: {
			name: author.name,
			email: author.email,
			avatarUrl: author.avatarUrl,
			slackId: author.slackId,
			hackatimeId: authorUser?.hackatimeId ?? project.hackatimeId ?? null,
			joinDate: authorUser ? formatJoinDate(authorUser.createdAt) : ''
		},
		actors: actorsObj,
		timeline: mergedTimeline,
		pendingCount: stats.pendingReviewCount,
		hackatimeData,
		airtableData,
		githubData,
		lapseData,
		checkShipId,
		checks: CHECKS.map((c) => ({
			id: c.id,
			name: c.description,
			status: 'pending' as const,
			passed: false,
			summary: '',
			severity: c.severity
		})),
		canReview: membership.canCreateReviews,
		canAuthorize: membership.canAuthorizeReviews,
		programYswsName: program.yswsName || program.name,
		hackatimeUser: hackatimeUser && project.hackatimeProjectKeys.length > 0 ? hackatimeUser : null
	};
};

export const actions: Actions = {
	review: async ({ request, params, locals }) => {
		const user = locals.user;
		if (!user) throw error(401);

		const membership = await requirePermission(user.id, params.programId, 'canCreateReviews', {
			isSuperAdmin: user.isSuperAdmin
		});

		const program = await db.program.findUniqueOrThrow({
			where: { id: params.programId }
		});

		const formData = await request.formData();
		const action = formData.get('action') as string;
		const shipId = formData.get('shipId') as string;
		const fieldsRaw = formData.get('fields') as string | null;
		const fields = fieldsRaw ? JSON.parse(fieldsRaw) as Record<string, string | number | boolean> : undefined;

		log.info('review action', { action, shipId, projectId: params.projectId, userId: user.id });

		const reviewerId = user.slackId || user.hcaId;

		// Non-HQ approvals go to pending queue instead of master endpoint
		if (action === 'approve' && !membership.canAuthorizeReviews) {
			log.info('queuing pending approval (non-HQ user)', { shipId, projectId: params.projectId });
			await db.pendingApproval.upsert({
				where: {
					programId_shipId_reviewerId: {
						programId: params.programId,
						shipId,
						reviewerId
					}
				},
				create: {
					programId: params.programId,
					projectId: params.projectId,
					shipId,
					reviewerId,
					hoursAssigned: parseFloat(formData.get('hoursAssigned') as string),
					feedbackMessage: formData.get('feedbackMessage') as string,
					justification: formData.get('justification') as string,
					fields: fields ?? undefined
				},
				update: {
					hoursAssigned: parseFloat(formData.get('hoursAssigned') as string),
					feedbackMessage: formData.get('feedbackMessage') as string,
					justification: formData.get('justification') as string,
					fields: fields ?? undefined
				}
			});

			await db.auditLog.create({
				data: {
					programId: params.programId,
					userId: user.id,
					action: 'review_pending_approve',
					entityType: 'ship',
					entityId: shipId,
					metadata: {
						projectId: params.projectId,
						hoursAssigned: (formData.get('hoursAssigned') as string) || null
					}
				}
			});

			log.info('review queued for hq approval', { shipId, projectId: params.projectId });
			return { success: true };
		}

		const client = new ProtocolClient(program.masterEndpoint, program.secretKey);

		let input: SubmitReviewActionInput;
		const base = { shipId, reviewerId };

		switch (action) {
			case 'approve':
				input = {
					...base,
					action: 'approve',
					hoursAssigned: parseFloat(formData.get('hoursAssigned') as string),
					feedbackMessage: formData.get('feedbackMessage') as string,
					justification: formData.get('justification') as string,
					fields
				};
				break;
			case 'reject':
				input = {
					...base,
					action: 'reject',
					feedbackMessage: formData.get('feedbackMessage') as string,
					internalMessage: (formData.get('internalMessage') as string) || undefined,
					fields
				};
				break;
			case 'comment':
			case 'internal_comment': {
				const commentText = (formData.get('commentText') as string | null) ?? '';
				if (!commentText.trim()) throw error(400, 'Comment text is required');
				input = {
					...base,
					action: action as 'comment' | 'internal_comment',
					commentText
				};
				break;
			}
			default:
				throw error(400, `Unknown action: ${action}`);
		}

		let result;
		try {
			result = await client.submitReviewAction(input);

			// HQ users skip the pending_hq step — auto-authorize after approve
			if (action === 'approve' && membership.canAuthorizeReviews) {
				result = await client.submitReviewAction({ shipId, reviewerId, action: 'authorize' });
			}
		} catch (e) {
			if (e instanceof ProtocolError) {
				const parsed = JSON.parse(e.body).message ?? e.body;
				log.error('protocol error during review action', e, { action, shipId });
				return fail(502, { protocolError: `Upstream error: ${parsed}` });
			}
			throw e;
		}

		await db.auditLog.create({
			data: {
				programId: params.programId,
				userId: user.id,
				action: `review_${action}`,
				entityType: 'ship',
				entityId: shipId,
				metadata: {
					projectId: params.projectId,
					hoursAssigned: (formData.get('hoursAssigned') as string) || null
				}
			}
		});

		log.info('review action complete', { action, shipId, success: result.success });

		return { success: result.success };
	}
};
