import { json, error } from '@sveltejs/kit';
import { searchMerchants } from '$lib/server/integrations/yellow-pages.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const logger = createLogger('api:merchants');

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401);

	const query = url.searchParams.get('q') || '';
	logger.debug('Search merchants', { query });

	const merchants = await searchMerchants(query);

	logger.debug('Search results', { query, resultCount: merchants.length });

	return json({ merchants });
};
