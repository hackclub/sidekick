import { redirect, error } from '@sveltejs/kit';
import { exchangeCodeForTokens, fetchHcaUserInfo, createSession } from '$lib/server/auth.js';
import { getSlackUserProfile } from '$lib/server/integrations/slack.js';
import { db } from '$lib/server/db.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get('code');
	if (!code) {
		throw error(400, 'Missing authorization code');
	}

	const tokens = await exchangeCodeForTokens(code);
	const hcaUser = await fetchHcaUserInfo(tokens.access_token);

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

	// Claim any pending invites for this user's email
	const pendingInvites = await db.pendingInvite.findMany({
		where: { email: { equals: hcaUser.email, mode: 'insensitive' } }
	});
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

	throw redirect(302, '/');
};
