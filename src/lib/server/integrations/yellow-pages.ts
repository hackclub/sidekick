import yaml from 'js-yaml';

const MERCHANTS_URL =
	'https://raw.githubusercontent.com/hackclub/yellow_pages/main/lib/yellow_pages/merchants.yaml';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export interface Merchant {
	name: string;
	networkIds: string[];
}

let cache: { merchants: Merchant[]; fetchedAt: number } | null = null;

export async function getMerchants(): Promise<Merchant[]> {
	if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
		return cache.merchants;
	}

	const res = await fetch(MERCHANTS_URL, { signal: AbortSignal.timeout(10000) });
	if (!res.ok) {
		if (cache) return cache.merchants;
		throw new Error(`Failed to fetch merchants: ${res.status}`);
	}

	const text = await res.text();
	const raw = yaml.load(text) as Array<{ name?: string; network_ids: string[] }>;

	const merchants: Merchant[] = raw
		.filter((m) => m.name && m.network_ids?.length)
		.map((m) => ({
			name: m.name!,
			networkIds: m.network_ids.map(String)
		}))
		.sort((a, b) => a.name.localeCompare(b.name));

	cache = { merchants, fetchedAt: Date.now() };
	return merchants;
}

export async function searchMerchants(query: string): Promise<Merchant[]> {
	const merchants = await getMerchants();
	if (!query) return merchants;
	const q = query.toLowerCase();
	return merchants.filter(
		(m) => m.name.toLowerCase().includes(q) || m.networkIds.some((id) => id.toLowerCase().includes(q))
	);
}
