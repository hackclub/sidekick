import { env } from '$env/dynamic/private';
import { createLogger } from '../logger.js';
import { isQuirkHeartbeat } from '$lib/heartbeat-quirks.js';

const log = createLogger('hackatime');
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

	log.trace('authFetch request', { path, params: params ? Object.keys(params).join(',') : undefined });
	const timer = log.time(`authFetch ${path}`);

	const response = await fetch(url.toString(), {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/json'
		}
	});

	timer.end({ status: response.status });

	if (!response.ok) {
		log.error('authFetch failed', undefined, { path, status: response.status, statusText: response.statusText });
		throw new Error(`Hackatime API error: ${response.status} ${response.statusText}`);
	}

	return response;
}

export async function getProjectDateRange(
	userId: string,
	projectKeys: string[]
): Promise<{ firstDate: string; lastDate: string } | null> {
	log.debug('getProjectDateRange called', { userId, projectKeys: projectKeys.join(',') });
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
	if (matched.length === 0) {
		log.debug('getProjectDateRange no matching projects', { userId });
		return null;
	}

	let earliest = Infinity;
	let latest = 0;
	for (const p of matched) {
		if (p.first_heartbeat && p.first_heartbeat < earliest) earliest = p.first_heartbeat;
		if (p.last_heartbeat && p.last_heartbeat > latest) latest = p.last_heartbeat;
	}
	if (earliest === Infinity || latest === 0) {
		log.debug('getProjectDateRange no valid timestamps', { userId, matchedCount: matched.length });
		return null;
	}

	const fd = new Date(earliest * 1000);
	const ld = new Date(latest * 1000);
	const result = {
		firstDate: `${fd.getUTCFullYear()}-${String(fd.getUTCMonth() + 1).padStart(2, '0')}-${String(fd.getUTCDate()).padStart(2, '0')}`,
		lastDate: `${ld.getUTCFullYear()}-${String(ld.getUTCMonth() + 1).padStart(2, '0')}-${String(ld.getUTCDate()).padStart(2, '0')}`
	};
	log.debug('getProjectDateRange result', { userId, matchedCount: matched.length, firstDate: result.firstDate, lastDate: result.lastDate });
	return result;
}

export async function getProjectDetails(
	username: string,
	projectKeys: string[],
	start?: string,
	end?: string
): Promise<{ projects: ProjectDetail[] }> {
	log.debug('getProjectDetails called', { username, projectKeys: projectKeys.join(','), start, end });
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

	log.debug('getProjectDetails result', { username, projectCount: projects.length });
	return { projects };
}

export async function getUserTrustFactor(
	userId: string
): Promise<TrustFactor> {
	log.debug('getUserTrustFactor called', { userId });
	const response = await authFetch('/api/admin/v1/user/info', { id: userId });
	const data = await response.json();

	const result = {
		trustLevel: data.user.trust_level,
		trustValue: 0
	};
	log.debug('getUserTrustFactor result', { userId, trustLevel: result.trustLevel });
	return result;
}

export async function getHeartbeatsByUserAgent(
	userId: string,
	segment: string,
	startDate: string,
	endDate: string
): Promise<Heartbeat[]> {
	log.debug('getHeartbeatsByUserAgent called', { userId, segment, startDate, endDate });
	const response = await authFetch('/api/admin/v1/heartbeats/by_user_agent_segment', {
		user_id: userId,
		segment,
		start_date: startDate,
		end_date: endDate
	});
	const data = await response.json();

	const heartbeats = data.heartbeats ?? [];
	log.debug('getHeartbeatsByUserAgent result', { userId, heartbeatCount: heartbeats.length });
	return heartbeats;
}

export async function getUserHeartbeats(
	userId: string,
	date: string
): Promise<Heartbeat[]> {
	log.debug('getUserHeartbeats called', { userId, date });
	const response = await authFetch('/api/admin/v1/user/heartbeats', {
		user_id: userId,
		date
	});
	const data = await response.json();

	const heartbeats = data.heartbeats ?? [];
	log.debug('getUserHeartbeats result', { userId, count: heartbeats.length });
	return heartbeats;
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

const HEARTBEAT_TIMEOUT_S = 120;

function durationFromHeartbeats(heartbeats: RawHeartbeat[]): number {
	if (heartbeats.length === 0) return 0;
	const sorted = [...heartbeats].sort((a, b) => a.time - b.time);
	let total = 0;
	for (let i = 1; i < sorted.length; i++) {
		const gap = sorted[i].time - sorted[i - 1].time;
		if (gap <= HEARTBEAT_TIMEOUT_S) total += gap;
	}
	return Math.round(total);
}

export async function getHeartbeatMetrics(
	userId: string,
	projectKeys: string[]
): Promise<{ aiSeconds: number; quirkSeconds: number }> {
	log.debug('getHeartbeatMetrics called', { userId, projectKeys: projectKeys.join(',') });
	const range = await getProjectDateRange(userId, projectKeys);
	if (!range) {
		log.debug('getHeartbeatMetrics no date range found', { userId });
		return { aiSeconds: 0, quirkSeconds: 0 };
	}

	const startS = Math.floor(new Date(range.firstDate + 'T00:00:00Z').getTime() / 1000);
	const endS = Math.floor(new Date(range.lastDate + 'T23:59:59Z').getTime() / 1000);
	const all = await getRawHeartbeatRange(userId, startS, endS);

	const keySet = new Set(projectKeys.map((k) => k.toLowerCase()));
	const projectHeartbeats = all.filter(
		(hb) => keySet.has((hb.project ?? '').toLowerCase())
	);

	const aiHeartbeats = projectHeartbeats.filter(
		(hb) => (hb.category ?? '').toLowerCase() === 'ai coding'
	);
	const aiSeconds = durationFromHeartbeats(aiHeartbeats);

	const nonQuirkHeartbeats = projectHeartbeats.filter(
		(hb) => !isQuirkHeartbeat({
			lines: hb.lines ?? 0,
			cursorpos: hb.cursorpos ?? 0,
			lineno: hb.lineno ?? 0,
			user_agent: hb.user_agent ?? ''
		})
	);
	const quirkSeconds = durationFromHeartbeats(projectHeartbeats) - durationFromHeartbeats(nonQuirkHeartbeats);

	log.debug('getHeartbeatMetrics result', {
		userId,
		totalHeartbeats: projectHeartbeats.length,
		aiSeconds,
		quirkHeartbeats: projectHeartbeats.length - nonQuirkHeartbeats.length,
		quirkSeconds
	});
	return { aiSeconds, quirkSeconds };
}

export async function getRawHeartbeatRange(
	userId: string,
	startTimestampS: number,
	endTimestampS: number
): Promise<RawHeartbeat[]> {
	log.debug('getRawHeartbeatRange called', { userId, startTimestampS, endTimestampS });
	const timer = log.time('getRawHeartbeatRange');
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
		log.trace('getRawHeartbeatRange batch', { userId, batchSize: batch.length, totalAccumulated: all.length, hasMore });
	}

	timer.end({ userId, totalHeartbeats: all.length });
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
	log.debug('getLapseTimelapsesFromHeartbeats called', { userId, projectKeys: projectKeys.join(',') });
	let range;
	try {
		range = await getProjectDateRange(userId, projectKeys);
	} catch (err) {
		log.error('getLapseTimelapsesFromHeartbeats failed to get date range', err, { userId });
		return [];
	}
	if (!range) return [];

	const startS = Math.floor(new Date(range.firstDate + 'T00:00:00Z').getTime() / 1000);
	const endS = Math.floor(new Date(range.lastDate + 'T23:59:59Z').getTime() / 1000);

	let all: RawHeartbeat[];
	try {
		all = await getRawHeartbeatRange(userId, startS, endS);
	} catch (err) {
		log.error('getLapseTimelapsesFromHeartbeats failed to get heartbeats', err, { userId });
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

	log.debug('getLapseTimelapsesFromHeartbeats result', { userId, timelapseCount: result.length });
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
	log.debug('searchUsers called', { query });
	const token = env.HACKATIME_ADMIN_TOKEN;
	if (!token) throw new Error('HACKATIME_ADMIN_TOKEN is not set');

	const url = new URL('/api/admin/v1/user/search_fuzzy', BASE_URL);
	const timer = log.time('searchUsers');
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

	if (!response.ok) {
		timer.end({ status: response.status });
		log.warn('searchUsers API returned non-ok', { query, status: response.status });
		return [];
	}
	const data = await response.json();

	const users = (data.users ?? []).map((u: Record<string, unknown>) => ({
		id: u.id,
		username: u.username ?? null,
		slackUsername: u.slack_username ?? null,
		githubUsername: u.github_username ?? null,
		slackAvatarUrl: u.slack_avatar_url ?? null,
		githubAvatarUrl: u.github_avatar_url ?? null,
		email: u.email ?? ''
	}));
	timer.end({ resultCount: users.length });
	log.debug('searchUsers result', { query, resultCount: users.length });
	return users;
}

export async function getSummary(
	userId: string,
	start: string,
	end: string,
	project?: string
): Promise<SummaryResult> {
	log.debug('getSummary called', { userId, start, end, project });
	const params: Record<string, string> = {
		user_id: userId,
		start,
		end
	};
	if (project) params.project = project;

	const response = await authFetch('/api/summary', params);
	const data = await response.json();

	const result = {
		projects: data.projects ?? [],
		languages: data.languages ?? [],
		editors: data.editors ?? [],
		grand_total: data.grand_total ?? { total_seconds: 0, text: '0 secs' }
	};
	log.debug('getSummary result', { userId, projectCount: result.projects.length, grandTotalSeconds: result.grand_total.total_seconds });
	return result;
}
