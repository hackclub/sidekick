import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient } from '$lib/server/protocol/client.js';
import { createLogger } from '$lib/server/logger.js';
import type { ShopItem } from '$lib/server/protocol/types.js';
import type { PageServerLoad, Actions } from './$types.js';

const logger = createLogger('page:manage');

export const load: PageServerLoad = async ({ params, parent }) => {
	const { user } = await parent();
	if (!user) throw error(401, 'Not authenticated');

	logger.debug('Loading manage page', { programId: params.programId });

	// Require canUpdateProgram or isRoot
	let membership;
	try {
		membership = await requirePermission(user.id, params.programId, 'canUpdateProgram', {
			isSuperAdmin: user.isSuperAdmin
		});
	} catch {
		// Fall back to isRoot check
		membership = await requirePermission(user.id, params.programId, 'isRoot', {
			isSuperAdmin: user.isSuperAdmin
		});
	}

	const program = await db.program.findUnique({
		where: { id: params.programId }
	});

	if (!program) throw error(404, 'Program not found');

	const memberships = await db.programMembership.findMany({
		where: { programId: params.programId },
		include: {
			user: {
				select: {
					id: true,
					name: true,
					email: true,
					avatarUrl: true
				}
			},
			program: false
		},
		orderBy: { joinedAt: 'asc' }
	});

	// Look up inviter names for display
	const inviterIds = memberships
		.map((m: { invitedById: string | null }) => m.invitedById)
		.filter((id: string | null): id is string => id !== null);
	const pendingInvites = await db.pendingInvite.findMany({
		where: { programId: params.programId },
		orderBy: { createdAt: 'asc' }
	});

	// Resolve inviter names for pending invites
	const pendingInviterIds = pendingInvites
		.map((i) => i.invitedById)
		.filter((id): id is string => id !== null);
	const allInviterIds = [...new Set([...inviterIds, ...pendingInviterIds])];
	const allInviters = allInviterIds.length > 0
		? await db.user.findMany({
				where: { id: { in: allInviterIds } },
				select: { id: true, name: true }
			})
		: [];
	const allInviterMap: Record<string, string> = Object.fromEntries(
		allInviters.map((u: { id: string; name: string }) => [u.id, u.name])
	);

	// Load shop items from protocol + card grant templates
	let shopItems: ShopItem[] = [];
	try {
		const client = new ProtocolClient(program.masterEndpoint, program.secretKey);
		const result = await client.fetchShopItems({});
		shopItems = result.items;
	} catch {
		// Protocol may not support shop items — that's fine
	}

	const cardGrantTemplates = await db.cardGrantTemplate.findMany({
		where: { programId: params.programId }
	});

	const warehouseTemplates = await db.warehouseTemplate.findMany({
		where: { programId: params.programId }
	});

	const hcbUser = await db.user.findUnique({
		where: { id: user.id },
		select: { hcbTokenExpiresAt: true }
	});
	const userHasHcbAuth = !!hcbUser?.hcbTokenExpiresAt;

	const auditLogs = await db.auditLog.findMany({
		where: { programId: params.programId },
		include: {
			user: {
				select: {
					id: true,
					name: true,
					avatarUrl: true
				}
			}
		},
		orderBy: { createdAt: 'desc' },
		take: 50
	});

	logger.debug('Manage page loaded', {
		programId: params.programId,
		memberCount: memberships.length,
		pendingInviteCount: pendingInvites.length,
		shopItemCount: shopItems.length,
		auditLogCount: auditLogs.length
	});

	return {
		program: {
			id: program.id,
			name: program.name,
			yswsName: program.yswsName ?? '',
			iconUrl: program.iconUrl,
			description: program.description,
			masterEndpoint: program.masterEndpoint,
			secretKey: program.secretKey,
			hcbOrganizationId: program.hcbOrganizationId,
			hcbOrganizationName: program.hcbOrganizationName,
			hcbOrganizationSlug: program.hcbOrganizationSlug
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		memberships: memberships.map((m: any) => ({
			id: m.id,
			userId: m.userId,
			userName: m.user.name,
			userEmail: m.user.email,
			userAvatarUrl: m.user.avatarUrl,
			invitedByName: m.invitedById ? (allInviterMap[m.invitedById] ?? 'Unknown') : null,
			joinedAt: m.joinedAt.toISOString(),
			lastAccess: m.lastAccess?.toISOString() ?? null,
			canViewReviews: m.canViewReviews,
			canCreateReviews: m.canCreateReviews,
			canAuthorizeReviews: m.canAuthorizeReviews,
			canViewFulfillments: m.canViewFulfillments,
			canViewAddressData: m.canViewAddressData,
			canUpdateFulfillments: m.canUpdateFulfillments,
			canUpdateProgram: m.canUpdateProgram,
			isRoot: m.isRoot
		})),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		auditLogs: auditLogs.map((log: any) => ({
			id: log.id,
			action: log.action,
			entityType: log.entityType,
			entityId: log.entityId,
			metadata: log.metadata,
			createdAt: log.createdAt.toISOString(),
			actor: {
				id: log.user.id,
				name: log.user.name,
				avatarUrl: log.user.avatarUrl
			}
		})),
		pendingInvites: pendingInvites.map((i) => ({
			id: i.id,
			email: i.email,
			name: i.name,
			avatarUrl: i.avatarUrl,
			invitedByName: allInviterMap[i.invitedById] ?? 'Unknown',
			createdAt: i.createdAt.toISOString()
		})),
		currentMembership: {
			canUpdateProgram: membership.canUpdateProgram,
			isRoot: membership.isRoot
		},
		shopItems: shopItems.map((item) => ({
			id: item.id,
			name: item.name,
			description: item.description ?? null,
			thumbnailUrl: item.thumbnailUrl ?? null,
			unitPrice: item.unitPrice ?? null
		})),
		cardGrantTemplates: cardGrantTemplates.map((t) => ({
			id: t.id,
			shopItemId: t.shopItemId,
			amountCents: t.amountCents,
			purpose: t.purpose,
			oneTimeUse: t.oneTimeUse,
			preAuthorizationRequired: t.preAuthorizationRequired,
			instructions: t.instructions,
			merchantLock: t.merchantLock,
			categoryLock: t.categoryLock,
			keywordLock: t.keywordLock,
			expirationDays: t.expirationDays
		})),
		warehouseTemplates: warehouseTemplates.map((t: typeof warehouseTemplates[number]) => ({
			id: t.id,
			shopItemId: t.shopItemId,
			tags: t.tags,
			userFacingTitle: t.userFacingTitle,
			metadata: t.metadata,
			contents: t.contents as Array<{ sku: string; quantity: number }>
		})),
		hasTheseusApiKey: !!program.theseusApiKey,
		theseusUser: program.theseusApiKey ? {
			name: program.theseusUserName ?? '',
			email: program.theseusUserEmail ?? ''
		} : null,
		userHasHcbAuth
	};
};

export const actions: Actions = {
	updateProgram: async ({ request, params, locals }) => {
		const user = locals.user;
		if (!user) throw error(401);

		await requirePermission(user.id, params.programId, 'canUpdateProgram', {
			isSuperAdmin: user.isSuperAdmin
		});

		const formData = await request.formData();
		const yswsName = (formData.get('yswsName') as string)?.trim() || null;

		logger.info('updateProgram action', { programId: params.programId, yswsName });

		await db.program.update({
			where: { id: params.programId },
			data: { yswsName }
		});

		return { success: true };
	},

	updateApiConfig: async ({ request, params, locals }) => {
		const user = locals.user;
		if (!user)
			throw error(401);

		await requirePermission(user.id, params.programId, 'canUpdateProgram', {
			isSuperAdmin: user.isSuperAdmin
		});

		const formData = await request.formData();
		const masterEndpoint = (formData.get('masterEndpoint') as string)?.trim();
		const secretKey = (formData.get('secretKey') as string)?.trim();

		if (!masterEndpoint || !secretKey) {
			throw error(400, 'Master endpoint and secret key are required');
		}

		logger.info('updateApiConfig action', { programId: params.programId, masterEndpoint });

		await db.program.update({
			where: { id: params.programId },
			data: { masterEndpoint, secretKey }
		});

		return { success: true };
	},

	updateIcon: async ({ request, params, locals }) => {
		const user = locals.user;
		if (!user) throw error(401);

		await requirePermission(user.id, params.programId, 'canUpdateProgram', {
			isSuperAdmin: user.isSuperAdmin
		});

		const formData = await request.formData();
		const iconDataUrl = formData.get('iconDataUrl') as string;
		if (!iconDataUrl || !iconDataUrl.startsWith('data:image/')) {
			throw error(400, 'Invalid image data');
		}

		// Limit to ~500KB data URL
		if (iconDataUrl.length > 500_000) {
			throw error(400, 'Image too large');
		}

		logger.info('updateIcon action', { programId: params.programId, iconSize: iconDataUrl.length });

		await db.program.update({
			where: { id: params.programId },
			data: { iconUrl: iconDataUrl }
		});

		return { success: true };
	},

	togglePermission: async ({ request, params, locals }) => {
		const user = locals.user;
		if (!user) throw error(401);

		await requirePermission(user.id, params.programId, 'isRoot', {
			isSuperAdmin: user.isSuperAdmin
		});

		const formData = await request.formData();
		const membershipId = formData.get('membershipId') as string;
		const permission = formData.get('permission') as string;

		logger.info('togglePermission action', { programId: params.programId, membershipId, permission });

		const validPermissions = [
			'canViewReviews', 'canCreateReviews', 'canAuthorizeReviews',
			'canViewFulfillments', 'canViewAddressData', 'canUpdateFulfillments',
			'canUpdateProgram', 'isRoot'
		];
		if (!validPermissions.includes(permission)) throw error(400, 'Invalid permission');

		const membership = await db.programMembership.findUnique({
			where: { id: membershipId }
		});
		if (!membership || membership.programId !== params.programId) {
			throw error(404, 'Membership not found');
		}

		const currentValue = membership[permission as keyof typeof membership] as boolean;
		await db.programMembership.update({
			where: { id: membershipId },
			data: { [permission]: !currentValue }
		});

		return { success: true };
	},

	removeMember: async ({ request, params, locals }) => {
		const user = locals.user;
		if (!user) throw error(401);

		await requirePermission(user.id, params.programId, 'isRoot', {
			isSuperAdmin: user.isSuperAdmin
		});

		const formData = await request.formData();
		const membershipId = formData.get('membershipId') as string;

		logger.info('removeMember action', { programId: params.programId, membershipId });

		const membership = await db.programMembership.findUnique({
			where: { id: membershipId }
		});
		if (!membership || membership.programId !== params.programId) {
			throw error(404, 'Membership not found');
		}

		// Prevent removing yourself
		if (membership.userId === user.id) {
			throw error(400, 'Cannot remove yourself');
		}

		await db.programMembership.delete({
			where: { id: membershipId }
		});

		await db.auditLog.create({
			data: {
				programId: params.programId,
				userId: user.id,
				action: 'member_remove',
				entityType: 'membership',
				entityId: membershipId
			}
		});

		return { success: true };
	},

	addMember: async ({ request, params, locals }) => {
		const user = locals.user;
		if (!user) throw error(401);

		await requirePermission(user.id, params.programId, 'isRoot', {
			isSuperAdmin: user.isSuperAdmin
		});

		const formData = await request.formData();
		const userId = formData.get('userId') as string | null;
		const email = formData.get('email') as string | null;
		const name = formData.get('name') as string | null;
		const avatarUrl = formData.get('avatarUrl') as string | null;

		logger.info('addMember action', { programId: params.programId, userId, email });

		if (!userId && !email) throw error(400, 'userId or email is required');

		// Local user — add directly
		if (userId) {
			const targetUser = await db.user.findUnique({ where: { id: userId } });
			if (!targetUser) throw error(404, 'User not found');

			const existing = await db.programMembership.findUnique({
				where: { userId_programId: { userId, programId: params.programId } }
			});
			if (existing) throw error(409, 'User is already a member');

			await db.programMembership.create({
				data: {
					userId,
					programId: params.programId,
					invitedById: user.id,
					canViewReviews: true
				}
			});

			await db.auditLog.create({
				data: {
					programId: params.programId,
					userId: user.id,
					action: 'member_add',
					entityType: 'user',
					entityId: userId
				}
			});

			return { success: true };
		}

		// Hackatime-only user — check if they already have an account by email
		const existingUser = await db.user.findFirst({ where: { email: email! } });
		if (existingUser) {
			const existing = await db.programMembership.findUnique({
				where: { userId_programId: { userId: existingUser.id, programId: params.programId } }
			});
			if (existing) throw error(409, 'User is already a member');

			await db.programMembership.create({
				data: {
					userId: existingUser.id,
					programId: params.programId,
					invitedById: user.id,
					canViewReviews: true
				}
			});

			await db.auditLog.create({
				data: {
					programId: params.programId,
					userId: user.id,
					action: 'member_add',
					entityType: 'user',
					entityId: existingUser.id
				}
			});

			return { success: true };
		}

		// No local account — create a pending invite
		await db.pendingInvite.upsert({
			where: {
				programId_email: { programId: params.programId, email: email! }
			},
			create: {
				programId: params.programId,
				email: email!,
				name: name || email!,
				avatarUrl: avatarUrl || null,
				invitedById: user.id
			},
			update: {
				name: name || email!,
				avatarUrl: avatarUrl || null,
				invitedById: user.id
			}
		});

		await db.auditLog.create({
			data: {
				programId: params.programId,
				userId: user.id,
				action: 'member_invite',
				entityType: 'pending_invite',
				entityId: email!
			}
		});

		return { success: true };
	},

	cancelInvite: async ({ request, params, locals }) => {
		const user = locals.user;
		if (!user) throw error(401);

		await requirePermission(user.id, params.programId, 'isRoot', {
			isSuperAdmin: user.isSuperAdmin
		});

		const formData = await request.formData();
		const inviteId = formData.get('inviteId') as string;

		logger.info('cancelInvite action', { programId: params.programId, inviteId });

		const invite = await db.pendingInvite.findUnique({ where: { id: inviteId } });
		if (!invite || invite.programId !== params.programId) {
			throw error(404, 'Invite not found');
		}

		await db.pendingInvite.delete({ where: { id: inviteId } });

		await db.auditLog.create({
			data: {
				programId: params.programId,
				userId: user.id,
				action: 'member_cancel_invite',
				entityType: 'pending_invite',
				entityId: invite.email
			}
		});

		return { success: true };
	}
};
