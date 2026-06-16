import { json, error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/rbac.js';
import { getRawHeartbeatRange, tzDayBounds } from '$lib/server/integrations/hackatime.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:hackatime:heartbeats');

interface CachedHeartbeats {
	heartbeats: ReturnType<typeof transformHeartbeats>;
}

const cache = new Map<string, CachedHeartbeats>();

function transformHeartbeats(raw: Awaited<ReturnType<typeof getRawHeartbeatRange>>, projectKeys: Set<string>) {
	return raw
		.filter((hb) => projectKeys.has((hb.project ?? '').toLowerCase()))
		.sort((a, b) => a.time - b.time)
		.map((hb) => ({
			time: hb.time * 1000,
			lineno: hb.lineno ?? 0,
			cursorpos: hb.cursorpos ?? 0,
			is_write: hb.is_write ?? false,
			project: hb.project ?? '',
			language: hb.language ?? '',
			entity: hb.entity ?? '',
			branch: hb.branch ?? '',
			category: hb.category ?? '',
			editor: hb.editor ?? '',
			machine: hb.machine ?? '',
			user_agent: hb.user_agent ?? '',
			ip: hb.ip_address ?? '',
			lines: hb.lines ?? 0,
			source_type: hb.source_type ?? 0
		}));
}

function isCacheable(date: string, tz: string): boolean {
	const now = new Date();
	const today = now.toLocaleDateString('sv-SE', { timeZone: tz });
	const yesterday = new Date(now.getTime() - 86400000).toLocaleDateString('sv-SE', { timeZone: tz });
	return date !== today && date !== yesterday;
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const userId = url.searchParams.get('userId');
	const projects = url.searchParams.get('projects');
	const date = url.searchParams.get('date');
	const tz = url.searchParams.get('tz') || 'UTC';

	if (!userId || !projects || !date) {
		throw error(400, 'Missing userId, projects, or date');
	}

	logger.debug('GET request', { userId, projects, date, tz, programId: params.programId });

	const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!dateMatch) throw error(400, 'Invalid date format, expected YYYY-MM-DD');

	const projectKeys = new Set(projects.split(',').map((p) => p.trim().toLowerCase()));
	const cacheKey = `${userId}:${[...projectKeys].sort().join(',')}:${date}:${tz}`;

	const cached = cache.get(cacheKey);
	if (cached) {
		logger.trace('Cache hit', { cacheKey });
		return json(cached);
	}
	logger.trace('Cache miss', { cacheKey });

	const { startS, endS } = tzDayBounds(date, tz);

	const raw = await getRawHeartbeatRange(userId, startS, endS);
	const heartbeats = transformHeartbeats(raw, projectKeys);

	const result = { heartbeats };
	logger.debug('Fetched heartbeats', { date, tz, heartbeatCount: heartbeats.length, cached: isCacheable(date, tz) });

	if (isCacheable(date, tz)) {
		cache.set(cacheKey, result);
	}

	return json(result);
};
