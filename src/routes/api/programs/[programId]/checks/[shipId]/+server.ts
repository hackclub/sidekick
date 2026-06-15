import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { getCheckById } from '$lib/server/checks/registry.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:checks');

export const GET: RequestHandler = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	await requirePermission(user.id, params.programId, 'canViewReviews', {
		isSuperAdmin: user.isSuperAdmin
	});

	logger.debug('GET checks', { shipId: params.shipId, programId: params.programId });

	const results = await db.checkResult.findMany({
		where: { programId: params.programId, shipId: params.shipId },
		orderBy: { ranAt: 'desc' }
	});

	const allCompleted = results.length > 0 && results.every((r) => r.status !== 'pending');

	logger.debug('Check results', { shipId: params.shipId, checkCount: results.length, allCompleted });

	return json({
		checks: results.map((c) => {
			const def = getCheckById(c.checkId);
			return {
				id: c.checkId,
				name: def?.description ?? c.checkId,
				status: c.status as 'pending' | 'completed' | 'failed',
				passed: c.passed,
				summary: c.summary,
				severity: c.severity
			};
		}),
		allCompleted
	});
};
