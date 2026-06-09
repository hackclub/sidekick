import { env } from '$env/dynamic/private';

const BASE_URL = 'https://hackatime.hackclub.com';

interface ProjectDetail {
	name: string;
	totalSeconds: number;
	languages: Record<string, number>;
}

interface TrustFactor {
	trustLevel: string;
	trustValue: number;
}

interface Heartbeat {
	id: string;
	entity: string;
	type: string;
	category: string;
	project: string;
	branch: string;
	language: string;
	is_write: boolean;
	editor: string;
	operating_system: string;
	machine: string;
	user_agent: string;
	time: number;
	created_at: string;
}

interface SummaryResult {
	projects: Array<{ name: string; total_seconds: number }>;
	languages: Array<{ name: string; total_seconds: number }>;
	editors: Array<{ name: string; total_seconds: number }>;
	grand_total: { total_seconds: number; text: string };
}

async function authFetch(path: string, params?: Record<string, string>): Promise<Response> {
	const token = env.HACKATIME_ADMIN_TOKEN;
	if (!token) {
		throw new Error('HACKATIME_ADMIN_TOKEN is not set');
	}

	const url = new URL(path, BASE_URL);
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			url.searchParams.set(key, value);
		}
	}

	const response = await fetch(url.toString(), {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/json'
		}
	});

	if (!response.ok) {
		throw new Error(`Hackatime API error: ${response.status} ${response.statusText}`);
	}

	return response;
}

export async function getProjectDateRange(
	userId: string,
	projectKeys: string[]
): Promise<{ firstDate: string; lastDate: string } | null> {
	const response = await authFetch('/api/admin/v1/user/projects', { id: userId });
	const data = await response.json();
	const keySet = new Set(projectKeys.map((k) => k.toLowerCase()));

	interface AdminProject {
		name: string;
		first_heartbeat: number;
		last_heartbeat: number;
	}

	const matched = (data.projects ?? []).filter(
		(p: AdminProject) => keySet.has(p.name.toLowerCase())
	);
	if (matched.length === 0) return null;

	let earliest = Infinity;
	let latest = 0;
	for (const p of matched) {
		if (p.first_heartbeat && p.first_heartbeat < earliest) earliest = p.first_heartbeat;
		if (p.last_heartbeat && p.last_heartbeat > latest) latest = p.last_heartbeat;
	}
	if (earliest === Infinity || latest === 0) return null;

	const fd = new Date(earliest * 1000);
	const ld = new Date(latest * 1000);
	return {
		firstDate: `${fd.getUTCFullYear()}-${String(fd.getUTCMonth() + 1).padStart(2, '0')}-${String(fd.getUTCDate()).padStart(2, '0')}`,
		lastDate: `${ld.getUTCFullYear()}-${String(ld.getUTCMonth() + 1).padStart(2, '0')}-${String(ld.getUTCDate()).padStart(2, '0')}`
	};
}

export async function getProjectDetails(
	username: string,
	projectKeys: string[],
	start?: string,
	end?: string
): Promise<{ projects: ProjectDetail[] }> {
	const params: Record<string, string> = {
		project: projectKeys.join(',')
	};
	if (start) params.start = start;
	if (end) params.end = end;

	const response = await authFetch(
		`/api/v1/users/${encodeURIComponent(username)}/projects/details`,
		params
	);
	const data = await response.json();

	const allProjects: ProjectDetail[] = (data.projects ?? []).map(
		(p: { name: string; total_seconds: number; languages: Record<string, number> }) => ({
			name: p.name,
			totalSeconds: p.total_seconds,
			languages: p.languages
		})
	);

	// The API may return all projects regardless of filter — filter client-side
	const keySet = new Set(projectKeys.map((k) => k.toLowerCase()));
	const projects = allProjects.filter((p) => keySet.has(p.name.toLowerCase()));

	return { projects };
}

export async function getUserTrustFactor(
	userId: string
): Promise<TrustFactor> {
	const response = await authFetch('/api/admin/v1/user/info', { id: userId });
	const data = await response.json();

	return {
		trustLevel: data.user.trust_level,
		trustValue: 0
	};
}

export async function getHeartbeatsByUserAgent(
	userId: string,
	segment: string,
	startDate: string,
	endDate: string
): Promise<Heartbeat[]> {
	const response = await authFetch('/api/admin/v1/heartbeats/by_user_agent_segment', {
		user_id: userId,
		segment,
		start_date: startDate,
		end_date: endDate
	});
	const data = await response.json();

	return data.heartbeats ?? [];
}

export async function getUserHeartbeats(
	userId: string,
	date: string
): Promise<Heartbeat[]> {
	const response = await authFetch('/api/admin/v1/user/heartbeats', {
		user_id: userId,
		date
	});
	const data = await response.json();

	return data.heartbeats ?? [];
}

export interface RawHeartbeat {
	time: number;
	lineno: number;
	cursorpos: number;
	is_write: boolean;
	project: string;
	language: string;
	entity: string;
	branch: string;
	category: string;
	editor: string;
	machine: string;
	user_agent: string;
	ip_address: string;
	lines: number;
	source_type: number | string;
}

export async function getRawHeartbeatRange(
	userId: string,
	startTimestampS: number,
	endTimestampS: number
): Promise<RawHeartbeat[]> {
	const BATCH_SIZE = 5000;
	const MAX_FETCH = 100000;
	let all: RawHeartbeat[] = [];
	let offset = 0;
	let hasMore = true;

	while (hasMore && all.length < MAX_FETCH) {
		const response = await authFetch('/api/admin/v1/user/heartbeats', {
			id: userId,
			start_date: String(startTimestampS),
			end_date: String(endTimestampS),
			limit: String(BATCH_SIZE),
			offset: String(offset)
		});
		const data = await response.json();
		const batch: RawHeartbeat[] = data.heartbeats ?? [];
		all = all.concat(batch);
		hasMore = data.has_more ?? false;
		offset += BATCH_SIZE;
	}

	return all;
}

export interface HeartbeatLapseTimelapse {
	id: string;
	name: string;
	heartbeatCount: number;
	firstSeen: number;
	lastSeen: number;
	project: string;
}

export async function getLapseTimelapsesFromHeartbeats(
	userId: string,
	projectKeys: string[]
): Promise<HeartbeatLapseTimelapse[]> {
	let range;
	try {
		range = await getProjectDateRange(userId, projectKeys);
	} catch {
		return [];
	}
	if (!range) return [];

	const startS = Math.floor(new Date(range.firstDate + 'T00:00:00Z').getTime() / 1000);
	const endS = Math.floor(new Date(range.lastDate + 'T23:59:59Z').getTime() / 1000);

	let all: RawHeartbeat[];
	try {
		all = await getRawHeartbeatRange(userId, startS, endS);
	} catch {
		return [];
	}
	const keySet = new Set(projectKeys.map((k) => k.toLowerCase()));
	const lapseHbs = all.filter(
		(hb) =>
			(hb.editor?.toLowerCase() === 'lapse' || hb.user_agent?.toLowerCase().includes('lapse')) &&
			keySet.has((hb.project ?? '').toLowerCase())
	);

	const groups = new Map<string, RawHeartbeat[]>();
	for (const hb of lapseHbs) {
		const entity = hb.entity ?? '';
		if (!groups.has(entity)) groups.set(entity, []);
		groups.get(entity)!.push(hb);
	}

	const result: HeartbeatLapseTimelapse[] = [];
	for (const [entity, hbs] of groups) {
		const idMatch = entity.match(/\(([^)]+)\)\s*$/);
		const id = idMatch?.[1] ?? entity;
		const name = idMatch ? entity.slice(0, entity.lastIndexOf('(')).trimEnd() : entity;

		const times = hbs.map((hb) => hb.time);
		result.push({
			id,
			name,
			heartbeatCount: hbs.length,
			firstSeen: Math.min(...times),
			lastSeen: Math.max(...times),
			project: hbs[0].project
		});
	}

	return result.sort((a, b) => b.lastSeen - a.lastSeen);
}

export interface HackatimeSearchUser {
	id: number;
	username: string | null;
	slackUsername: string | null;
	githubUsername: string | null;
	slackAvatarUrl: string | null;
	githubAvatarUrl: string | null;
	email: string;
}

export async function searchUsers(query: string): Promise<HackatimeSearchUser[]> {
	const token = env.HACKATIME_ADMIN_TOKEN;
	if (!token) throw new Error('HACKATIME_ADMIN_TOKEN is not set');

	const url = new URL('/api/admin/v1/user/search_fuzzy', BASE_URL);
	const response = await fetch(url.toString(), {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: JSON.stringify({ query }),
		signal: AbortSignal.timeout(5000)
	});

	if (!response.ok) return [];
	const data = await response.json();

	return (data.users ?? []).map((u: Record<string, unknown>) => ({
		id: u.id,
		username: u.username ?? null,
		slackUsername: u.slack_username ?? null,
		githubUsername: u.github_username ?? null,
		slackAvatarUrl: u.slack_avatar_url ?? null,
		githubAvatarUrl: u.github_avatar_url ?? null,
		email: u.email ?? ''
	}));
}

export async function getSummary(
	userId: string,
	start: string,
	end: string,
	project?: string
): Promise<SummaryResult> {
	const params: Record<string, string> = {
		user_id: userId,
		start,
		end
	};
	if (project) params.project = project;

	const response = await authFetch('/api/summary', params);
	const data = await response.json();

	return {
		projects: data.projects ?? [],
		languages: data.languages ?? [],
		editors: data.editors ?? [],
		grand_total: data.grand_total ?? { total_seconds: 0, text: '0 secs' }
	};
}
