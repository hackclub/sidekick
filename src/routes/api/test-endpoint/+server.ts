import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const { url, secretKey } = await request.json();

	if (!url || typeof url !== 'string') {
		throw error(400, 'Missing url');
	}

	try {
		new URL(url);
	} catch {
		return json({ ok: false, error: 'Invalid URL' }, { status: 400 });
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);

	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(secretKey ? { Authorization: `Bearer ${secretKey}` } : {})
			},
			body: JSON.stringify({ action: 'HEALTH_CHECK', input: {} }),
			signal: controller.signal
		});

		const body = await res.text().catch(() => '');

		if (res.ok) {
			return json({ ok: true, body });
		} else {
			return json({ ok: false, error: `HTTP ${res.status}${body ? `: ${body.slice(0, 500)}` : ''}` });
		}
	} catch (e) {
		const message = e instanceof DOMException && e.name === 'AbortError'
			? 'Request timed out (15s)'
			: e instanceof TypeError
				? 'Could not reach endpoint — check the URL'
				: String(e);
		return json({ ok: false, error: message });
	} finally {
		clearTimeout(timeout);
	}
};
