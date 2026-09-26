import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { getUserPrograms } from '$lib/server/rbac.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:pin');

// Pinning replaces any previously pinned program: a user pins at most one.
export const PUT: RequestHandler = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	const programs = await getUserPrograms(user.id, user.isSuperAdmin);
	if (!programs.some((p) => p.id === params.programId)) {
		throw error(403, 'You do not have access to this program.');
	}

	logger.info('pin program', { userId: user.id, programId: params.programId });
	await db.user.update({ where: { id: user.id }, data: { pinnedProgramId: params.programId } });
	return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const user = locals.user;
	if (!user) throw error(401);

	logger.info('unpin program', { userId: user.id, programId: params.programId });
	await db.user.updateMany({
		where: { id: user.id, pinnedProgramId: params.programId },
		data: { pinnedProgramId: null }
	});
	return new Response(null, { status: 204 });
};
