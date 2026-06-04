import { getSessionUser } from '$lib/server/auth.js';
import type { Handle } from '@sveltejs/kit';

let workerStarted = false;

export const handle: Handle = async ({ event, resolve }) => {
	if (!workerStarted) {
		workerStarted = true;
		const { ensureWorkerStarted } = await import('$lib/server/queue/checks.js');
		ensureWorkerStarted();
	}
	event.locals.user = await getSessionUser(event.cookies);
	return resolve(event);
};
