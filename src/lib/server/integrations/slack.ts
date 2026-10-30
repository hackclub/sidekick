import { env } from '$env/dynamic/private';
import { createLogger } from '../logger.js';
import { getRedis } from '../queue/connection.js';

const log = createLogger('slack');

export interface SlackUserProfile {
	name: string;
	avatarUrl: string | null;
	email: string | null;
	deleted: boolean;
}

interface CachedProfile {
	profile: SlackUserProfile | null;
	fetchedAt: number;
}

// The review queue resolves every reviewer and author on it (well over a
// hundred people), and users.info has no batch form, so a cold cache meant a
// hundred-odd Slack calls that Slack throttled to about seven seconds before
// the list could render. That happened after every deploy and every quiet half
// hour. Profiles are now kept in Redis, so they survive restarts, and an entry
// past FRESH_MS is served as it is while it refreshes in the background: a
// display name or avatar a few minutes stale is fine, a stalled queue is not.
const FRESH_MS = 30 * 60 * 1000;
const KEEP_S = 7 * 24 * 60 * 60;
const REDIS_PREFIX = 'slack-profile:';
// The Redis client retries forever, so a read that hangs must not hold a page.
const REDIS_READ_TIMEOUT_MS = 500;

const cache = new Map<string, CachedProfile>();
const inFlight = new Map<string, Promise<SlackUserProfile | null>>();

async function readStoredProfile(userId: string): Promise<CachedProfile | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const raw = await Promise.race([
			getRedis().get(REDIS_PREFIX + userId),
			new Promise<null>((resolve) => {
				timer = setTimeout(() => resolve(null), REDIS_READ_TIMEOUT_MS);
			})
		]);
		return raw ? (JSON.parse(raw) as CachedProfile) : null;
	} catch (err) {
		log.warn('stored Slack profile read failed', { userId, error: String(err) });
		return null;
	} finally {
		clearTimeout(timer);
	}
}

function storeProfile(userId: string, profile: SlackUserProfile | null) {
	const entry: CachedProfile = { profile, fetchedAt: Date.now() };
	cache.set(userId, entry);
	getRedis()
		.set(REDIS_PREFIX + userId, JSON.stringify(entry), 'EX', KEEP_S)
		.catch((err) => log.warn('stored Slack profile write failed', { userId, error: String(err) }));
}

export async function getSlackUserProfile(userId: string): Promise<SlackUserProfile | null> {
	log.debug('getSlackUserProfile called', { userId });
	let entry = cache.get(userId);
	if (!entry) {
		const stored = await readStoredProfile(userId);
		if (stored) {
			entry = stored;
			cache.set(userId, stored);
		}
	}
	if (entry) {
		if (Date.now() - entry.fetchedAt > FRESH_MS) {
			void fetchSlackUserProfile(userId);
		}
		return entry.profile;
	}
	return fetchSlackUserProfile(userId);
}

function fetchSlackUserProfile(userId: string): Promise<SlackUserProfile | null> {
	const pending = inFlight.get(userId);
	if (pending) return pending;
	const promise = loadSlackUserProfile(userId).finally(() => inFlight.delete(userId));
	inFlight.set(userId, promise);
	return promise;
}

async function loadSlackUserProfile(userId: string): Promise<SlackUserProfile | null> {
	const token = env.SLACK_BOT_TOKEN;
	if (!token) {
		log.warn('getSlackUserProfile SLACK_BOT_TOKEN not set');
		return null;
	}

	try {
		const timer = log.time('getSlackUserProfile');
		const response = await fetch(
			`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`,
			{ headers: { Authorization: `Bearer ${token}` } }
		);
		const data = await response.json();
		timer.end({ userId, ok: data.ok });
		if (!data.ok) {
			log.warn('getSlackUserProfile API error', { userId, error: data.error });
			// A rate limit says nothing about the user, so it keeps what is known.
			if (data.error === 'ratelimited') return cache.get(userId)?.profile ?? null;
			storeProfile(userId, null);
			return null;
		}

		const user = data.user;
		const displayName = (user.profile?.display_name_normalized || user.profile?.display_name || '').trim();
		const username = (user.name || '').trim();
		const profile: SlackUserProfile = {
			name: displayName || username || user.real_name || userId,
			avatarUrl: user.profile?.image_192 || user.profile?.image_72 || null,
			email: user.profile?.email || null,
			deleted: !!user.deleted
		};

		log.debug('getSlackUserProfile result', { userId, name: profile.name, deleted: profile.deleted });
		storeProfile(userId, profile);
		return profile;
	} catch (err) {
		log.error('getSlackUserProfile failed', err, { userId });
		return cache.get(userId)?.profile ?? null;
	}
}

export async function getProfilePicture(slackId: string): Promise<string | null> {
	log.debug('getProfilePicture called', { slackId });
	const profile = await getSlackUserProfile(slackId);
	const result = profile?.avatarUrl ?? null;
	log.debug('getProfilePicture result', { slackId, hasAvatar: !!result });
	return result;
}

export async function sendSlackFile(
	userId: string,
	fileContent: string,
	filename: string,
	message: string
): Promise<void> {
	log.debug('sendSlackFile called', { userId, filename, contentLength: fileContent.length });
	const timer = log.time('sendSlackFile');
	const token = env.SLACK_BOT_TOKEN;
	if (!token) throw new Error('SLACK_BOT_TOKEN not configured');

	const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

	log.trace('sendSlackFile opening DM', { userId });
	const dmRes = await fetch('https://slack.com/api/conversations.open', {
		method: 'POST',
		headers,
		body: JSON.stringify({ users: userId })
	});
	const dmData = await dmRes.json();
	if (!dmData.ok) {
		log.error('sendSlackFile failed to open DM', undefined, { userId, error: dmData.error });
		throw new Error(`Failed to open DM: ${dmData.error}`);
	}
	const channelId = dmData.channel.id;
	log.trace('sendSlackFile DM opened', { userId, channelId });

	const contentBytes = new TextEncoder().encode(fileContent);
	log.trace('sendSlackFile getting upload URL', { filename, length: contentBytes.length });
	const uploadRes = await fetch(
		`https://slack.com/api/files.getUploadURLExternal?filename=${encodeURIComponent(filename)}&length=${contentBytes.length}`,
		{ headers: { Authorization: `Bearer ${token}` } }
	);
	const uploadData = await uploadRes.json();
	if (!uploadData.ok) {
		log.error('sendSlackFile failed to get upload URL', undefined, { filename, error: uploadData.error });
		throw new Error(`Failed to get upload URL: ${uploadData.error}`);
	}
	log.trace('sendSlackFile uploading file', { filename, fileId: uploadData.file_id });

	await fetch(uploadData.upload_url, { method: 'POST', body: contentBytes });

	log.trace('sendSlackFile completing upload', { filename, fileId: uploadData.file_id, channelId });
	const completeRes = await fetch('https://slack.com/api/files.completeUploadExternal', {
		method: 'POST',
		headers,
		body: JSON.stringify({
			files: [{ id: uploadData.file_id, title: filename }],
			channel_id: channelId,
			initial_comment: message
		})
	});
	const completeData = await completeRes.json();
	if (!completeData.ok) {
		log.error('sendSlackFile failed to complete upload', undefined, { filename, error: completeData.error });
		throw new Error(`Failed to complete upload: ${completeData.error}`);
	}
	timer.end({ userId, filename });
	log.debug('sendSlackFile success', { userId, filename });
}
