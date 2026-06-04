import { json, error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/rbac.js';
import { getRawHeartbeatRange, type RawHeartbeat } from '$lib/server/integrations/hackatime.js';
import type { RequestHandler } from './$types.js';

const WIDTH = 400;
const HEIGHT = 100;
const PADDING = 2;

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

const HEARTBEAT_TIMEOUT_S = 600;

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const userId = url.searchParams.get('userId');
	const projects = url.searchParams.get('projects');
	const year = url.searchParams.get('year');
	const month = url.searchParams.get('month');

	if (!userId || !projects || !year || !month) {
		throw error(400, 'Missing userId, projects, year, or month');
	}

	const y = parseInt(year);
	const m = parseInt(month);
	const startDate = new Date(Date.UTC(y, m - 1, 1));
	const endDate = new Date(Date.UTC(y, m, 0, 23, 59, 59));
	const startS = Math.floor(startDate.getTime() / 1000);
	const endS = Math.floor(endDate.getTime() / 1000);

	const projectKeys = new Set(projects.split(',').map((p) => p.trim().toLowerCase()));
	const raw = await getRawHeartbeatRange(userId, startS, endS);
	const filtered = raw.filter(
		(hb) =>
			projectKeys.has((hb.project ?? '').toLowerCase()) &&
			(hb.editor ?? '').toLowerCase() !== 'lapse' &&
			!(hb.user_agent ?? '').toLowerCase().includes('lapse')
	);

	if (raw.length > 0 && filtered.length === 0) {
		const sampleProjects = [...new Set(raw.slice(0, 100).map((hb) => hb.project))];
		console.log(`[activity] ${raw.length} raw HBs but 0 matched projects ${[...projectKeys].join(',')}. Sample projects in data: ${sampleProjects.join(', ')}`);
	} else {
		console.log(`[activity] ${y}-${String(m).padStart(2, '0')}: ${raw.length} raw → ${filtered.length} filtered for projects ${[...projectKeys].join(',')}`);
	}

	const dayBuckets = new Map<number, RawHeartbeat[]>();
	const daysInMonth = new Date(y, m, 0).getDate();
	for (let d = 1; d <= daysInMonth; d++) {
		const ts = Math.floor(Date.UTC(y, m - 1, d) / 1000);
		dayBuckets.set(ts, []);
	}

	for (const hb of filtered) {
		const dt = new Date(hb.time * 1000);
		const dayTs = Math.floor(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()) / 1000);
		const bucket = dayBuckets.get(dayTs);
		if (bucket) bucket.push(hb);
	}

	const days: {
		date: string;
		count: number;
		totalSeconds: number;
		lineNoPath: string;
		cursorPath: string;
	}[] = [];

	for (const [dayTs, heartbeats] of dayBuckets) {
		const sorted = heartbeats.sort((a, b) => a.time - b.time);
		const dt = new Date(dayTs * 1000);
		const date = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;

		let totalSeconds = 0;
		for (let i = 1; i < sorted.length; i++) {
			const gap = sorted[i].time - sorted[i - 1].time;
			if (gap <= HEARTBEAT_TIMEOUT_S) totalSeconds += gap;
		}

		const { cursorPath, lineNoPath } = sorted.length > 0
			? generateSvgPaths(sorted)
			: { cursorPath: '', lineNoPath: '' };

		days.push({ date, count: sorted.length, totalSeconds: Math.round(totalSeconds), lineNoPath, cursorPath });
	}

	days.sort((a, b) => a.date.localeCompare(b.date));

	return json({ days });
};
