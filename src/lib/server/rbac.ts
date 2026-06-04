import { error } from '@sveltejs/kit';
import { db } from './db.js';
import type { ProgramMembership } from '@prisma/client';

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
	return db.programMembership.findUnique({
		where: { userId_programId: { userId, programId } }
	});
}

export function trackAccess(userId: string, programId: string) {
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
	trackAccess(userId, programId);

	if (opts?.isSuperAdmin) {
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
		throw error(403, 'You do not have access to this program.');
	}

	if (!membership[permission]) {
		throw error(403, `Missing permission: ${permission}`);
	}

	return membership;
}

export async function getUserPrograms(userId: string, isSuperAdmin: boolean) {
	if (isSuperAdmin) {
		return db.program.findMany({
			where: { isActive: true },
			orderBy: { name: 'asc' }
		});
	}

	const memberships = await db.programMembership.findMany({
		where: { userId },
		include: { program: true }
	});

	return memberships.filter((m) => m.program.isActive).map((m) => m.program);
}
