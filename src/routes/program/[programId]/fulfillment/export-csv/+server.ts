import { json, error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient, ProtocolError } from '$lib/server/protocol/client.js';
import type { RequestHandler } from './$types.js';
import type { Order, RevealOrderAddressOutput } from '$lib/server/protocol/types.js';

async function loadExportData(params: { programId: string }, locals: App.Locals, url: URL) {
	const user = locals.user;
	if (!user) throw redirect(302, '/auth/login');

	const membership = await requirePermission(user.id, params.programId, 'canViewFulfillments', {
		isSuperAdmin: user.isSuperAdmin
	});

	if (!membership.canViewAddressData) {
		throw error(403, 'You do not have permission to view address data.');
	}

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});

	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);

	const statusFilter = (url.searchParams.get('status') as 'pending' | 'fulfilled' | 'cancelled' | 'all') || 'pending';
	const itemFilter = url.searchParams.get('item') || undefined;
	const searchUser = url.searchParams.get('search') || undefined;
	const sortBy = (url.searchParams.get('sort') as 'id' | 'user' | 'item' | 'quantity' | 'date' | 'status') || 'date';
	const sortOrder = (url.searchParams.get('sortOrder') as 'asc' | 'desc') || 'asc';

	const allOrders: Order[] = [];
	let cursor: string | undefined;
	do {
		const result = await client.fetchOrders({
			status: statusFilter,
			filterItemId: itemFilter,
			searchUser,
			cursor,
			limit: 50,
			sortBy,
			sortOrder
		});
		allOrders.push(...result.orders);
		cursor = result.nextCursor;
	} while (cursor);

	const csvHeader = 'First Name,Last Name,Line 1,Line 2,City,State / Province,Zip / Postal Code,Country,Email';
	const skippedOrders: { id: string; userName: string }[] = [];

	let itemNameMap: Record<string, string> = {};
	try {
		const shopResult = await client.fetchShopItems({});
		for (const item of shopResult.items) itemNameMap[item.id] = item.name;
	} catch { /* ignore */ }

	const exportOrders: { id: string; firstName: string; lastName: string; city: string; stateProvince: string; country: string; row: string }[] = [];

	for (const order of allOrders) {
		let address: RevealOrderAddressOutput | null = null;
		try {
			address = await client.revealOrderAddress({ orderId: order.id });
		} catch (e) {
			if (!(e instanceof ProtocolError)) throw e;
		}

		if (!address?.line1?.trim()) {
			skippedOrders.push({ id: order.id, userName: order.userName });
			continue;
		}

		const firstName = address.firstName?.trim() ?? '';
		const lastName = address.lastName?.trim() ?? '';
		const city = address.city?.trim() ?? '';
		const stateProvince = address.stateProvince?.trim() ?? '';
		const country = address.country?.trim() ?? '';

		exportOrders.push({
			id: order.id,
			firstName,
			lastName,
			city,
			stateProvince,
			country,
			row: [
				csvField(address.firstName),
				csvField(address.lastName),
				csvField(address.line1),
				csvField(isDuplicate(address.line1, address.line2) ? '' : address.line2),
				csvField(address.city),
				csvField(address.stateProvince),
				csvField(address.postalCode),
				csvField(address.country),
				csvField(order.userEmail),
			].join(',')
		});
	}

	const itemName = itemFilter ? (itemNameMap[itemFilter] ?? null) : null;

	return {
		csvHeader,
		orders: exportOrders,
		skippedOrders,
		totalOrders: allOrders.length,
		programName: program.name,
		itemName
	};
}

export const POST: RequestHandler = async ({ params, locals, url }) => {
	const result = await loadExportData(params, locals, url);
	return json(result);
};

function normalize(value: string | undefined | null): string {
	return (value ?? '').toLowerCase().replace(/[\s,]+/g, '');
}

function isDuplicate(line1: string | undefined | null, line2: string | undefined | null): boolean {
	if (!line1 || !line2) return false;
	return normalize(line1) === normalize(line2);
}

function csvField(value: string | undefined | null): string {
	if (!value) return '';
	const cleaned = value.replace(/[\r\n]+/g, ' ').replace(/ {2,}/g, ' ').trim();
	if (cleaned.includes(',') || cleaned.includes('"')) {
		return '"' + cleaned.replace(/"/g, '""') + '"';
	}
	return cleaned;
}
