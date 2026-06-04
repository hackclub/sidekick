import { env } from '$env/dynamic/private';

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
	const userRes = await fetch(`${LAPSE_API}/user/query?hackatimeId=${encodeURIComponent(hackatimeId)}`, {
		headers: authHeaders(),
		signal: AbortSignal.timeout(10000)
	});
	if (!userRes.ok) return [];

	const userData = await userRes.json();
	if (!userData.ok || !userData.data?.user) return [];

	const lapseUserId = userData.data.user.id;

	const timelapseRes = await fetch(`${LAPSE_API}/timelapse/findByUser?user=${encodeURIComponent(lapseUserId)}`, {
		headers: authHeaders(),
		signal: AbortSignal.timeout(10000)
	});
	if (!timelapseRes.ok) return [];

	const timelapseData = await timelapseRes.json();
	if (!timelapseData.ok || !timelapseData.data?.timelapses) return [];

	const keySet = new Set(projectKeys.map((k) => k.toLowerCase()));

	return (timelapseData.data.timelapses as Record<string, unknown>[])
		.filter((t) => {
			if (t.visibility === 'FAILED_PROCESSING') return false;
			if (!(t.private as Record<string, unknown>)?.hackatimeProject) return false;
			return keySet.has(((t.private as Record<string, unknown>).hackatimeProject as string).toLowerCase());
		})
		.map(mapTimelapse);
}

export async function getLapseTimelapseById(id: string): Promise<LapseTimelapse | null> {
	try {
		const res = await fetch(`${LAPSE_API}/timelapse/query?id=${encodeURIComponent(id)}`, {
			headers: authHeaders(),
			signal: AbortSignal.timeout(5000)
		});
		if (!res.ok) return null;
		const data = await res.json();
		if (!data.ok || !data.data?.timelapse) return null;
		return mapTimelapse(data.data.timelapse);
	} catch {
		return null;
	}
}

export function lapseUrl(ownerHandle: string, timelapseId: string): string {
	return `https://lapse.hackclub.com/@${ownerHandle}/${timelapseId}`;
}
