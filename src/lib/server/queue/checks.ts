import { Queue, Worker } from 'bullmq';
import { getRedis, getBullConnection } from './connection.js';
import { db } from '../db.js';
import { CHECKS, getCheckById } from '../checks/registry.js';
import { createLogger } from '../logger.js';
import type { CheckContext } from '../checks/types.js';

const log = createLogger('checks');

const QUEUE_NAME = 'sidekick-checks';
const CTX_PREFIX = 'sidekick-ctx:';
const CTX_TTL = 300;

let _queue: Queue | null = null;

function getQueue(): Queue {
	if (!_queue) {
		log.debug('creating checks queue', { queueName: QUEUE_NAME });
		_queue = new Queue(QUEUE_NAME, {
			connection: getBullConnection(),
			defaultJobOptions: {
				removeOnComplete: 100,
				removeOnFail: 200,
				attempts: 2,
				backoff: { type: 'fixed', delay: 1000 }
			}
		});
		log.debug('checks queue created');
	}
	return _queue;
}

interface CheckJobData {
	programId: string;
	shipId: string;
	checkId: string;
	contextKey: string;
}

export async function enqueueChecks(
	programId: string,
	shipId: string,
	ctx: CheckContext
): Promise<void> {
	const contextKey = `${CTX_PREFIX}${programId}:${shipId}`;
	log.debug('enqueueChecks', { programId, shipId, contextKey, checkCount: CHECKS.length });

	const redis = getRedis();

	log.trace('storing check context in Redis', { contextKey, ttl: CTX_TTL });
	await redis.set(contextKey, JSON.stringify(ctx), 'EX', CTX_TTL);

	log.trace('resetting check results in transaction', { programId, shipId });
	await db.$transaction([
		db.checkResult.deleteMany({ where: { programId, shipId } }),
		db.checkResult.createMany({
			data: CHECKS.map((check) => ({
				programId,
				shipId,
				checkId: check.id,
				family: check.family,
				severity: check.severity,
				status: 'pending',
				passed: false,
				summary: '',
				ranAt: new Date()
			}))
		})
	]);

	const jobs = CHECKS.map((check) => ({
		name: check.id,
		data: { programId, shipId, checkId: check.id, contextKey } satisfies CheckJobData
	}));

	await getQueue().addBulk(jobs);
	log.debug('checks enqueued', { programId, shipId, jobCount: jobs.length });
}

async function processCheckJob(job: { data: CheckJobData }) {
	const { programId, shipId, checkId, contextKey } = job.data;
	log.debug('processCheckJob start', { programId, shipId, checkId });

	const check = getCheckById(checkId);
	if (!check) {
		log.error('unknown check ID', new Error(`Unknown check: ${checkId}`), { checkId });
		throw new Error(`Unknown check: ${checkId}`);
	}

	log.trace('retrieving context from Redis', { contextKey });
	const ctxJson = await getRedis().get(contextKey);
	if (!ctxJson) {
		log.error('check context expired', new Error('Check context expired'), { contextKey });
		throw new Error('Check context expired');
	}
	const ctx: CheckContext = JSON.parse(ctxJson);

	const timer = log.time(`check ${checkId}`);
	const result = await check.evaluate(ctx);
	const latencyMs = timer.end({ checkId, passed: result.pass });

	log.debug('check completed', {
		checkId,
		programId,
		shipId,
		passed: result.pass,
		latencyMs,
		summary: result.summary.slice(0, 100)
	});

	await db.checkResult.updateMany({
		where: { programId, shipId, checkId },
		data: {
			status: 'completed',
			passed: result.pass,
			summary: result.summary,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			details: result.details as any,
			latencyMs,
			ranAt: new Date()
		}
	});
}

let worker: Worker | null = null;

export function ensureWorkerStarted() {
	if (worker) {
		log.trace('worker already started');
		return;
	}

	log.info('starting checks worker', { queueName: QUEUE_NAME, concurrency: 5 });

	worker = new Worker(QUEUE_NAME, processCheckJob, {
		connection: getBullConnection(),
		concurrency: 5
	});

	worker.on('failed', (job, err) => {
		if (!job) return;
		const { programId, shipId, checkId } = job.data as CheckJobData;
		log.error(`check job failed: ${checkId}`, err, { programId, shipId, checkId });

		db.checkResult
			.updateMany({
				where: { programId, shipId, checkId },
				data: { status: 'failed', summary: `Check error: ${err.message}` }
			})
			.catch(() => {});
	});

	worker.on('completed', (job) => {
		if (!job) return;
		const { checkId, shipId } = job.data as CheckJobData;
		log.trace('check job completed', { checkId, shipId });
	});

	log.info('checks worker started', { concurrency: 5 });
}
