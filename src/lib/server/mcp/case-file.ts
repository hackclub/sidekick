import { db } from '../db.js';
import { resolveActorIds } from '../actors.js';
import { ProtocolError } from '../protocol/client.js';
import { getProjectHackatimeStats, getTrustLogs } from '../integrations/hackatime.js';
import {
	findRecordsByUrl,
	normalizeUrl,
	programFromId,
	redactPii
} from '../integrations/airtable.js';
import { getReadme, getRepoInfo, parseRepoUrl } from '../integrations/github.js';
import { getLapseTimelapses, lapseUrl } from '../integrations/lapse.js';
import { getCachedLapseAfkAnalyses } from '../integrations/lapse-afk.js';
import { runAllChecks } from '../checks/registry.js';
import { loadFraudReviewState } from '../fraud-review.js';
import { createLogger } from '../logger.js';
import { clip, hours, reviewUrl, type McpContext } from './access.js';
import { loadCommits, type Subject } from './subject.js';
import { loadTimeline } from './timeline.js';
import type { CheckContext } from '../checks/types.js';
import type { TimelineEvent } from '../protocol/types.js';

const log = createLogger('mcp:case-file');

async function settle<T>(label: string, promise: Promise<T>): Promise<T | { unavailable: string }> {
	try {
		return await promise;
	} catch (e) {
		log.warn(`case file: ${label} failed`, { error: String(e) });
		return {
			unavailable: e instanceof ProtocolError ? e.displayMessage : `${label} could not be loaded`
		};
	}
}

/** Hours already approved in this program, per approved ship, from its approval events. */
function approvedHours(subject: Subject, events: Array<TimelineEvent | { type: string }>): number {
	const approved = new Set(
		subject.project.ships.filter((s) => s.status === 'approved').map((s) => s.id)
	);
	const byShip = new Map<string, number>();
	for (const e of events) {
		if (
			(e.type === 'approval' || e.type === 'authorized_approval') &&
			'shipId' in e &&
			approved.has(e.shipId)
		) {
			byShip.set(e.shipId, (e as { hoursAssigned: number }).hoursAssigned);
		}
	}
	return [...byShip.values()].reduce((s, h) => s + h, 0);
}

/**
 * Everything Sidekick knows about a project that the agent cannot find out
 * for itself, in one answer: the claim, the author's other work, the Unified
 * YSWS DB matches, the automated checks, the headline of the tracked time
 * and the history in brief. Facts only: what they mean, and what to do about
 * them, is the review skill's business, not the server's. The repository is not here: the agent clones it and reads the code and the git
 * history with its own tools. GitHub is read only to run Sidekick's checks,
 * the same ones the review page shows.
 */
export async function buildCaseFile(ctx: McpContext, subject: Subject) {
	const { project, pendingShip, membership, client } = subject;
	const canSeeTime = membership.canViewHeartbeats;
	const repo = parseRepoUrl(project.codeUrl);

	const [
		actors,
		timeline,
		commits,
		unified,
		authorProjects,
		userNote,
		hackatime,
		github,
		lapse,
		myDraft,
		fraudReview
	] = await Promise.all([
		resolveActorIds([project.authorId]),
		loadTimeline(ctx, subject),
		loadCommits(project),
		settle('Unified YSWS DB', findRecordsByUrl(project.demoUrl ?? '', project.codeUrl)),
		settle(
			'other projects',
			client.fetchAuthorProjects({ authorId: project.authorId, excludeProjectId: project.id })
		),
		settle('user note', client.fetchUserNote({ userId: project.authorId })),
		subject.hackatimeUser && canSeeTime
			? settle(
					'Hackatime',
					Promise.all([
						getProjectHackatimeStats(
							subject.hackatimeUser,
							project.hackatimeProjectKeys,
							project.hackatimeStartDate
						),
						getTrustLogs(subject.hackatimeUser).catch(() => [])
					])
				)
			: Promise.resolve(null),
		repo
			? settle(
					'GitHub',
					Promise.all([getRepoInfo(repo.owner, repo.repo), getReadme(repo.owner, repo.repo)])
				)
			: Promise.resolve(null),
		subject.hackatimeUser && canSeeTime
			? settle('Lapse', getLapseTimelapses(subject.hackatimeUser, project.hackatimeProjectKeys))
			: Promise.resolve(null),
		pendingShip
			? db.reviewDraft.findUnique({
					where: {
						programId_shipId_userId: {
							programId: subject.program.id,
							shipId: pendingShip.id,
							userId: ctx.user.id
						}
					}
				})
			: Promise.resolve(null),
		canSeeTime ? loadFraudReviewState(subject.program.id, project) : Promise.resolve(null)
	]);
	const author = actors.get(project.authorId);

	const unifiedRows =
		'unavailable' in unified
			? unified
			: unified.map((r) => {
					// An empty URL matches nothing: '' === '' would claim every row without one.
					const repoMatches =
						!!normalizeUrl(project.codeUrl) &&
						normalizeUrl(r.fields['Code URL'] ?? '') === normalizeUrl(project.codeUrl);
					const demoMatches =
						!!normalizeUrl(project.demoUrl ?? '') &&
						normalizeUrl(r.fields['Playable URL'] ?? '') === normalizeUrl(project.demoUrl ?? '');
					const justification = r.fields['Override Hours Spent Justification']?.trim();
					return {
						program:
							r.fields['YSWS–Name']?.join(', ').trim() ||
							redactPii(programFromId(r.fields['ID'] ?? ''), r) ||
							'Unknown program',
						hours: r.fields['Override Hours Spent'] ?? r.fields['Hours Spent'] ?? 0,
						approvedAt: r.fields['Approved At'] ?? null,
						matchedOn: [...(repoMatches ? ['code URL'] : []), ...(demoMatches ? ['demo URL'] : [])],
						codeUrl: r.fields['Code URL'] ?? null,
						playableUrl: r.fields['Playable URL'] ?? null,
						justification: justification ? clip(redactPii(justification, r), 400) : null
					};
				});

	let checks: unknown = null;
	if (pendingShip) {
		const hackatimeStats = hackatime && !('unavailable' in hackatime) ? hackatime[0] : null;
		const githubInfo = github && !('unavailable' in github) ? github : null;
		const unifiedPrevious = Array.isArray(unifiedRows)
			? unifiedRows.filter((r) => r.matchedOn.length === 2).reduce((s, r) => s + r.hours, 0)
			: 0;
		const checkCtx: CheckContext = {
			project,
			ship: pendingShip,
			timeline: timeline.events.filter((e): e is TimelineEvent => e.type !== 'held_approval'),
			hackatime:
				subject.hackatimeUser && hackatimeStats
					? {
							username: subject.hackatimeUser,
							totalSeconds: hackatimeStats.projects.reduce((s, p) => s + p.totalSeconds, 0),
							aiSeconds: hackatimeStats.aiSeconds,
							projectKeys: project.hackatimeProjectKeys,
							trustLevel: null
						}
					: null,
			github:
				repo && githubInfo
					? {
							owner: repo.owner,
							repo: repo.repo,
							commits: (commits ?? []).map((c) => ({
								sha: c.sha,
								message: c.message,
								date: new Date(c.timeS * 1000).toISOString()
							})),
							readmeContent: githubInfo[1],
							isPublic: githubInfo[0].isPublic
						}
					: null,
			airtable: { existingRecords: [], totalPreviousHours: unifiedPrevious }
		};
		const sidekickChecks = await runAllChecks(checkCtx).catch(() => []);
		const programChecks = pendingShip.checks ?? [];
		checks = {
			failing: [
				...sidekickChecks
					.filter((c) => !c.result.pass)
					.map((c) => ({
						source: 'Sidekick',
						name: c.check.description,
						severity: c.check.severity,
						summary: clip(c.result.summary, 600)
					})),
				...programChecks
					.filter((c) => c.status !== 'pass')
					.map((c) => ({
						source: c.group ?? subject.program.name,
						name: c.name,
						status: c.status,
						severity: c.severity ?? 'fail',
						summary: clip(c.summary, 600)
					}))
			],
			passing:
				sidekickChecks.filter((c) => c.result.pass).length +
				programChecks.filter((c) => c.status === 'pass').length
		};
	}

	const systemEvents = timeline.events
		.map((e, index) => ({ e, index }))
		.filter(({ e }) => e.type === 'system');
	const lastHuman = [...timeline.events]
		.reverse()
		.find(
			(e) => e.type === 'approval' || e.type === 'rejection' || e.type === 'authorized_approval'
		);

	const hackatimeSection =
		hackatime === null
			? canSeeTime
				? { linked: false, note: 'No Hackatime projects are linked.' }
				: { note: 'Your membership cannot view Hackatime details for this program.' }
			: 'unavailable' in hackatime
				? hackatime
				: (() => {
						const [stats, trustLogs] = hackatime;
						const total = stats.projects.reduce((s, p) => s + p.totalSeconds, 0);
						return {
							trackedHours: hours(total),
							aiCodingHours: hours(stats.aiSeconds),
							browserHours: hours(stats.browserSeconds),
							projects: stats.projects.map((p) => `${p.name} ${hours(p.totalSeconds)}h`),
							countingFrom: project.hackatimeStartDate ?? 'all time',
							truncated: stats.truncated || undefined,
							trustLogs: trustLogs.slice(0, 3).map((t) => ({
								at: t.createdAt,
								change: `${t.previousTrustLevel} -> ${t.newTrustLevel}`,
								reason: clip(t.reason, 200)
							}))
						};
					})();

	let lapseSection: unknown = undefined;
	if (lapse && !('unavailable' in lapse) && lapse.length > 0) {
		const analyses = await getCachedLapseAfkAnalyses(lapse.map((t) => t.id)).catch(() => []);
		const afk = new Map(analyses.map((a) => [a.timelapseId, a.totalAfkSeconds]));
		lapseSection = lapse.map((t) => ({
			name: t.name,
			url: lapseUrl(t.ownerHandle, t.id),
			durationMinutes: Math.round(t.duration / 60),
			afkMinutes: afk.has(t.id) ? Math.round(afk.get(t.id)! / 60) : 'not analysed yet'
		}));
	}

	// The approval HQ would authorize: one Sidekick is holding (a community
	// reviewer's, or one routed to fraud review), or the program's own
	// pending_hq approval. Held ones hidden from this member stay hidden, as
	// in the timeline.
	const awaitingHq = () => {
		if (!pendingShip) return null;
		const held = timeline.events.findLast(
			(e) => e.type === 'held_approval' && e.status === 'pending' && e.shipId === pendingShip.id
		);
		const upstream =
			pendingShip.status === 'pending_hq'
				? timeline.events.findLast(
						(e) =>
							(e.type === 'approval' || e.type === 'pending_approval') &&
							e.shipId === pendingShip.id
					)
				: undefined;
		const approval = held ?? upstream;
		if (!approval || !('hoursAssigned' in approval)) return null;
		return {
			heldIn:
				approval.type === 'held_approval'
					? approval.queue === 'fraud'
						? 'Sidekick fraud review queue'
						: 'Sidekick HQ queue'
					: 'program (pending_hq)',
			by: timeline.name(approval.actorId),
			at: approval.timestamp,
			hoursAssigned: approval.hoursAssigned,
			feedback: clip(approval.feedbackMessage, 800),
			justification: clip(approval.justification, 3000)
		};
	};

	return {
		reviewUrl: reviewUrl(ctx, subject.program.id, project.id),
		program: subject.program.yswsName || subject.program.name,
		project: {
			id: project.id,
			title: project.title,
			description: clip(project.description, 2000),
			codeUrl: project.codeUrl,
			demoUrl: project.demoUrl ?? null,
			screenshotUrl: project.screenshotUrl ?? null,
			platformUrl: project.platformUrl ?? null,
			hackatimeProjects: project.hackatimeProjectKeys,
			tags: project.tags?.map((t) => t.label) ?? []
		},
		author: {
			name: author?.name ?? project.authorId,
			slackId: author?.slackId ?? null,
			note: 'unavailable' in userNote ? null : (userNote.note ?? null),
			otherProjects:
				'unavailable' in authorProjects
					? undefined
					: authorProjects.projects
							.filter((p) => p.id !== project.id)
							.slice(0, 12)
							.map((p) => ({
								id: p.id,
								title: p.title,
								codeUrl: p.codeUrl,
								ships: p.ships.map(
									(s) => `${s.status} ${s.hoursSubmitted}h ${s.submittedAt.slice(0, 10)}`
								)
							}))
		},
		claim: pendingShip
			? {
					shipId: pendingShip.id,
					ship: project.ships.indexOf(pendingShip) + 1,
					status: pendingShip.status,
					hoursClaimed: pendingShip.hoursSubmitted,
					submittedAt: pendingShip.submittedAt,
					previouslyApprovedHoursHere: approvedHours(subject, timeline.events),
					isUpdate: project.ships.some((s) => s.status === 'approved'),
					awaitingHq: awaitingHq(),
					approveFields: pendingShip.approveFields?.map(
						(f) => `${f.label}${f.required ? ' (required)' : ''}`
					),
					rejectFields: pendingShip.rejectFields?.map(
						(f) => `${f.label}${f.required ? ' (required)' : ''}`
					)
				}
			: { note: 'No ship is pending.' },
		ships: project.ships.map(
			(s, i) =>
				`ship ${i + 1}: ${s.status}, ${s.hoursSubmitted}h claimed, ${s.submittedAt.slice(0, 10)}`
		),
		checks,
		unifiedYswsDb: unifiedRows,
		hackatime: hackatimeSection,
		// Only for those who can see heartbeats, as on the review page.
		fraudReview: canSeeTime
			? fraudReview
				? {
						status: fraudReview.status,
						forPendingShip: fraudReview.forPendingShip,
						ship: project.ships.findIndex((s) => s.id === fraudReview.shipId) + 1 || null,
						by: fraudReview.by.name,
						at: fraudReview.at,
						note: clip(fraudReview.note, 1000)
					}
				: { status: 'none' }
			: undefined,
		lapse: lapseSection,
		history: {
			events: timeline.events.length,
			lastDecision: lastHuman
				? `${lastHuman.type} on ${lastHuman.timestamp.slice(0, 10)}`
				: 'none yet',
			automatedReviews: systemEvents.map(({ e, index }) =>
				e.type === 'system'
					? `#${index} ${e.source.name}: ${clip(e.summary, 300)} (${e.tone ?? 'neutral'})`
					: ''
			)
		},
		yourDraft: myDraft
			? {
					action: myDraft.action,
					hours: myDraft.hoursAssigned,
					updatedAt: myDraft.updatedAt.toISOString()
				}
			: null
	};
}

// The case file is plain JSON by now; trimming walks it without its build-time types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/**
 * Brings a case file under the MCP's answer limit, so a project with a long
 * history still gets one rather than an error. Trims the least useful parts
 * first, one step at a time, and says what it trimmed in `trimmedToFit`.
 */
export function fitCaseFile<T extends object>(caseFile: T, limit: number): T {
	const size = (v: unknown) => JSON.stringify(v, null, 1).length;
	if (size(caseFile) <= limit) return caseFile;
	const cf: Json = structuredClone(caseFile);
	const trimmed: string[] = [];
	const unified = () => (Array.isArray(cf.unifiedYswsDb) ? (cf.unifiedYswsDb as Json[]) : null);
	const steps: Array<() => string | null> = [
		() => {
			// Rows that share only a URL prefix (the author's other repos) are context, not matches.
			const rows = unified()?.filter((r) => !r.matchedOn?.length && r.justification);
			if (!rows?.length) return null;
			for (const r of rows) r.justification = null;
			return 'justifications of Unified YSWS DB rows that match neither URL';
		},
		() => {
			const rows = unified();
			const loose = rows?.filter((r) => !r.matchedOn?.length) ?? [];
			if (!rows || loose.length === 0) return null;
			cf.unifiedYswsDb = rows.filter((r) => r.matchedOn?.length);
			return `${loose.length} Unified YSWS DB rows that match neither the code URL nor the demo URL`;
		},
		() => {
			const reviews = cf.history?.automatedReviews;
			if (!Array.isArray(reviews) || reviews.length <= 5) return null;
			cf.history.automatedReviews = reviews.slice(-5);
			return `all but the last 5 of ${reviews.length} automated reviews (get_timeline has them)`;
		},
		() => {
			const failing = (cf.checks?.failing ?? []) as Json[];
			if (!failing.some((c) => c.summary?.length > 150)) return null;
			for (const c of failing) c.summary = clip(c.summary, 150);
			return 'failing check summaries, to 150 characters';
		},
		() => {
			const rows = unified()?.filter((r) => r.justification?.length > 150);
			if (!rows?.length) return null;
			for (const r of rows) r.justification = clip(r.justification, 150);
			return 'Unified YSWS DB justifications, to 150 characters';
		},
		() => {
			const other = cf.author?.otherProjects;
			if (!Array.isArray(other) || other.length <= 5) return null;
			cf.author.otherProjects = other.slice(0, 5);
			return `the author's other projects, to 5 of ${other.length}`;
		},
		() => {
			if (!Array.isArray(cf.lapse) || cf.lapse.length <= 10) return null;
			const n = cf.lapse.length;
			cf.lapse = cf.lapse.slice(0, 10);
			return `Lapse timelapses, to 10 of ${n}`;
		},
		() => {
			const held = cf.claim?.awaitingHq;
			if (!held?.justification || held.justification.length <= 800) return null;
			held.justification = clip(held.justification, 800);
			return 'the held approval justification, to 800 characters (get_timeline has it in full)';
		}
	];
	for (const step of steps) {
		if (size(cf) <= limit) break;
		const what = step();
		if (!what) continue;
		trimmed.push(what);
		cf.trimmedToFit = trimmed;
	}
	// Still over: something none of the steps expect is large. Halve the largest list (or
	// clip the longest text) anywhere in the file until it fits, and name what was cut.
	for (let guard = 0; guard < 60 && size(cf) > limit; guard++) {
		const biggest = largestPart(cf);
		if (!biggest) break;
		const { parent, key, path, value } = biggest;
		if (Array.isArray(value)) {
			parent[key] = value.slice(0, Math.floor(value.length / 2));
			trimmed.push(`${path}: kept ${parent[key].length} of ${value.length}`);
		} else {
			parent[key] = clip(value, Math.floor(value.length / 2));
			trimmed.push(`${path}: clipped to ${Math.floor(value.length / 2)} characters`);
		}
		cf.trimmedToFit = trimmed;
	}
	return cf as T;
}

/** The largest list with more than one item, or the longest string, in a JSON tree. */
function largestPart(root: Json) {
	let best: {
		parent: Json;
		key: string | number;
		path: string;
		value: unknown[] | string;
		size: number;
	} | null = null;
	const walk = (node: unknown, path: string) => {
		if (!node || typeof node !== 'object') return;
		for (const [k, v] of Object.entries(node)) {
			if (k === 'trimmedToFit') continue;
			const key = Array.isArray(node) ? Number(k) : k;
			const childPath = Array.isArray(node) ? `${path}[${k}]` : path ? `${path}.${k}` : k;
			const shrinkable =
				(Array.isArray(v) && v.length > 1) || (typeof v === 'string' && v.length > 200);
			if (shrinkable) {
				const n = JSON.stringify(v).length;
				if (!best || n > best.size)
					best = {
						parent: node as Json,
						key,
						path: childPath,
						value: v as unknown[] | string,
						size: n
					};
			}
			walk(v, childPath);
		}
	};
	walk(root, '');
	return best as {
		parent: Json;
		key: string | number;
		path: string;
		value: unknown[] | string;
	} | null;
}
