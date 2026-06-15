import { db } from './db.js';
import { env } from '$env/dynamic/private';
import { createLogger } from './logger.js';
import type { Cookies } from '@sveltejs/kit';

const log = createLogger('auth');

const SESSION_COOKIE = 'sidekick_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function getHcaAuthorizationUrl(): string {
	log.trace('building HCA authorization URL');
	const params = new URLSearchParams({
		client_id: env.HCA_CLIENT_ID!,
		redirect_uri: env.HCA_REDIRECT_URI!,
		response_type: 'code',
		scope: 'openid profile email slack_id'
	});
	return `https://auth.hackclub.com/oauth/authorize?${params}`;
}

export async function exchangeCodeForTokens(code: string) {
	log.debug('exchanging authorization code for tokens');
	const timer = log.time('token exchange');

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
		log.error('HCA token exchange failed', new Error(text), { status: res.status });
		throw new Error(`HCA token exchange failed: ${res.status} ${text}`);
	}

	timer.end({ status: res.status });
	log.debug('token exchange succeeded', { status: res.status });

	return res.json() as Promise<{
		access_token: string;
		refresh_token: string;
		expires_in: number;
		scope: string;
		token_type: string;
	}>;
}

export async function fetchHcaUserInfo(accessToken: string) {
	log.debug('fetching HCA user info');
	const timer = log.time('user info fetch');

	const res = await fetch('https://auth.hackclub.com/api/v1/me', {
		headers: { Authorization: `Bearer ${accessToken}` }
	});

	if (!res.ok) {
		log.error('HCA user info fetch failed', new Error(`status ${res.status}`), { status: res.status });
		throw new Error(`HCA user info failed: ${res.status}`);
	}

	const data = await res.json();
	const identity = data.identity;

	const userInfo = {
		id: identity.id as string,
		email: identity.primary_email as string,
		name: (identity.name as string | undefined) ?? null,
		slackId: (identity.slack_id as string | undefined) ?? null,
		profilePictureUrl: (identity.profile_picture_url as string | undefined) ?? null
	};

	timer.end({ userId: userInfo.id });
	log.debug('user info fetched', { userId: userInfo.id, email: userInfo.email });

	return userInfo;
}

export async function createSession(
	cookies: Cookies,
	userId: string,
	accessToken: string,
	refreshToken: string,
	expiresIn: number
) {
	log.debug('creating session', { userId, expiresIn });

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

	log.info('session created', {
		sessionId: session.id,
		userId,
		expiresAt: session.expiresAt.toISOString()
	});

	return session;
}

export async function getSessionUser(cookies: Cookies) {
	const sessionId = cookies.get(SESSION_COOKIE);
	if (!sessionId) {
		log.trace('no session cookie present');
		return null;
	}

	log.trace('looking up session', { sessionId });

	const session = await db.session.findUnique({
		where: { id: sessionId },
		include: { user: true }
	});

	if (!session) {
		log.debug('session not found (miss)', { sessionId });
		return null;
	}

	if (session.expiresAt < new Date()) {
		log.debug('session expired, deleting', {
			sessionId,
			userId: session.userId,
			expiredAt: session.expiresAt.toISOString()
		});
		await db.session.delete({ where: { id: sessionId } });
		cookies.delete(SESSION_COOKIE, { path: '/' });
		return null;
	}

	log.trace('session hit', { sessionId, userId: session.userId });
	return session.user;
}

export async function destroySession(cookies: Cookies) {
	const sessionId = cookies.get(SESSION_COOKIE);
	if (sessionId) {
		log.info('destroying session', { sessionId });
		await db.session.delete({ where: { id: sessionId } }).catch(() => {});
		cookies.delete(SESSION_COOKIE, { path: '/' });
		log.debug('session destroyed', { sessionId });
	} else {
		log.trace('destroySession called with no session cookie');
	}
}
