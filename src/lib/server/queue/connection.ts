import { env } from '$env/dynamic/private';
import IORedis from 'ioredis';
import { createLogger } from '../logger.js';

const log = createLogger('redis');

let _redis: IORedis | null = null;
let _bullConnection: {
	host: string;
	port: number;
	password: string | undefined;
	maxRetriesPerRequest: null;
} | null = null;

function getRedisUrl() {
	return env.REDIS_URL || 'redis://localhost:6379';
}

function maskRedisUrl(raw: string): string {
	try {
		const u = new URL(raw);
		if (u.password) u.password = '***';
		return u.toString();
	} catch {
		return '<invalid-url>';
	}
}

export function getRedis(): IORedis {
	if (!_redis) {
		const url = getRedisUrl();
		log.info('creating Redis connection', { url: maskRedisUrl(url) });
		_redis = new IORedis(url, {
			maxRetriesPerRequest: null
		});
		log.debug('Redis connection created');
	} else {
		log.trace('reusing existing Redis connection');
	}
	return _redis;
}

export function getBullConnection() {
	if (!_bullConnection) {
		const url = getRedisUrl();
		const parsed = new URL(url);
		log.info('creating Bull connection', {
			host: parsed.hostname || 'localhost',
			port: parsed.port || '6379'
		});
		_bullConnection = {
			host: parsed.hostname || 'localhost',
			port: parseInt(parsed.port || '6379'),
			password: parsed.password || undefined,
			maxRetriesPerRequest: null as null
		};
		log.debug('Bull connection created');
	} else {
		log.trace('reusing existing Bull connection');
	}
	return _bullConnection;
}
