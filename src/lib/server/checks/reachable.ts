const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const TIMEOUT = 15_000;

type ReachableResult =
	| { ok: true; status?: number; note?: string }
	| { ok: false; status: number; statusText: string };

export async function checkReachable(url: string): Promise<ReachableResult> {
	const headers = { 'User-Agent': USER_AGENT };

	for (const method of ['HEAD', 'GET'] as const) {
		try {
			const response = await fetch(url, {
				method,
				redirect: 'follow',
				headers,
				signal: AbortSignal.timeout(TIMEOUT)
			});

			if (response.ok || (response.status >= 300 && response.status < 400)) {
				return { ok: true, status: response.status };
			}

			if (method === 'HEAD' && response.status === 405) continue;

			if (response.status >= 400 && response.status < 500) {
				return { ok: false, status: response.status, statusText: response.statusText };
			}

			if (response.status >= 500) {
				return { ok: false, status: response.status, statusText: response.statusText };
			}

			return { ok: true, status: response.status, note: `returned ${response.status}` };
		} catch (e) {
			if (method === 'HEAD') continue;
			const msg = e instanceof Error ? e.message : String(e);
			return { ok: true, note: `could not fetch (${msg})` };
		}
	}

	return { ok: true, note: 'could not fetch (HEAD and GET both failed)' };
}
