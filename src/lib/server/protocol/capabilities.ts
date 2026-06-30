import { ProtocolClient } from './client.js';
import type { ProtocolFeature } from './types.js';
import { createLogger } from '../logger.js';

const log = createLogger('protocol:capabilities');

// Capability advertisement is fetched via HEALTH_CHECK, which means a network
// round-trip to the endpoint. The result rarely changes, so we cache it briefly
// in-memory to keep it off the critical path of every page load. A failed probe
// is cached for a shorter window so a recovering endpoint is picked up quickly.
const OK_TTL_MS = 5 * 60_000;
const FAIL_TTL_MS = 30_000;

interface CacheEntry {
	features: string[];
	expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Returns the optional protocol features advertised by an endpoint. Endpoints
 * that predate capability negotiation (or that are unreachable) report no
 * features, so callers should treat the empty array as "supports nothing
 * optional" and degrade gracefully.
 */
export async function getEndpointFeatures(
	masterEndpoint: string,
	secretKey: string
): Promise<string[]> {
	const now = Date.now();
	const cached = cache.get(masterEndpoint);
	if (cached && cached.expiresAt > now) {
		return cached.features;
	}

	try {
		const client = new ProtocolClient(masterEndpoint, secretKey);
		const health = await client.healthCheck();
		const features = Array.isArray(health.features) ? health.features : [];
		cache.set(masterEndpoint, { features, expiresAt: now + OK_TTL_MS });
		return features;
	} catch (err) {
		log.warn('capability probe failed; assuming no advertised features', {
			endpoint: masterEndpoint,
			error: err instanceof Error ? err.message : String(err)
		});
		cache.set(masterEndpoint, { features: [], expiresAt: now + FAIL_TTL_MS });
		return [];
	}
}

/** Whether an endpoint advertises a specific optional feature. */
export async function endpointSupports(
	masterEndpoint: string,
	secretKey: string,
	feature: ProtocolFeature
): Promise<boolean> {
	const features = await getEndpointFeatures(masterEndpoint, secretKey);
	return features.includes(feature);
}
