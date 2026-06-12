import { env } from '$env/dynamic/private';
import { db } from '../db.js';
import { encrypt, decrypt } from '../crypto.js';

const HCB_BASE = 'https://hcb.hackclub.com';

export interface HcbTokens {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	token_type: string;
	scope: string;
}

export interface HcbOrganization {
	id: string;
	name: string;
	slug: string;
	icon: string | null;
	country: string;
	transparent: boolean;
}

export interface CardGrantParams {
	amount_cents: number;
	email: string;
	purpose?: string;
	one_time_use?: boolean;
	pre_authorization_required?: boolean;
	instructions?: string;
	merchant_lock?: string;
	category_lock?: string;
	keyword_lock?: string;
	expiration_at?: string;
}

export interface CardGrantResult {
	id: string;
	object: string;
	amount_cents: number;
	balance_cents: number;
	email: string;
	purpose: string | null;
	status: string;
	one_time_use: boolean;
	pre_authorization_required: boolean;
	card_id: string | null;
	created_at: string;
}

export function getHcbAuthorizationUrl(state: string): string {
	const params = new URLSearchParams({
		client_id: env.HCB_CLIENT_ID!,
		redirect_uri: env.HCB_REDIRECT_URI!,
		response_type: 'code',
		scope: 'card_grants:write',
		state
	});
	return `${HCB_BASE}/api/v4/oauth/authorize?${params}`;
}

export async function exchangeHcbCode(code: string): Promise<HcbTokens> {
	const res = await fetch(`${HCB_BASE}/api/v4/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			grant_type: 'authorization_code',
			client_id: env.HCB_CLIENT_ID,
			client_secret: env.HCB_CLIENT_SECRET,
			redirect_uri: env.HCB_REDIRECT_URI,
			code
		})
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`HCB token exchange failed: ${res.status} ${text}`);
	}

	return res.json();
}

export async function refreshHcbToken(refreshToken: string): Promise<HcbTokens> {
	const res = await fetch(`${HCB_BASE}/api/v4/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			grant_type: 'refresh_token',
			client_id: env.HCB_CLIENT_ID,
			client_secret: env.HCB_CLIENT_SECRET,
			refresh_token: refreshToken
		})
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`HCB token refresh failed: ${res.status} ${text}`);
	}

	return res.json();
}

export async function getHcbUserOrganizations(accessToken: string): Promise<HcbOrganization[]> {
	const res = await fetch(`${HCB_BASE}/api/v4/user/organizations`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});

	if (!res.ok) {
		throw new Error(`HCB organizations fetch failed: ${res.status}`);
	}

	return res.json();
}

export async function createCardGrant(
	accessToken: string,
	orgId: string,
	params: CardGrantParams
): Promise<CardGrantResult> {
	const res = await fetch(`${HCB_BASE}/api/v4/organizations/${encodeURIComponent(orgId)}/card_grants`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(params)
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`HCB card grant creation failed: ${res.status} ${text}`);
	}

	return res.json();
}

export async function listOrgCardGrants(accessToken: string, orgId: string): Promise<CardGrantResult[]> {
	const res = await fetch(`${HCB_BASE}/api/v4/organizations/${encodeURIComponent(orgId)}/card_grants?expand=balance_cents`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});

	if (!res.ok) {
		throw new Error(`HCB card grants list failed: ${res.status}`);
	}

	return res.json();
}

export async function topUpCardGrant(
	accessToken: string,
	grantId: string,
	amountCents: number
): Promise<CardGrantResult> {
	const res = await fetch(`${HCB_BASE}/api/v4/card_grants/${encodeURIComponent(grantId)}/topup`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ amount_cents: amountCents })
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`HCB card grant top-up failed: ${res.status} ${text}`);
	}

	return res.json();
}

export interface HcbTransferResult {
	id: string;
	object: string;
	status: string;
	amount_cents: number;
	from: { id: string; name: string; slug: string };
	to: { id: string; name: string; slug: string };
	sender: { id: string; name: string };
}

export async function createHcbTransfer(
	accessToken: string,
	sourceOrgSlug: string,
	toOrganizationId: string,
	amountCents: number,
	name: string
): Promise<HcbTransferResult> {
	const res = await fetch(`${HCB_BASE}/api/v4/organizations/${encodeURIComponent(sourceOrgSlug)}/transfers`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			to_organization_id: toOrganizationId,
			amount_cents: amountCents,
			name
		})
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`HCB transfer failed: ${res.status} ${text}`);
	}

	return res.json();
}

export async function getValidHcbToken(userId: string): Promise<string | null> {
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { hcbAccessToken: true, hcbRefreshToken: true, hcbTokenExpiresAt: true }
	});

	if (!user?.hcbAccessToken || !user.hcbRefreshToken) {
		return null;
	}

	const accessToken = decrypt(user.hcbAccessToken);
	const refreshToken = decrypt(user.hcbRefreshToken);

	// Return current token if still valid (with 5-minute buffer)
	if (user.hcbTokenExpiresAt && user.hcbTokenExpiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
		return accessToken;
	}

	// Refresh the token
	const tokens = await refreshHcbToken(refreshToken);
	await db.user.update({
		where: { id: userId },
		data: {
			hcbAccessToken: encrypt(tokens.access_token),
			hcbRefreshToken: encrypt(tokens.refresh_token),
			hcbTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000)
		}
	});

	return tokens.access_token;
}
