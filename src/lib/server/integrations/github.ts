import { env } from '$env/dynamic/private';
import { createLogger } from '../logger.js';

const log = createLogger('github');
const BASE_URL = 'https://api.github.com';

const CACHE_TTL_MS = 5 * 60 * 1000;
const responseCache = new Map<string, { data: unknown; expiresAt: number }>();

function getCached<T>(key: string): T | undefined {
	const entry = responseCache.get(key);
	if (!entry) return undefined;
	if (Date.now() > entry.expiresAt) {
		responseCache.delete(key);
		return undefined;
	}
	return entry.data as T;
}

function setCache(key: string, data: unknown): void {
	responseCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

interface RepoInfo {
	isPublic: boolean;
	defaultBranch: string;
	description: string | null;
}

interface CommitFile {
	filename: string;
	status: string;
	additions: number;
	deletions: number;
}

interface Commit {
	sha: string;
	message: string;
	author: string;
	authorAvatarUrl: string | null;
	date: string;
	additions: number;
	deletions: number;
	files: CommitFile[];
}

async function authFetch(path: string, params?: Record<string, string>): Promise<Response> {
	const token = env.GITHUB_TOKEN;
	const usingToken = !!token;

	const url = new URL(path, BASE_URL);
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			url.searchParams.set(key, value);
		}
	}

	log.trace('authFetch request', { path, usingToken });
	const timer = log.time(`authFetch ${path}`);

	const headers: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28'
	};

	if (token) {
		headers['Authorization'] = `Bearer ${token}`;
	}

	let response = await fetch(url.toString(), { headers });

	// Fine-grained PATs return 403 or 404 for repos outside their scope.
	// Fall back to unauthenticated for those cases — but NOT for rate limiting,
	// where unauthenticated would be even more restricted (60/hr vs 5000/hr).
	if ((response.status === 403 || response.status === 404) && token) {
		const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
		if (rateLimitRemaining === '0') {
			const reset = response.headers.get('x-ratelimit-reset');
			const resetAt = reset ? new Date(parseInt(reset) * 1000).toISOString() : 'unknown';
			log.warn('authFetch rate limited', { path, resetAt });
		} else {
			log.debug('authFetch falling back to unauthenticated', { path, status: response.status });
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { Authorization: _auth, ...unauthHeaders } = headers;
			response = await fetch(url.toString(), { headers: unauthHeaders });
		}
	}

	timer.end({ status: response.status });

	if (!response.ok) {
		log.error('authFetch failed', undefined, { path, status: response.status, statusText: response.statusText });
		throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
	}

	return response;
}

export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
	log.trace('parseRepoUrl called', { url });
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== 'github.com') {
			log.trace('parseRepoUrl not a github.com URL', { hostname: parsed.hostname });
			return null;
		}

		const segments = parsed.pathname
			.replace(/\.git$/, '')
			.split('/')
			.filter(Boolean);

		if (segments.length < 2) {
			log.trace('parseRepoUrl insufficient path segments', { url });
			return null;
		}

		const result = { owner: segments[0], repo: segments[1] };
		log.trace('parseRepoUrl result', { owner: result.owner, repo: result.repo });
		return result;
	} catch {
		log.trace('parseRepoUrl failed to parse URL', { url });
		return null;
	}
}

export async function getRepoInfo(owner: string, repo: string): Promise<RepoInfo> {
	log.debug('getRepoInfo called', { owner, repo });
	const cacheKey = `repo:${owner}/${repo}`;
	const cached = getCached<RepoInfo>(cacheKey);
	if (cached) {
		log.debug('getRepoInfo cache hit', { owner, repo });
		return cached;
	}

	const response = await authFetch(
		`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
	);
	const data = await response.json();

	const result = {
		isPublic: data.visibility === 'public',
		defaultBranch: data.default_branch,
		description: data.description ?? null
	};
	log.debug('getRepoInfo result', { owner, repo, isPublic: result.isPublic, defaultBranch: result.defaultBranch });
	setCache(cacheKey, result);
	return result;
}

export async function getCommits(
	owner: string,
	repo: string,
	opts?: { since?: string; until?: string; perPage?: number }
): Promise<Commit[]> {
	log.debug('getCommits called', { owner, repo, since: opts?.since, until: opts?.until, perPage: opts?.perPage });
	const cacheKey = `commits:${owner}/${repo}:${opts?.since ?? ''}:${opts?.until ?? ''}:${opts?.perPage ?? ''}`;
	const cached = getCached<Commit[]>(cacheKey);
	if (cached) {
		log.debug('getCommits cache hit', { owner, repo, commitCount: cached.length });
		return cached;
	}

	const timer = log.time('getCommits');
	const perPage = opts?.perPage ?? 100;
	const allCommits: Commit[] = [];
	let page = 1;

	while (true) {
		const params: Record<string, string> = { per_page: String(perPage), page: String(page) };
		if (opts?.since) params.since = opts.since;
		if (opts?.until) params.until = opts.until;

		const response = await authFetch(
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`,
			params
		);
		const data = (await response.json()) as Array<{
			sha: string;
			commit: {
				message: string;
				author: { name: string; date: string };
			};
			author?: { avatar_url?: string } | null;
		}>;

		log.trace('getCommits page fetched', { owner, repo, page, commitsOnPage: data.length });

		for (const c of data) {
			allCommits.push({
				sha: c.sha,
				message: c.commit.message,
				author: c.commit.author.name,
				authorAvatarUrl: c.author?.avatar_url ?? null,
				date: c.commit.author.date,
				additions: 0,
				deletions: 0,
				files: []
			});
		}

		if (data.length < perPage) break;
		page++;
	}

	log.debug('getCommits fetching commit details', { owner, repo, totalCommits: allCommits.length, pages: page });

	// Fetch stats + files in parallel (batched to avoid overwhelming the API)
	const batchSize = 15;
	const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`;
	for (let i = 0; i < allCommits.length; i += batchSize) {
		const batch = allCommits.slice(i, i + batchSize);
		log.trace('getCommits detail batch', { owner, repo, batchStart: i, batchSize: batch.length });
		await Promise.all(batch.map(async (commit) => {
			try {
				const resp = await authFetch(`${repoPath}/${commit.sha}`);
				const detail = await resp.json();
				commit.additions = detail.stats?.additions ?? 0;
				commit.deletions = detail.stats?.deletions ?? 0;
				commit.files = (detail.files ?? []).map((f: { filename: string; status: string; additions?: number; deletions?: number }) => ({
					filename: f.filename,
					status: f.status,
					additions: f.additions ?? 0,
					deletions: f.deletions ?? 0
				}));
			} catch (err) {
				log.warn('getCommits detail fetch failed', { sha: commit.sha });
			}
		}));
	}

	timer.end({ owner, repo, totalCommits: allCommits.length });
	setCache(cacheKey, allCommits);
	return allCommits;
}

export async function getReadme(owner: string, repo: string): Promise<string | null> {
	log.debug('getReadme called', { owner, repo });
	const cacheKey = `readme:${owner}/${repo}`;
	const cached = getCached<string | null>(cacheKey);
	if (cached !== undefined) {
		log.debug('getReadme cache hit', { owner, repo });
		return cached;
	}

	try {
		const response = await authFetch(
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`
		);
		const data = await response.json();

		let content: string | null;
		if (data.content && data.encoding === 'base64') {
			log.debug('getReadme success', { owner, repo });
			content = atob(data.content.replace(/\n/g, ''));
		} else {
			log.debug('getReadme success (non-base64)', { owner, repo });
			content = data.content ?? null;
		}

		setCache(cacheKey, content);
		return content;
	} catch (err) {
		log.debug('getReadme failed', { owner, repo });
		return null;
	}
}

export async function getLanguages(
	owner: string,
	repo: string
): Promise<Record<string, number>> {
	log.debug('getLanguages called', { owner, repo });
	const cacheKey = `languages:${owner}/${repo}`;
	const cached = getCached<Record<string, number>>(cacheKey);
	if (cached) {
		log.debug('getLanguages cache hit', { owner, repo });
		return cached;
	}

	const response = await authFetch(
		`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`
	);
	const languages = await response.json();
	log.debug('getLanguages result', { owner, repo, languageCount: Object.keys(languages).length });
	setCache(cacheKey, languages);
	return languages;
}
