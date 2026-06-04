import { redirect } from '@sveltejs/kit';
import { getHcaAuthorizationUrl } from '$lib/server/auth.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async () => {
	throw redirect(302, getHcaAuthorizationUrl());
};
