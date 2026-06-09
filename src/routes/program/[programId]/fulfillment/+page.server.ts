import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient } from '$lib/server/protocol/client.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, parent, url }) => {
	const { user } = await parent();
	if (!user) throw redirect(302, '/auth/login');

	const membership = await requirePermission(user.id, params.programId, 'canViewFulfillments', {
		isSuperAdmin: user.isSuperAdmin
	});

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});

	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);

	const statusFilter = (url.searchParams.get('status') as 'pending' | 'fulfilled' | 'cancelled' | 'all') || 'pending';
	const searchUser = url.searchParams.get('search') || undefined;
	const cursor = url.searchParams.get('cursor') || undefined;
	const sortBy = (url.searchParams.get('sort') as 'id' | 'user' | 'item' | 'quantity' | 'date' | 'status') || 'date';
	const sortOrder = (url.searchParams.get('sortOrder') as 'asc' | 'desc') || 'asc';

	const result = await client.fetchOrders({
		status: statusFilter,
		searchUser,
		cursor,
		limit: 50,
		sortBy,
		sortOrder
	});

	// Load card grant templates for this program
	const templates = await db.cardGrantTemplate.findMany({
		where: { programId: params.programId }
	});
	const cardGrantTemplates: Record<string, {
		shopItemId: string;
		amountCents: number;
		purpose: string | null;
		oneTimeUse: boolean;
	}> = {};
	for (const t of templates) {
		cardGrantTemplates[t.shopItemId] = {
			shopItemId: t.shopItemId,
			amountCents: t.amountCents,
			purpose: t.purpose,
			oneTimeUse: t.oneTimeUse
		};
	}

	return {
		orders: result.orders,
		items: result.items,
		nextCursor: result.nextCursor ?? null,
		totalCount: result.totalCount,
		statusFilter,
		sortBy,
		sortOrder,
		searchUser: searchUser ?? '',
		canUpdateFulfillments: membership.canUpdateFulfillments,
		canViewAddressData: membership.canViewAddressData,
		cardGrantTemplates,
		hcbOrganization: program.hcbOrganizationId ? {
			id: program.hcbOrganizationId,
			name: program.hcbOrganizationName ?? ''
		} : null
	};
};
