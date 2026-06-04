import { redirect, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient } from '$lib/server/protocol/client.js';
import { resolveActorIds } from '$lib/server/actors.js';
import { getProjectDetails, getUserTrustFactor } from '$lib/server/integrations/hackatime.js';
import { findRecordsByUrl, airtableRecordUrl } from '$lib/server/integrations/airtable.js';
import { parseRepoUrl, getCommits, getRepoInfo, getReadme } from '$lib/server/integrations/github.js';
import { getLapseTimelapses } from '$lib/server/integrations/lapse.js';
import { CHECKS } from '$lib/server/checks/registry.js';
import { enqueueChecks } from '$lib/server/queue/checks.js';
import type { CheckContext } from '$lib/server/checks/types.js';
import type { SubmitReviewActionInput } from '$lib/server/protocol/types.js';
import type { PageServerLoad, Actions } from './$types.js';

export const load: PageServerLoad = async ({ params, parent }) => {
	const t0 = performance.now();
	const lap = (label: string) => {
		const ms = (performance.now() - t0).toFixed(0);
		console.log(`[review ${params.projectId}] ${ms}ms — ${label}`);
	};

	const { user } = await parent();
	if (!user) throw redirect(302, '/auth/login');
	lap('parent()');

	const membership = await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});
	lap('auth + program');

	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);

	const [project, timeline, stats] = await Promise.all([
		client.fetchProjectDetail({ projectId: params.projectId }),
		client.fetchProjectTimeline({ projectId: params.projectId }),
		client.getProgramStats({})
	]);
	lap('protocol (project+timeline+stats)');

	const pendingShip = project.ships.find((s) => s.status === 'pending');

	// Resolve author and all timeline actors in one batch
	const actorIds = new Set([project.authorId]);
	for (const event of timeline.events) {
		actorIds.add(event.actorId);
	}
	const actors = await resolveActorIds([...actorIds]);
	const author = actors.get(project.authorId)!;
	lap('resolveActorIds');

	const hackatimeUser = project.hackatimeId ?? project.authorId;

	// Look up author's user record for join date and hackatime ID
	const authorUser = await db.user.findFirst({
		where: project.authorId.startsWith('U')
			? { slackId: project.authorId }
			: { hcaId: project.authorId },
		select: { createdAt: true, hackatimeId: true }
	});
	lap('authorUser query');

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

	const hackatimeData = (async () => {
		if (!(hackatimeUser && project.hackatimeProjectKeys.length > 0)) {
			return { hackatime: null as { totalSeconds: number; aiSeconds: number } | null, trustLevel: null as string | null };
		}
		try {
			const [projectDetails, trust] = await Promise.all([
				getProjectDetails(hackatimeUser, project.hackatimeProjectKeys),
				getUserTrustFactor(hackatimeUser)
			]);
			const totalSeconds = projectDetails.projects.reduce((s, p) => s + p.totalSeconds, 0);
			lap('  hackatime');
			return { hackatime: { totalSeconds, aiSeconds: 0 }, trustLevel: trust.trustLevel };
		} catch (e) {
			console.error('[review] hackatime failed:', e);
			lap('  hackatime (failed)');
			return { hackatime: null, trustLevel: null };
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
			lap('  airtable');
			return { airtableRecords, airtablePreviousHours };
		} catch (e) {
			console.error('[review] airtable failed:', e);
			lap('  airtable (failed)');
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
			lap('  github');
			return { githubCommits: commits, githubIsPublic: repoInfo.isPublic, githubReadme: readme };
		} catch (e) {
			console.error('[review] github failed:', e);
			lap('  github (failed)');
			return { githubCommits: [] as GhCommit[], githubReadme: null as string | null, githubIsPublic: false };
		}
	})();

	const lapseData = (async () => {
		if (!(hackatimeUser && project.hackatimeProjectKeys.length > 0)) return { lapseTimelapses: [] as LapseEntry[] };
		try {
			const timelapses = await getLapseTimelapses(hackatimeUser, project.hackatimeProjectKeys);
			lap('  lapse');
			return { lapseTimelapses: timelapses.map((t) => ({ ...t })) };
		} catch (e) {
			console.error('[review] lapse failed:', e);
			lap('  lapse (failed)');
			return { lapseTimelapses: [] as LapseEntry[] };
		}
	})();

	// Enqueue checks once hackatime + github + airtable resolve (don't wait for lapse)
	Promise.all([hackatimeData, airtableData, githubData]).then(([ht, at, gh]) => {
		lap('  checks context ready');
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
			console.error('[checks] Failed to enqueue:', e);
		});
	}).catch((e) => {
		console.error('[checks] Failed to build context:', e);
	});
	lap('returned (integrations streaming)');

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

	const mergedTimeline = [...timeline.events];
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

		const reviewerId = user.slackId || user.hcaId;

		// Non-HQ approvals go to pending queue instead of master endpoint
		if (action === 'approve' && !membership.canAuthorizeReviews) {
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
					justification: formData.get('justification') as string
				},
				update: {
					hoursAssigned: parseFloat(formData.get('hoursAssigned') as string),
					feedbackMessage: formData.get('feedbackMessage') as string,
					justification: formData.get('justification') as string
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
					justification: formData.get('justification') as string
				};
				break;
			case 'reject':
				input = {
					...base,
					action: 'reject',
					feedbackMessage: formData.get('feedbackMessage') as string,
					internalMessage: (formData.get('internalMessage') as string) || undefined
				};
				break;
			case 'internal_comment':
				input = {
					...base,
					action: 'internal_comment',
					commentText: formData.get('commentText') as string
				};
				break;
			default:
				input = {
					...base,
					action: 'comment',
					commentText: formData.get('commentText') as string
				};
				break;
		}

		const result = await client.submitReviewAction(input);

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

		return { success: result.success };
	}
};
