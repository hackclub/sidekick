import { json, error } from '@sveltejs/kit';
import { searchMerchants } from '$lib/server/integrations/yellow-pages.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401);

	const query = url.searchParams.get('q') || '';
	const merchants = await searchMerchants(query);

	return json({ merchants });
};
