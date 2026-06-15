import { getSessionUser } from '$lib/server/auth.js';
import { createLogger } from '$lib/server/logger.js';
import type { Handle } from '@sveltejs/kit';

const log = createLogger('hooks');

let workerStarted = false;

export const handle: Handle = async ({ event, resolve }) => {
	const timer = log.time(`${event.request.method} ${event.url.pathname}`);

	if (!workerStarted) {
		workerStarted = true;
		log.info('starting checks worker');
		const { ensureWorkerStarted } = await import('$lib/server/queue/checks.js');
		ensureWorkerStarted();
		log.info('checks worker started');
	}

	log.trace('incoming request', {
		method: event.request.method,
		path: event.url.pathname
	});

	event.locals.user = await getSessionUser(event.cookies);

	log.trace('session resolved', {
		userId: event.locals.user?.id ?? null,
		hasUser: !!event.locals.user
	});

	const response = await resolve(event);

	timer.end({
		status: response.status,
		userId: event.locals.user?.id ?? null
	});

	return response;
};
