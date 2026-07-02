import { json, error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient, ProtocolError } from '$lib/server/protocol/client.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';
import type { Order, RevealOrderAddressOutput } from '$lib/server/protocol/types.js';

const logger = createLogger('api:export-csv');

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

	const format: 'theseus' | 'generic' = url.searchParams.get('format') === 'generic' ? 'generic' : 'theseus';
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

	const itemMap: Record<string, { name: string; unitPrice?: number }> = {};
	try {
		const shopResult = await client.fetchShopItems({});
		for (const item of shopResult.items) itemMap[item.id] = { name: item.name, unitPrice: item.unitPrice };
	} catch { /* ignore */ }

	const itemName = itemFilter ? (itemMap[itemFilter]?.name ?? null) : null;

	if (format === 'generic') {
		const csvHeader = 'id,user_id,username,user_email,item_id,item_name,item_cost,qty,created_on,status';
		const exportOrders = allOrders.map((order) => {
			const item = itemMap[order.itemId];
			return {
				id: order.id,
				userName: order.userName,
				userEmail: order.userEmail,
				itemName: item?.name ?? order.itemId,
				quantity: order.quantity,
				status: order.status,
				row: [
					csvField(order.id),
					csvField(order.userId),
					csvField(order.userName),
					csvField(order.userEmail),
					csvField(order.itemId),
					csvField(item?.name ?? order.itemId),
					item?.unitPrice != null ? String(item.unitPrice) : '',
					String(order.quantity),
					csvField(order.createdAt),
					csvField(order.status),
				].join(',')
			};
		});

		return {
			format,
			csvHeader,
			orders: exportOrders,
			skippedOrders: [],
			totalOrders: allOrders.length,
			programName: program.name,
			itemName
		};
	}

	const csvHeader = 'First Name,Last Name,Line 1,Line 2,City,State / Province,Zip / Postal Code,Country,Email';
	const skippedOrders: { id: string; userName: string }[] = [];

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

	return {
		format,
		csvHeader,
		orders: exportOrders,
		skippedOrders,
		totalOrders: allOrders.length,
		programName: program.name,
		itemName
	};
}

export const POST: RequestHandler = async ({ params, locals, url }) => {
	logger.info('POST CSV export', { programId: params.programId, format: url.searchParams.get('format'), status: url.searchParams.get('status'), item: url.searchParams.get('item') });
	const result = await loadExportData(params, locals, url);
	logger.info('CSV export completed', { programId: params.programId, totalOrders: result.totalOrders, exported: result.orders.length, skipped: result.skippedOrders.length });
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
