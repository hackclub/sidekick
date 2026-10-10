import { json, error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/rbac.js';
import { getRawHeartbeatRange, tzDayBounds, dateInTimezone, HackatimeRateLimitError, type RawHeartbeat } from '$lib/server/integrations/hackatime.js';
import { sumCappedGaps } from '$lib/server/integrations/hackatime-duration.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:hackatime:activity');

const WIDTH = 400;
const HEIGHT = 100;
const PADDING = 2;

// Members without canViewHeartbeats get day totals rounded to this, and no
// per-heartbeat paths — the line/cursor sparklines are the same flatline and
// linear-pattern signals fraud review looks for, so they stay restricted.
const ESTIMATE_GRANULARITY_S = 15 * 60;

type ShareField = 'language' | 'editor' | 'category';

// Each value's share of the day's coding time, to the nearest percent. Shares
// rather than seconds so they can't be summed back into an exact day total.
function timeShares(heartbeats: RawHeartbeat[], field: ShareField): Record<string, number> {
	const groups = new Map<string, RawHeartbeat[]>();
	for (const hb of heartbeats) {
		const key = hb[field] || 'Unknown';
		let group = groups.get(key);
		if (!group) groups.set(key, (group = []));
		group.push(hb);
	}

	const seconds = [...groups].map(([name, hbs]) => [name, sumCappedGaps(hbs)] as const);
	const total = seconds.reduce((sum, [, s]) => sum + s, 0);
	if (total === 0) return {};

	const shares: Record<string, number> = {};
	for (const [name, s] of seconds) {
		const share = Math.round((s / total) * 100) / 100;
		if (share > 0) shares[name] = share;
	}
	return shares;
}

type Point = { time: number; pos: number };

function createRlePath(
	points: Point[],
	scaleY: (pos: number) => number,
	scaleX: (time: number) => number
): string {
	if (points.length === 0) return '';
	const pixelsByY = new Map<number, number[]>();
	for (const p of points) {
		const qx = Math.round(scaleX(p.time));
		const qy = Math.round(scaleY(p.pos));
		if (!pixelsByY.has(qy)) pixelsByY.set(qy, []);
		pixelsByY.get(qy)!.push(qx);
	}
	const cmds: string[] = [];
	for (const [y, xs] of pixelsByY.entries()) {
		if (xs.length === 0) continue;
		const uniq = [...new Set(xs)].sort((a, b) => a - b);
		let runStart = uniq[0];
		let runEnd = uniq[0];
		for (let i = 1; i < uniq.length; i++) {
			if (uniq[i] === runEnd + 1) {
				runEnd = uniq[i];
			} else {
				cmds.push(`M${runStart},${y}h${Math.max(1, runEnd - runStart)}`);
				runStart = uniq[i];
				runEnd = uniq[i];
			}
		}
		cmds.push(`M${runStart},${y}h${Math.max(1, runEnd - runStart)}`);
	}
	return cmds.join('');
}

function generateSvgPaths(heartbeats: RawHeartbeat[]) {
	const times = heartbeats.map((hb) => hb.time * 1000);
	const minTime = Math.min(...times);
	const maxTime = Math.max(...times);
	const timeSpan = maxTime - minTime || 1;

	const cursorPoints: Point[] = [];
	const linePoints: Point[] = [];
	for (let i = 0; i < heartbeats.length; i++) {
		const t = heartbeats[i].time * 1000 - minTime;
		cursorPoints.push({ time: t, pos: heartbeats[i].cursorpos ?? 0 });
		linePoints.push({ time: t, pos: heartbeats[i].lineno ?? 0 });
	}

	const scaleX = (t: number) => PADDING + (t / timeSpan) * (WIDTH - 2 * PADDING);

	const maxCursor = Math.max(...cursorPoints.map((p) => p.pos), 1);
	const scaleYCursor = (pos: number) => PADDING + (1 - pos / maxCursor) * (HEIGHT - 2 * PADDING);

	const maxLine = Math.max(...linePoints.map((p) => p.pos), 1);
	const scaleYLine = (pos: number) => PADDING + (1 - pos / maxLine) * (HEIGHT - 2 * PADDING);

	return {
		cursorPath: createRlePath(cursorPoints, scaleYCursor, scaleX),
		lineNoPath: createRlePath(linePoints, scaleYLine, scaleX)
	};
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	const membership = await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});
	const estimate = !membership.canViewHeartbeats;

	const userId = url.searchParams.get('userId');
	const projects = url.searchParams.get('projects');
	const year = url.searchParams.get('year');
	const month = url.searchParams.get('month');
	const tz = url.searchParams.get('tz') || 'UTC';

	if (!userId || !projects || !year || !month) {
		throw error(400, 'Missing userId, projects, year, or month');
	}

	logger.debug('GET request', { userId, projects, year, month, tz, programId: params.programId });

	const y = parseInt(year);
	const m = parseInt(month);

	const firstDayStr = `${year}-${String(m).padStart(2, '0')}-01`;
	const nextMonth = m === 12 ? 1 : m + 1;
	const nextYear = m === 12 ? y + 1 : y;
	const firstDayNextMonth = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
	const { startS } = tzDayBounds(firstDayStr, tz);
	const endS = tzDayBounds(firstDayNextMonth, tz).startS - 1;

	const projectKeys = new Set(projects.split(',').map((p) => p.trim().toLowerCase()));
	let raw: RawHeartbeat[];
	try {
		({ heartbeats: raw } = await getRawHeartbeatRange(userId, startS, endS));
	} catch (e) {
		if (e instanceof HackatimeRateLimitError) {
			throw error(429, 'Hackatime is rate limiting Sidekick; wait a moment and try again');
		}
		throw e;
	}
	const filtered = raw.filter(
		(hb) =>
			projectKeys.has((hb.project ?? '').toLowerCase()) &&
			(hb.editor ?? '').toLowerCase() !== 'lapse' &&
			!(hb.user_agent ?? '').toLowerCase().includes('lapse')
	);

	if (raw.length > 0 && filtered.length === 0) {
		const sampleProjects = [...new Set(raw.slice(0, 100).map((hb) => hb.project))];
		logger.warn('No heartbeats matched project filter', { rawCount: raw.length, projects: [...projectKeys].join(','), sampleProjects: sampleProjects.join(', ') });
	} else {
		logger.debug('Heartbeat filtering', { month: `${y}-${String(m).padStart(2, '0')}`, rawCount: raw.length, filteredCount: filtered.length, projects: [...projectKeys].join(',') });
	}

	const daysInMonth = new Date(y, m, 0).getDate();
	const dayBuckets = new Map<string, RawHeartbeat[]>();
	for (let d = 1; d <= daysInMonth; d++) {
		const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
		dayBuckets.set(dateStr, []);
	}

	for (const hb of filtered) {
		const dateStr = dateInTimezone(hb.time, tz);
		const bucket = dayBuckets.get(dateStr);
		if (bucket) bucket.push(hb);
	}

	const days: {
		date: string;
		active: boolean;
		count?: number;
		totalSeconds: number;
		lineNoPath?: string;
		cursorPath?: string;
		shares?: Record<ShareField, Record<string, number>>;
	}[] = [];

	for (const [date, heartbeats] of dayBuckets) {
		const sorted = heartbeats.sort((a, b) => a.time - b.time);

		const totalSeconds = sumCappedGaps(sorted);

		if (estimate) {
			days.push({
				date,
				active: sorted.length > 0,
				totalSeconds: Math.round(totalSeconds / ESTIMATE_GRANULARITY_S) * ESTIMATE_GRANULARITY_S,
				shares:
					sorted.length > 0
						? {
								language: timeShares(sorted, 'language'),
								editor: timeShares(sorted, 'editor'),
								category: timeShares(sorted, 'category')
							}
						: undefined
			});
			continue;
		}

		const { cursorPath, lineNoPath } = sorted.length > 0
			? generateSvgPaths(sorted)
			: { cursorPath: '', lineNoPath: '' };

		days.push({ date, active: sorted.length > 0, count: sorted.length, totalSeconds, lineNoPath, cursorPath });
	}

	days.sort((a, b) => a.date.localeCompare(b.date));

	return json({ days, estimate });
};
