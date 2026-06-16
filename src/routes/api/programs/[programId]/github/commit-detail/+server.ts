import { json, error } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/rbac.js';
import { getCommitDetail } from '$lib/server/integrations/github.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const log = createLogger('api:github');

export const GET: RequestHandler = async ({ url, params, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	const owner = url.searchParams.get('owner');
	const repo = url.searchParams.get('repo');
	const sha = url.searchParams.get('sha');

	if (!owner || !repo || !sha) {
		throw error(400, 'Missing owner, repo, or sha parameter');
	}

	log.debug('GET commit detail', { owner, repo, sha: sha.slice(0, 7) });

	try {
		const detail = await getCommitDetail(owner, repo, sha);
		return json(detail, {
			headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }
		});
	} catch (e) {
		log.error('commit detail fetch failed', e, { owner, repo, sha: sha.slice(0, 7) });
		throw error(502, 'Failed to fetch commit details from GitHub');
	}
};
