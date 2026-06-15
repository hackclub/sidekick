import { env } from '$env/dynamic/private';

const THESEUS_BASE = env.THESEUS_API_URL || 'https://mail.hackclub.com';

export interface WarehouseAddress {
	first_name: string;
	last_name: string;
	line_1: string;
	line_2?: string;
	city: string;
	state?: string;
	postal_code: string;
	country: string;
}

export interface WarehouseContentItem {
	sku: string;
	quantity: number;
}

export interface CreateWarehouseOrderParams {
	warehouse_order: {
		recipient_email: string;
		tags: string[];
		user_facing_title?: string;
		idempotency_key?: string;
		metadata?: Record<string, unknown>;
	};
	address: WarehouseAddress;
	contents: WarehouseContentItem[];
}

export interface WarehouseOrderResult {
	id: string;
	status: string;
	recipient_email: string;
	tracking_number: string | null;
	contents_cost: number | null;
	labor_cost: number | null;
	postage_cost: number | null;
}

export interface TheseusUser {
	id: string;
	name: string;
	email: string;
	avatar: string | null;
	admin: boolean;
}

export async function getTheseusUser(apiKey: string): Promise<TheseusUser> {
	const res = await fetch(`${THESEUS_BASE}/api/v1/user`, {
		headers: { Authorization: `Bearer ${apiKey}` }
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Theseus auth failed: ${res.status} ${text}`);
	}

	return res.json();
}

export async function createWarehouseOrder(
	apiKey: string,
	params: CreateWarehouseOrderParams
): Promise<WarehouseOrderResult> {
	const res = await fetch(`${THESEUS_BASE}/api/v1/warehouse_orders`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(params)
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Warehouse order creation failed: ${res.status} ${text}`);
	}

	const data = await res.json();
	return data.warehouse_order;
}
