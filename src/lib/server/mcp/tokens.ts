import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { createLogger } from '../logger.js';
import type { User } from '@prisma/client';

const log = createLogger('mcp:tokens');

const TOKEN_PREFIX = 'sk_mcp_';
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_LIVE_TOKENS = 5;
// lastUsedAt is for the owner's eyes ("used 3 minutes ago"), so writing it on
// every tool call would only add a query to each one.
const LAST_USED_RESOLUTION_MS = 60 * 1000;

/**
 * The page a reviewer's local snapshot client screenshots: the review page's
 * Hackatime section alone, so their agent can show it exactly as Sidekick
 * does.
 */
export const HACKATIME_EXPORT_ROUTE = '/program/[programId]/review/[projectId]/hackatime';

/**
 * Route ids a token may authenticate outside /mcp, and only for GET: the
 * export page and the read-only Hackatime APIs its viewer fetches. The client
 * runs headless with no session cookie, so these are all it needs; every
 * other page, form action and API still requires a session. The token already
 * reads the same heartbeats through get_hackatime_day, so this grants nothing
 * the MCP doesn't.
 */
export const TOKEN_GET_ROUTES: ReadonlySet<string> = new Set([
	HACKATIME_EXPORT_ROUTE,
	'/api/programs/[programId]/hackatime/activity',
	'/api/programs/[programId]/hackatime/date-range',
	'/api/programs/[programId]/hackatime/heartbeats'
]);

function digest(raw: string): string {
	return createHash('sha256').update(raw).digest('hex');
}

/** Mints a token for `userId`. The raw token is only ever in this return value. */
export async function mintMcpToken(userId: string, name: string) {
	const live = await db.mcpToken.count({
		where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }
	});
	if (live >= MAX_LIVE_TOKENS) {
		throw new Error(`You already have ${MAX_LIVE_TOKENS} live tokens; revoke one first.`);
	}

	const raw = `${TOKEN_PREFIX}${randomBytes(30).toString('base64url')}`;
	const token = await db.mcpToken.create({
		data: {
			userId,
			name: name.trim().slice(0, 60) || 'Agent',
			tokenHash: digest(raw),
			hint: raw.slice(-4),
			expiresAt: new Date(Date.now() + TOKEN_TTL_MS)
		}
	});
	log.info('mcp token minted', { userId, tokenId: token.id });
	return { raw, token };
}

export async function revokeMcpToken(userId: string, tokenId: string): Promise<boolean> {
	const res = await db.mcpToken.updateMany({
		where: { id: tokenId, userId, revokedAt: null },
		data: { revokedAt: new Date() }
	});
	log.info('mcp token revoked', { userId, tokenId, revoked: res.count });
	return res.count > 0;
}

/**
 * Resolves an `Authorization: Bearer …` header to the token's owner, or null
 * when the header is missing, malformed, unknown, revoked or expired. Callers
 * answer every null the same way, so a refusal says nothing about why.
 */
export async function authenticateMcpToken(
	header: string | null
): Promise<{ user: User; tokenId: string } | null> {
	const match = header?.match(/^Bearer\s+(\S+)$/i);
	if (!match || !match[1].startsWith(TOKEN_PREFIX)) return null;

	const token = await db.mcpToken.findUnique({
		where: { tokenHash: digest(match[1]) },
		include: { user: true }
	});
	if (!token || token.revokedAt || token.expiresAt < new Date()) return null;

	if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
		db.mcpToken
			.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
			.catch((e) => log.warn('mcp token lastUsedAt update failed', { error: String(e) }));
	}

	return { user: token.user, tokenId: token.id };
}
