import { db } from './db.js';
import { getRedis } from './queue/connection.js';
import { createLogger } from './logger.js';
import type { PresenceViewer } from '$lib/types.js';

const log = createLogger('presence');

/**
 * How long a tab counts as "viewing" after its last heartbeat. Clients beat
 * every 10s while visible and active (ReviewViewers.svelte), so a viewer that stops
 * beating (tab hidden, idle, crashed, offline) drops out within this window
 * even if its explicit leave signal never arrives.
 */
export const PRESENCE_TTL_MS = 30_000;

// One sorted set per review page: member = `${userId}|${tabId}`, score = last
// heartbeat (epoch ms). Tracking tabs rather than users means closing one of
// two open tabs doesn't hide a reviewer who's still looking in the other.
function presenceKey(programId: string, projectId: string) {
	return `presence:review:${programId}:${projectId}`;
}

function member(userId: string, tabId: string) {
	return `${userId}|${tabId}`;
}

/** Records a heartbeat for this tab and returns everyone currently viewing. */
export async function heartbeat(
	programId: string,
	projectId: string,
	userId: string,
	tabId: string
): Promise<PresenceViewer[]> {
	const key = presenceKey(programId, projectId);
	const now = Date.now();

	const results = await getRedis()
		.multi()
		.zremrangebyscore(key, '-inf', now - PRESENCE_TTL_MS)
		.zadd(key, now, member(userId, tabId))
		.pexpire(key, PRESENCE_TTL_MS * 2)
		.zrange(key, 0, -1)
		.exec();

	const members = (results?.[3]?.[1] as string[] | undefined) ?? [];
	const userIds = [...new Set(members.map((m) => m.slice(0, m.indexOf('|'))))];
	log.trace('heartbeat', { key, userId, viewers: userIds.length });

	const users = await db.user.findMany({
		where: { id: { in: userIds } },
		select: { id: true, name: true, avatarUrl: true }
	});
	return users.sort((a, b) => a.name.localeCompare(b.name));
}

/** Removes this tab right away (tab closed, navigated elsewhere). */
export async function leave(programId: string, projectId: string, userId: string, tabId: string) {
	log.trace('leave', { programId, projectId, userId });
	await getRedis().zrem(presenceKey(programId, projectId), member(userId, tabId));
}
