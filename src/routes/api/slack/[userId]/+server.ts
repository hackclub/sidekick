import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { getSlackUserProfile } from '$lib/server/integrations/slack.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user)
		throw error(401, 'Not authenticated');

	let slackId: string | null = null;

	if (params.userId.startsWith('U')) {
		slackId = params.userId;
	}
	else {
		const user = await db.user.findFirst({
			where: { hcaId: params.userId },
			select: { slackId: true }
		});
		slackId = user?.slackId ?? null;
	}

	if (!slackId)
		return json({ slackId: null, deleted: false });

	const profile = await getSlackUserProfile(slackId);
	return json({ slackId, deleted: profile?.deleted ?? false });
};
