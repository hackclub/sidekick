import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { getSlackUserProfile } from '$lib/server/integrations/slack.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:slack');

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user)
		throw error(401, 'Not authenticated');

	logger.debug('GET Slack profile', { userId: params.userId });

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

	if (!slackId) {
		logger.debug('No Slack ID found', { userId: params.userId });
		return json({ slackId: null, deleted: false });
	}

	const profile = await getSlackUserProfile(slackId);
	logger.debug('Slack profile fetched', { userId: params.userId, slackId, deleted: profile?.deleted ?? false });
	return json({ slackId, deleted: profile?.deleted ?? false });
};
