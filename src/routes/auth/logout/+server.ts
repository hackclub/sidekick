import { redirect } from '@sveltejs/kit';
import { destroySession } from '$lib/server/auth.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ cookies }) => {
	await destroySession(cookies);
	throw redirect(302, '/auth/login');
};
