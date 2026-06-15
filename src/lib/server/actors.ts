import { db } from './db.js';
import { getSlackUserProfile } from './integrations/slack.js';
import { createLogger } from './logger.js';

const log = createLogger('actors');

export interface ResolvedActor {
	name: string;
	email: string | null;
	avatarUrl: string | null;
	slackId: string | null;
}

const cache = new Map<string, { actor: ResolvedActor; expiresAt: number }>();
const TTL = 5 * 60 * 1000; // 5 minutes

async function resolveFromSlack(slackId: string): Promise<ResolvedActor> {
	log.trace('resolving actor from Slack', { slackId });
	const profile = await getSlackUserProfile(slackId);
	if (profile) {
		log.trace('Slack profile found', { slackId, name: profile.name });
		return {
			name: profile.name,
			email: profile.email,
			avatarUrl: profile.avatarUrl,
			slackId
		};
	}
	log.trace('no Slack profile found, using raw ID', { slackId });
	return { name: slackId, email: null, avatarUrl: null, slackId };
}

export async function resolveActorId(actorId: string): Promise<ResolvedActor> {
	const cached = cache.get(actorId);
	if (cached && cached.expiresAt > Date.now()) {
		log.trace('resolveActorId cache hit', { actorId });
		return cached.actor;
	}

	log.trace('resolveActorId cache miss, looking up', { actorId });

	const user = await db.user.findFirst({
		where: actorId.startsWith('U')
			? { slackId: actorId }
			: { hcaId: actorId },
		select: { name: true, email: true, avatarUrl: true, slackId: true }
	});

	let actor: ResolvedActor;
	if (user) {
		log.trace('DB user found', { actorId, name: user.name });
		actor = user;
		if (user.slackId) {
			const slackProfile = await getSlackUserProfile(user.slackId);
			if (slackProfile) {
				actor = { ...actor, name: slackProfile.name };
			}
		}
	} else if (actorId.startsWith('U')) {
		log.trace('no DB user, falling back to Slack', { actorId });
		actor = await resolveFromSlack(actorId);
	} else {
		log.trace('no DB user and not a Slack ID, using raw ID', { actorId });
		actor = { name: actorId, email: null, avatarUrl: null, slackId: null };
	}

	cache.set(actorId, { actor, expiresAt: Date.now() + TTL });
	return actor;
}

export async function resolveActorIds(actorIds: string[]): Promise<Map<string, ResolvedActor>> {
	const result = new Map<string, ResolvedActor>();
	const toResolve: string[] = [];

	for (const id of actorIds) {
		const cached = cache.get(id);
		if (cached && cached.expiresAt > Date.now()) {
			result.set(id, cached.actor);
		} else {
			toResolve.push(id);
		}
	}

	const cacheHits = actorIds.length - toResolve.length;
	log.debug('resolveActorIds', {
		batchSize: actorIds.length,
		cacheHits,
		cacheMisses: toResolve.length
	});

	if (toResolve.length > 0) {
		const slackIds = toResolve.filter((id) => id.startsWith('U'));
		const hcaIds = toResolve.filter((id) => !id.startsWith('U'));

		log.trace('querying DB for actors', { slackIdCount: slackIds.length, hcaIdCount: hcaIds.length });

		const users = await db.user.findMany({
			where: {
				OR: [
					...(slackIds.length > 0 ? [{ slackId: { in: slackIds } }] : []),
					...(hcaIds.length > 0 ? [{ hcaId: { in: hcaIds } }] : [])
				]
			},
			select: { hcaId: true, slackId: true, name: true, email: true, avatarUrl: true }
		});

		log.trace('DB query returned', { userCount: users.length });

		const bySlack = new Map(users.filter((u) => u.slackId).map((u) => [u.slackId!, u]));
		const byHca = new Map(users.map((u) => [u.hcaId, u]));

		// Resolve from DB first, collect Slack IDs that need profile lookup
		const unresolvedSlackIds: string[] = [];
		const slackLookupIds: string[] = [];
		const dbUsersByActorId = new Map<string, typeof users[number]>();

		for (const id of toResolve) {
			const user = id.startsWith('U') ? bySlack.get(id) : byHca.get(id);
			if (user) {
				dbUsersByActorId.set(id, user);
				if (user.slackId) slackLookupIds.push(user.slackId);
			} else if (id.startsWith('U')) {
				unresolvedSlackIds.push(id);
			} else {
				const actor: ResolvedActor = { name: id, email: null, avatarUrl: null, slackId: null };
				cache.set(id, { actor, expiresAt: Date.now() + TTL });
				result.set(id, actor);
			}
		}

		// Batch-fetch Slack profiles for all users with slackIds + unresolved Slack IDs
		const allSlackIds = [...new Set([...slackLookupIds, ...unresolvedSlackIds])];
		const slackProfiles = new Map<string, Awaited<ReturnType<typeof getSlackUserProfile>>>();
		if (allSlackIds.length > 0) {
			log.trace('fetching Slack profiles', { count: allSlackIds.length });
			const profiles = await Promise.all(
				allSlackIds.map(async (sid) => ({ sid, profile: await getSlackUserProfile(sid) }))
			);
			for (const { sid, profile } of profiles) {
				slackProfiles.set(sid, profile);
			}
			log.trace('Slack profiles fetched', { count: allSlackIds.length });
		}

		// Build actors for DB users, preferring Slack username
		for (const [id, user] of dbUsersByActorId) {
			const slackProfile = user.slackId ? slackProfiles.get(user.slackId) : null;
			const actor: ResolvedActor = {
				name: slackProfile?.name ?? user.name,
				email: user.email,
				avatarUrl: user.avatarUrl,
				slackId: user.slackId
			};
			cache.set(id, { actor, expiresAt: Date.now() + TTL });
			result.set(id, actor);
		}

		// Build actors for unresolved Slack IDs
		for (const id of unresolvedSlackIds) {
			if (result.has(id)) continue;
			const slackProfile = slackProfiles.get(id);
			const actor: ResolvedActor = slackProfile
				? { name: slackProfile.name, email: slackProfile.email, avatarUrl: slackProfile.avatarUrl ?? null, slackId: id }
				: { name: id, email: null, avatarUrl: null, slackId: id };
			cache.set(id, { actor, expiresAt: Date.now() + TTL });
			result.set(id, actor);
		}
	}

	log.debug('resolveActorIds complete', { totalResolved: result.size });
	return result;
}
