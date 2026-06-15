import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { searchUsers } from '$lib/server/integrations/hackatime.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:members:search');

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'isRoot', {
		isSuperAdmin: user.isSuperAdmin
	});

	const query = url.searchParams.get('q')?.trim();
	if (!query || query.length < 2) {
		return json({ results: [] });
	}

	logger.debug('GET member search', { programId: params.programId, query });

	// Search local DB first
	const localUsers = await db.user.findMany({
		where: {
			OR: [
				{ name: { contains: query, mode: 'insensitive' } },
				{ email: { contains: query, mode: 'insensitive' } },
				{ slackId: { contains: query, mode: 'insensitive' } }
			]
		},
		select: { id: true, name: true, email: true, avatarUrl: true, slackId: true },
		take: 10
	});

	// Also search Hackatime
	const hackatimeUsers = await searchUsers(query).catch(() => []);

	// Match Hackatime results to local users
	const localByEmail = new Map(localUsers.map((u) => [u.email.toLowerCase(), u]));
	const localBySlack = new Map(
		localUsers.filter((u) => u.slackId).map((u) => [u.slackId!, u])
	);
	const seenIds = new Set(localUsers.map((u) => u.id));

	// Check existing memberships and pending invites
	const [existingMemberships, pendingInvites] = await Promise.all([
		db.programMembership.findMany({
			where: { programId: params.programId },
			select: { userId: true }
		}),
		db.pendingInvite.findMany({
			where: { programId: params.programId },
			select: { email: true }
		})
	]);
	const memberUserIds = new Set(existingMemberships.map((m) => m.userId));
	const invitedEmails = new Set(pendingInvites.map((i) => i.email.toLowerCase()));

	interface SearchResult {
		userId: string | null;
		name: string;
		email: string;
		avatarUrl: string | null;
		slackId: string | null;
		hackatimeId: number | null;
		source: 'local' | 'hackatime';
		isMember: boolean;
		isInvited: boolean;
	}

	const results: SearchResult[] = localUsers.map((u) => ({
		userId: u.id,
		name: u.name,
		email: u.email,
		avatarUrl: u.avatarUrl,
		slackId: u.slackId,
		hackatimeId: null,
		source: 'local' as const,
		isMember: memberUserIds.has(u.id),
		isInvited: invitedEmails.has(u.email.toLowerCase())
	}));

	for (const hu of hackatimeUsers) {
		const matchByEmail = hu.email ? localByEmail.get(hu.email.toLowerCase()) : null;
		const matchBySlack = hu.slackUsername ? localBySlack.get(hu.slackUsername) : null;
		const match = matchByEmail || matchBySlack;
		if (match && seenIds.has(match.id)) continue;
		if (match) {
			seenIds.add(match.id);
			results.push({
				userId: match.id,
				name: match.name,
				email: match.email,
				avatarUrl: match.avatarUrl,
				slackId: match.slackId,
				hackatimeId: hu.id,
				source: 'hackatime',
				isMember: memberUserIds.has(match.id),
				isInvited: invitedEmails.has(match.email.toLowerCase())
			});
		} else {
			results.push({
				userId: null,
				name: hu.username || hu.slackUsername || hu.email,
				email: hu.email,
				avatarUrl: hu.slackAvatarUrl || hu.githubAvatarUrl,
				slackId: null,
				hackatimeId: hu.id,
				source: 'hackatime',
				isMember: false,
				isInvited: hu.email ? invitedEmails.has(hu.email.toLowerCase()) : false
			});
		}
	}

	logger.debug('Member search results', { programId: params.programId, query, count: results.length });
	return json({ results: results.slice(0, 15) });
};
