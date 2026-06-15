import { redirect, error } from '@sveltejs/kit';
import { exchangeCodeForTokens, fetchHcaUserInfo, createSession } from '$lib/server/auth.js';
import { getSlackUserProfile } from '$lib/server/integrations/slack.js';
import { db } from '$lib/server/db.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const log = createLogger('auth:callback');

export const GET: RequestHandler = async ({ url, cookies }) => {
	log.info('oauth callback started');

	const code = url.searchParams.get('code');
	if (!code) {
		throw error(400, 'Missing authorization code');
	}

	const tTokens = log.time('token exchange');
	const tokens = await exchangeCodeForTokens(code);
	tTokens.end();

	const tUser = log.time('fetch user info');
	const hcaUser = await fetchHcaUserInfo(tokens.access_token);
	tUser.end({ hcaId: hcaUser.id, email: hcaUser.email });

	let avatarUrl = hcaUser.profilePictureUrl;
	let displayName = hcaUser.name || hcaUser.email;

	if (hcaUser.slackId) {
		const slackProfile = await getSlackUserProfile(hcaUser.slackId);
		if (slackProfile) {
			displayName = slackProfile.name;
			if (!avatarUrl) avatarUrl = slackProfile.avatarUrl;
		}
	}

	const user = await db.user.upsert({
		where: { hcaId: hcaUser.id },
		update: {
			email: hcaUser.email,
			name: displayName,
			avatarUrl,
			slackId: hcaUser.slackId
		},
		create: {
			hcaId: hcaUser.id,
			email: hcaUser.email,
			name: displayName,
			avatarUrl,
			slackId: hcaUser.slackId
		}
	});
	log.info('user upserted', { userId: user.id, hcaId: hcaUser.id });

	// Claim any pending invites for this user's email
	const pendingInvites = await db.pendingInvite.findMany({
		where: { email: { equals: hcaUser.email, mode: 'insensitive' } }
	});
	if (pendingInvites.length > 0) {
		log.info('claiming pending invites', { count: pendingInvites.length, email: hcaUser.email });
	}
	for (const invite of pendingInvites) {
		const existing = await db.programMembership.findUnique({
			where: { userId_programId: { userId: user.id, programId: invite.programId } }
		});
		if (!existing) {
			await db.programMembership.create({
				data: {
					userId: user.id,
					programId: invite.programId,
					invitedById: invite.invitedById,
					canViewReviews: true
				}
			});
		}
	}
	if (pendingInvites.length > 0) {
		await db.pendingInvite.deleteMany({
			where: { id: { in: pendingInvites.map((i) => i.id) } }
		});
	}

	await createSession(cookies, user.id, tokens.access_token, tokens.refresh_token, tokens.expires_in);
	log.info('session created, redirecting', { userId: user.id });

	throw redirect(302, '/');
};
