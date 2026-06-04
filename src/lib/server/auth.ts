import { db } from './db.js';
import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';

const SESSION_COOKIE = 'sidekick_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function getHcaAuthorizationUrl(): string {
	const params = new URLSearchParams({
		client_id: env.HCA_CLIENT_ID!,
		redirect_uri: env.HCA_REDIRECT_URI!,
		response_type: 'code',
		scope: 'openid profile email slack_id'
	});
	return `https://auth.hackclub.com/oauth/authorize?${params}`;
}

export async function exchangeCodeForTokens(code: string) {
	const res = await fetch('https://auth.hackclub.com/oauth/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			grant_type: 'authorization_code',
			client_id: env.HCA_CLIENT_ID,
			client_secret: env.HCA_CLIENT_SECRET,
			redirect_uri: env.HCA_REDIRECT_URI,
			code
		})
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`HCA token exchange failed: ${res.status} ${text}`);
	}

	return res.json() as Promise<{
		access_token: string;
		refresh_token: string;
		expires_in: number;
		scope: string;
		token_type: string;
	}>;
}

export async function fetchHcaUserInfo(accessToken: string) {
	const res = await fetch('https://auth.hackclub.com/api/v1/me', {
		headers: { Authorization: `Bearer ${accessToken}` }
	});

	if (!res.ok) {
		throw new Error(`HCA user info failed: ${res.status}`);
	}

	const data = await res.json();
	const identity = data.identity;

	return {
		id: identity.id as string,
		email: identity.primary_email as string,
		name: (identity.name as string | undefined) ?? null,
		slackId: (identity.slack_id as string | undefined) ?? null,
		profilePictureUrl: (identity.profile_picture_url as string | undefined) ?? null
	};
}

export async function createSession(
	cookies: Cookies,
	userId: string,
	accessToken: string,
	refreshToken: string,
	expiresIn: number
) {
	const session = await db.session.create({
		data: {
			userId,
			accessToken,
			refreshToken,
			expiresAt: new Date(Date.now() + expiresIn * 1000)
		}
	});

	cookies.set(SESSION_COOKIE, session.id, {
		path: '/',
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		maxAge: SESSION_MAX_AGE
	});

	return session;
}

export async function getSessionUser(cookies: Cookies) {
	const sessionId = cookies.get(SESSION_COOKIE);
	if (!sessionId) return null;

	const session = await db.session.findUnique({
		where: { id: sessionId },
		include: { user: true }
	});

	if (!session) return null;

	if (session.expiresAt < new Date()) {
		await db.session.delete({ where: { id: sessionId } });
		cookies.delete(SESSION_COOKIE, { path: '/' });
		return null;
	}

	return session.user;
}

export async function destroySession(cookies: Cookies) {
	const sessionId = cookies.get(SESSION_COOKIE);
	if (sessionId) {
		await db.session.delete({ where: { id: sessionId } }).catch(() => {});
		cookies.delete(SESSION_COOKIE, { path: '/' });
	}
}
