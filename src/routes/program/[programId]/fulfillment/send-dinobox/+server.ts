import { json, error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/rbac.js';
import { sendSlackFile } from '$lib/server/integrations/slack.js';
import type { RequestHandler } from './$types.js';

const DINOBOX_USER_ID = 'U01LUQ7H2N9';

export const POST: RequestHandler = async ({ params, locals, request }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Not authenticated');

	const membership = await requirePermission(user.id, params.programId, 'canViewFulfillments', {
		isSuperAdmin: user.isSuperAdmin
	});

	if (!membership.canViewAddressData) {
		throw error(403, 'You do not have permission to view address data.');
	}

	const { csv, filename, itemName, programName } = await request.json();

	const itemLabel = itemName ? `*${itemName}*` : '*all items*';
	const userMention = user.slackId ? `<@${user.slackId}>` : user.email;
	const message = `CSV export for ${itemLabel} of program *${programName}* from ${userMention}`;

	await sendSlackFile(DINOBOX_USER_ID, csv, filename, message);

	return json({ success: true });
};
