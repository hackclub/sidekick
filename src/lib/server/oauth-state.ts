import { randomBytes, timingSafeEqual } from 'crypto';
import type { Cookies } from '@sveltejs/kit';

const STATE_MAX_AGE = 600; // 10 minutes to get through the provider's pages

/**
 * Starts an OAuth flow: a random `state`, kept in a cookie so that only the
 * browser that started the flow can finish it. Without this, a callback link
 * carrying somebody else's code signs the visitor in as that somebody else.
 */
export function issueOauthState(cookies: Cookies, cookieName: string): string {
	const state = randomBytes(32).toString('base64url');

	cookies.set(cookieName, state, {
		path: '/',
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		maxAge: STATE_MAX_AGE
	});

	return state;
}

/** Whether the callback's `state` is the one this browser was given. Single use: the cookie goes either way. */
export function consumeOauthState(
	cookies: Cookies,
	cookieName: string,
	received: string | null
): boolean {
	const expected = cookies.get(cookieName);
	cookies.delete(cookieName, { path: '/' });

	if (!expected || !received) return false;

	const a = Buffer.from(expected);
	const b = Buffer.from(received);
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A `returnUrl` reduced to a path on this site, or `/`. Resolving it first
 * catches what a prefix check misses: `//host`, `/\host`, and dot segments
 * such as `/.//host` that only collapse into `//host` once parsed.
 */
export function safeReturnPath(raw: string | null | undefined): string {
	if (!raw || !raw.startsWith('/')) return '/';

	const base = 'http://return.invalid';
	let url: URL;
	try {
		url = new URL(raw, base);
	} catch {
		return '/';
	}

	if (url.origin !== base || url.pathname.startsWith('//')) return '/';
	return url.pathname + url.search + url.hash;
}
