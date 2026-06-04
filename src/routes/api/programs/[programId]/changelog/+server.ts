import { error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/rbac.js';
import { generateChangelogStream } from '$lib/server/integrations/groq-changelog.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canCreateReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const body = await request.json();
	const { repoUrl, sinceDate, untilDate } = body as {
		repoUrl: string;
		sinceDate: string;
		untilDate?: string;
	};

	if (!repoUrl || !sinceDate) {
		throw error(400, 'repoUrl and sinceDate are required');
	}

	const stream = await generateChangelogStream(repoUrl, sinceDate, untilDate);

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
