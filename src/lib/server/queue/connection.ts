import { env } from '$env/dynamic/private';
import IORedis from 'ioredis';

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

export function getRedis(): IORedis {
	if (!_redis) {
		_redis = new IORedis(getRedisUrl(), {
			maxRetriesPerRequest: null
		});
	}
	return _redis;
}

export function getBullConnection() {
	if (!_bullConnection) {
		const parsed = new URL(getRedisUrl());
		_bullConnection = {
			host: parsed.hostname || 'localhost',
			port: parseInt(parsed.port || '6379'),
			password: parsed.password || undefined,
			maxRetriesPerRequest: null as null
		};
	}
	return _bullConnection;
}
