import { env } from '$env/dynamic/private';

const BASE_URL = 'https://api.github.com';

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

	const url = new URL(path, BASE_URL);
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			url.searchParams.set(key, value);
		}
	}

	const headers: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28'
	};

	if (token) {
		headers['Authorization'] = `Bearer ${token}`;
	}

	let response = await fetch(url.toString(), { headers });

	// Some public repos return 403 with a fine-grained PAT that doesn't explicitly
	// cover them. Fall back to unauthenticated for those cases.
	if (response.status === 403 && token) {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { Authorization: _auth, ...unauthHeaders } = headers;
		response = await fetch(url.toString(), { headers: unauthHeaders });
	}

	if (!response.ok) {
		throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
	}

	return response;
}

export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== 'github.com') {
			return null;
		}

		const segments = parsed.pathname
			.replace(/\.git$/, '')
			.split('/')
			.filter(Boolean);

		if (segments.length < 2) {
			return null;
		}

		return { owner: segments[0], repo: segments[1] };
	} catch {
		return null;
	}
}

export async function getRepoInfo(owner: string, repo: string): Promise<RepoInfo> {
	const response = await authFetch(
		`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
	);
	const data = await response.json();

	return {
		isPublic: data.visibility === 'public',
		defaultBranch: data.default_branch,
		description: data.description ?? null
	};
}

export async function getCommits(
	owner: string,
	repo: string,
	opts?: { since?: string; until?: string; perPage?: number }
): Promise<Commit[]> {
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

	// Fetch stats + files in parallel (batched to avoid overwhelming the API)
	const batchSize = 15;
	const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`;
	for (let i = 0; i < allCommits.length; i += batchSize) {
		const batch = allCommits.slice(i, i + batchSize);
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
			} catch {
				// Detail unavailable
			}
		}));
	}

	return allCommits;
}

export async function getReadme(owner: string, repo: string): Promise<string | null> {
	try {
		const response = await authFetch(
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`
		);
		const data = await response.json();

		if (data.content && data.encoding === 'base64') {
			return atob(data.content.replace(/\n/g, ''));
		}

		return data.content ?? null;
	} catch {
		return null;
	}
}

export async function getLanguages(
	owner: string,
	repo: string
): Promise<Record<string, number>> {
	const response = await authFetch(
		`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`
	);
	return response.json();
}
