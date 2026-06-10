import { env } from '$env/dynamic/private';

export interface SlackUserProfile {
	name: string;
	avatarUrl: string | null;
	email: string | null;
	deleted: boolean;
}

const cache = new Map<string, { profile: SlackUserProfile | null; expiresAt: number }>();
const TTL = 30 * 60 * 1000; // 30 minutes

export async function getSlackUserProfile(userId: string): Promise<SlackUserProfile | null> {
	const cached = cache.get(userId);
	if (cached && cached.expiresAt > Date.now()) return cached.profile;

	const token = env.SLACK_BOT_TOKEN;
	if (!token) return null;

	try {
		const response = await fetch(
			`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`,
			{ headers: { Authorization: `Bearer ${token}` } }
		);
		const data = await response.json();
		if (!data.ok) {
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

		cache.set(userId, { profile, expiresAt: Date.now() + TTL });
		return profile;
	} catch {
		return null;
	}
}

export async function getProfilePicture(slackId: string): Promise<string | null> {
	const profile = await getSlackUserProfile(slackId);
	return profile?.avatarUrl ?? null;
}

export async function sendSlackFile(
	userId: string,
	fileContent: string,
	filename: string,
	message: string
): Promise<void> {
	const token = env.SLACK_BOT_TOKEN;
	if (!token) throw new Error('SLACK_BOT_TOKEN not configured');

	const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

	const dmRes = await fetch('https://slack.com/api/conversations.open', {
		method: 'POST',
		headers,
		body: JSON.stringify({ users: userId })
	});
	const dmData = await dmRes.json();
	if (!dmData.ok) throw new Error(`Failed to open DM: ${dmData.error}`);
	const channelId = dmData.channel.id;

	const contentBytes = new TextEncoder().encode(fileContent);
	const uploadRes = await fetch(
		`https://slack.com/api/files.getUploadURLExternal?filename=${encodeURIComponent(filename)}&length=${contentBytes.length}`,
		{ headers: { Authorization: `Bearer ${token}` } }
	);
	const uploadData = await uploadRes.json();
	if (!uploadData.ok) throw new Error(`Failed to get upload URL: ${uploadData.error}`);

	await fetch(uploadData.upload_url, { method: 'POST', body: contentBytes });

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
	if (!completeData.ok) throw new Error(`Failed to complete upload: ${completeData.error}`);
}
