import { programAccess, ToolError, type McpContext } from './access.js';
import { getUserInfo } from '../integrations/hackatime.js';
import { getCommits, parseRepoUrl } from '../integrations/github.js';
import { createLogger } from '../logger.js';
import type { Permission } from '../rbac.js';
import type { Project } from '../protocol/types.js';

const log = createLogger('mcp:subject');

/**
 * A project under review and everything the tools key off it: the program
 * (after the permission check), the ship a verdict would land on, and whose
 * Hackatime account and timezone the time is read in.
 */
export async function loadSubject(
	ctx: McpContext,
	programId: string,
	projectId: string,
	permission: Permission = 'canViewReviews'
) {
	const access = await programAccess(ctx, programId, permission);
	const project = await access.client.fetchProjectDetail({ projectId });
	// The most recent pending ship, as on the review page: a verdict covers all
	// work up to it, and an older pending ship was superseded.
	const pendingShip =
		project.ships.findLast((s) => s.status === 'pending' || s.status === 'pending_hq') ?? null;
	const hackatimeUser =
		project.hackatimeProjectKeys.length > 0 ? (project.hackatimeId ?? project.authorId) : null;
	return { ...access, project, pendingShip, hackatimeUser };
}

export type Subject = Awaited<ReturnType<typeof loadSubject>>;

/** The author's Hackatime timezone; days and clock times are read in it, as on the review page. */
export async function authorTimezone(
	subject: Subject
): Promise<{ tz: string; trustLevel: string | null }> {
	if (!subject.hackatimeUser) return { tz: 'UTC', trustLevel: null };
	try {
		const info = await getUserInfo(subject.hackatimeUser);
		return { tz: info.timezone || 'UTC', trustLevel: info.trustLevel };
	} catch (e) {
		log.warn('author timezone lookup failed', { error: String(e) });
		return { tz: 'UTC', trustLevel: null };
	}
}

export function requireHackatime(subject: Subject): string {
	if (!subject.hackatimeUser) {
		throw new ToolError(
			'This project links no Hackatime projects, so there is no tracked time to look at.'
		);
	}
	return subject.hackatimeUser;
}

export interface SubjectCommit {
	sha: string;
	message: string;
	author: string;
	authorLogin: string | null;
	timeS: number;
}

/** The repository's commits, newest first, or null when the code URL is not a readable GitHub repository. */
export async function loadCommits(project: Project): Promise<SubjectCommit[] | null> {
	const repo = parseRepoUrl(project.codeUrl);
	if (!repo) return null;
	try {
		const commits = repo.branch
			? await getCommits(repo.owner, repo.repo, { sha: repo.branch }).catch(() =>
					getCommits(repo.owner, repo.repo)
				)
			: await getCommits(repo.owner, repo.repo);
		return commits.map((c) => ({
			sha: c.sha,
			message: c.message,
			author: c.author,
			authorLogin: c.authorLogin,
			timeS: Math.floor(new Date(c.date).getTime() / 1000)
		}));
	} catch (e) {
		log.warn('commit fetch failed', { error: String(e) });
		return null;
	}
}
