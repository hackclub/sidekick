import yaml from 'js-yaml';
import { createLogger } from '../logger.js';

const log = createLogger('yellow-pages');

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
		log.trace('getMerchants cache hit', { count: cache.merchants.length });
		return cache.merchants;
	}

	log.debug('getMerchants fetching from GitHub');
	const timer = log.time('getMerchants fetch');
	const res = await fetch(MERCHANTS_URL, { signal: AbortSignal.timeout(10000) });
	if (!res.ok) {
		log.warn('getMerchants fetch failed', { status: res.status });
		if (cache) {
			log.debug('getMerchants returning stale cache');
			return cache.merchants;
		}
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
	timer.end({ count: merchants.length });
	return merchants;
}

export async function searchMerchants(query: string): Promise<Merchant[]> {
	log.trace('searchMerchants', { query });
	const merchants = await getMerchants();
	if (!query) return merchants;
	const q = query.toLowerCase();
	const results = merchants.filter(
		(m) => m.name.toLowerCase().includes(q) || m.networkIds.some((id) => id.toLowerCase().includes(q))
	);
	log.debug('searchMerchants results', { query, total: merchants.length, matched: results.length });
	return results;
}
