import { error } from '@sveltejs/kit';
import { db } from './db.js';
import { createLogger } from './logger.js';
import type { ProgramMembership } from '@prisma/client';

const log = createLogger('rbac');

export type Permission = keyof Pick<
	ProgramMembership,
	| 'canViewReviews'
	| 'canCreateReviews'
	| 'canAuthorizeReviews'
	| 'canViewFulfillments'
	| 'canViewAddressData'
	| 'canUpdateFulfillments'
	| 'canUpdateProgram'
	| 'isRoot'
>;

export async function getMembership(userId: string, programId: string) {
	log.trace('looking up membership', { userId, programId });
	const membership = await db.programMembership.findUnique({
		where: { userId_programId: { userId, programId } }
	});
	log.trace('membership lookup result', {
		userId,
		programId,
		found: !!membership
	});
	return membership;
}

export function trackAccess(userId: string, programId: string) {
	log.trace('tracking access', { userId, programId });
	db.programMembership.updateMany({
		where: { userId, programId },
		data: { lastAccess: new Date() }
	}).catch(() => {});
}

export async function requirePermission(
	userId: string,
	programId: string,
	permission: Permission,
	opts?: { isSuperAdmin?: boolean }
): Promise<ProgramMembership> {
	log.debug('checking permission', { userId, programId, permission, isSuperAdmin: !!opts?.isSuperAdmin });
	trackAccess(userId, programId);

	if (opts?.isSuperAdmin) {
		log.info('super admin bypass', { userId, programId, permission });
		const membership = await getMembership(userId, programId);
		if (membership) return membership;
		return {
			id: 'super-admin',
			userId,
			programId,
			invitedById: null,
			joinedAt: new Date(),
			lastAccess: new Date(),
			canViewReviews: true,
			canCreateReviews: true,
			canAuthorizeReviews: true,
			canViewFulfillments: true,
			canViewAddressData: true,
			canUpdateFulfillments: true,
			canUpdateProgram: true,
			isRoot: true
		};
	}

	const membership = await getMembership(userId, programId);
	if (!membership) {
		log.warn('permission denied: no membership', { userId, programId, permission });
		throw error(403, 'You do not have access to this program.');
	}

	if (!membership[permission]) {
		log.warn('permission denied: missing permission', { userId, programId, permission });
		throw error(403, `Missing permission: ${permission}`);
	}

	log.debug('permission granted', { userId, programId, permission });
	return membership;
}

export async function getUserPrograms(userId: string, isSuperAdmin: boolean) {
	log.debug('getUserPrograms', { userId, isSuperAdmin });

	if (isSuperAdmin) {
		const [programs, memberships] = await Promise.all([
			db.program.findMany({
				where: { isActive: true },
				orderBy: { name: 'asc' }
			}),
			db.programMembership.findMany({
				where: { userId },
				select: { programId: true }
			})
		]);

		const memberProgramIds = new Set(memberships.map((m) => m.programId));
		const annotated = programs
			.map((p) => ({ ...p, isMember: memberProgramIds.has(p.id) }))
			.sort((a, b) => Number(b.isMember) - Number(a.isMember));
		log.debug('getUserPrograms result (super admin)', { userId, count: annotated.length, memberCount: memberProgramIds.size });
		return annotated;
	}

	const memberships = await db.programMembership.findMany({
		where: { userId },
		include: { program: true }
	});

	const programs = memberships.filter((m) => m.program.isActive).map((m) => ({ ...m.program, isMember: true }));
	log.debug('getUserPrograms result', { userId, membershipCount: memberships.length, activeCount: programs.length });
	return programs;
}
