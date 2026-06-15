import { env } from '$env/dynamic/private';
import { createLogger } from '../logger.js';

const log = createLogger('slack');

export interface SlackUserProfile {
	name: string;
	avatarUrl: string | null;
	email: string | null;
	deleted: boolean;
}

const cache = new Map<string, { profile: SlackUserProfile | null; expiresAt: number }>();
const TTL = 30 * 60 * 1000; // 30 minutes

export async function getSlackUserProfile(userId: string): Promise<SlackUserProfile | null> {
	log.debug('getSlackUserProfile called', { userId });
	const cached = cache.get(userId);
	if (cached && cached.expiresAt > Date.now()) {
		log.trace('getSlackUserProfile cache hit', { userId });
		return cached.profile;
	}
	log.trace('getSlackUserProfile cache miss', { userId });

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
			cache.set(userId, { profile: null, expiresAt: Date.now() + TTL });
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
		cache.set(userId, { profile, expiresAt: Date.now() + TTL });
		return profile;
	} catch (err) {
		log.error('getSlackUserProfile failed', err, { userId });
		return null;
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
