import { env } from '$env/dynamic/private';
import { createLogger } from '../logger.js';

const log = createLogger('lapse');
const LAPSE_API = 'https://api.lapse.hackclub.com/api';

export interface LapseTimelapse {
	id: string;
	name: string;
	description: string;
	visibility: 'UNLISTED' | 'PUBLIC' | 'FAILED_PROCESSING';
	createdAt: number;
	playbackUrl: string | null;
	thumbnailUrl: string | null;
	duration: number;
	ownerHandle: string;
	hackatimeProject: string | null;
}

function authHeaders(): Record<string, string> {
	const key = env.LAPSE_PROGRAM_KEY;
	if (!key) return {};
	return { Authorization: `Bearer ${key}` };
}

function mapTimelapse(t: Record<string, unknown>): LapseTimelapse {
	return {
		id: t.id as string,
		name: t.name as string,
		description: (t.description as string) ?? '',
		visibility: t.visibility as LapseTimelapse['visibility'],
		createdAt: t.createdAt as number,
		playbackUrl: (t.playbackUrl as string) ?? null,
		thumbnailUrl: (t.thumbnailUrl as string) ?? null,
		duration: (t.duration as number) ?? 0,
		ownerHandle: ((t.owner as Record<string, unknown>)?.handle as string) ?? '',
		hackatimeProject: ((t.private as Record<string, unknown>)?.hackatimeProject as string) ?? null
	};
}

export async function getLapseTimelapses(
	hackatimeId: string,
	projectKeys: string[]
): Promise<LapseTimelapse[]> {
	log.debug('getLapseTimelapses called', { hackatimeId, projectKeys: projectKeys.join(',') });
	const timer = log.time('getLapseTimelapses');

	const userRes = await fetch(`${LAPSE_API}/user/query?hackatimeId=${encodeURIComponent(hackatimeId)}`, {
		headers: authHeaders(),
		signal: AbortSignal.timeout(10000)
	});
	if (!userRes.ok) {
		timer.end({ status: userRes.status });
		log.warn('getLapseTimelapses user lookup failed', { hackatimeId, status: userRes.status });
		return [];
	}

	const userData = await userRes.json();
	if (!userData.ok || !userData.data?.user) {
		timer.end({ userFound: false });
		log.debug('getLapseTimelapses user not found', { hackatimeId });
		return [];
	}

	const lapseUserId = userData.data.user.id;
	log.trace('getLapseTimelapses user found', { hackatimeId, lapseUserId });

	const timelapseRes = await fetch(`${LAPSE_API}/timelapse/findByUser?user=${encodeURIComponent(lapseUserId)}`, {
		headers: authHeaders(),
		signal: AbortSignal.timeout(10000)
	});
	if (!timelapseRes.ok) {
		timer.end({ status: timelapseRes.status });
		log.warn('getLapseTimelapses timelapse fetch failed', { lapseUserId, status: timelapseRes.status });
		return [];
	}

	const timelapseData = await timelapseRes.json();
	if (!timelapseData.ok || !timelapseData.data?.timelapses) {
		timer.end({ timelapseCount: 0 });
		log.debug('getLapseTimelapses no timelapses', { lapseUserId });
		return [];
	}

	const allTimelapses = timelapseData.data.timelapses as Record<string, unknown>[];
	const keySet = new Set(projectKeys.map((k) => k.toLowerCase()));

	const filtered = allTimelapses
		.filter((t) => {
			if (t.visibility === 'FAILED_PROCESSING') return false;
			if (!(t.private as Record<string, unknown>)?.hackatimeProject) return false;
			return keySet.has(((t.private as Record<string, unknown>).hackatimeProject as string).toLowerCase());
		})
		.map(mapTimelapse);

	timer.end({ totalTimelapses: allTimelapses.length, filteredCount: filtered.length });
	log.debug('getLapseTimelapses result', { hackatimeId, totalTimelapses: allTimelapses.length, filteredCount: filtered.length });
	return filtered;
}

export async function getLapseTimelapseById(id: string): Promise<LapseTimelapse | null> {
	log.debug('getLapseTimelapseById called', { id });
	try {
		const timer = log.time('getLapseTimelapseById');
		const res = await fetch(`${LAPSE_API}/timelapse/query?id=${encodeURIComponent(id)}`, {
			headers: authHeaders(),
			signal: AbortSignal.timeout(5000)
		});
		if (!res.ok) {
			timer.end({ status: res.status });
			log.debug('getLapseTimelapseById not found', { id, status: res.status });
			return null;
		}
		const data = await res.json();
		if (!data.ok || !data.data?.timelapse) {
			timer.end({ found: false });
			log.debug('getLapseTimelapseById no timelapse in response', { id });
			return null;
		}
		timer.end({ found: true });
		log.debug('getLapseTimelapseById success', { id });
		return mapTimelapse(data.data.timelapse);
	} catch (err) {
		log.error('getLapseTimelapseById failed', err, { id });
		return null;
	}
}

export function lapseUrl(ownerHandle: string, timelapseId: string): string {
	return `https://lapse.hackclub.com/@${ownerHandle}/${timelapseId}`;
}
