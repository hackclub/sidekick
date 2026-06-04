import { Queue, Worker } from 'bullmq';
import { getRedis, getBullConnection } from './connection.js';
import { db } from '../db.js';
import { CHECKS, getCheckById } from '../checks/registry.js';
import type { CheckContext } from '../checks/types.js';

const QUEUE_NAME = 'sidekick-checks';
const CTX_PREFIX = 'sidekick-ctx:';
const CTX_TTL = 300;

let _queue: Queue | null = null;

function getQueue(): Queue {
	if (!_queue) {
		_queue = new Queue(QUEUE_NAME, {
			connection: getBullConnection(),
			defaultJobOptions: {
				removeOnComplete: 100,
				removeOnFail: 200,
				attempts: 2,
				backoff: { type: 'fixed', delay: 1000 }
			}
		});
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
	const redis = getRedis();

	await redis.set(contextKey, JSON.stringify(ctx), 'EX', CTX_TTL);

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
}

async function processCheckJob(job: { data: CheckJobData }) {
	const { programId, shipId, checkId, contextKey } = job.data;

	const check = getCheckById(checkId);
	if (!check) throw new Error(`Unknown check: ${checkId}`);

	const ctxJson = await getRedis().get(contextKey);
	if (!ctxJson) throw new Error('Check context expired');
	const ctx: CheckContext = JSON.parse(ctxJson);

	const start = Date.now();
	const result = await check.evaluate(ctx);
	const latencyMs = Date.now() - start;

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
	if (worker) return;

	worker = new Worker(QUEUE_NAME, processCheckJob, {
		connection: getBullConnection(),
		concurrency: 5
	});

	worker.on('failed', (job, err) => {
		if (!job) return;
		const { programId, shipId, checkId } = job.data as CheckJobData;
		console.error(`[checks] ${checkId} failed for ${shipId}:`, err);

		db.checkResult
			.updateMany({
				where: { programId, shipId, checkId },
				data: { status: 'failed', summary: `Check error: ${err.message}` }
			})
			.catch(() => {});
	});

	console.log('[checks] Worker started (concurrency=5)');
}
