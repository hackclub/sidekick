import { Queue, Worker, type Job } from 'bullmq';
import { getBullConnection } from './connection.js';
import { createLogger } from '../logger.js';
import {
	detectLapseAfkIntervals,
	getCachedLapseAfkAnalyses,
	saveLapseAfkAnalysis
} from '../integrations/lapse-afk.js';
import type { LapseAfkStatus } from '$lib/review/lapseAfk.js';

const log = createLogger('lapse-afk');

const QUEUE_NAME = 'sidekick-lapse-afk';
// Each job streams a whole video through ffmpeg, so keep this low.
const CONCURRENCY = 2;
// A job that exhausted its attempts is retried when the timelapse is next
// enqueued, but no sooner than this.
const RETRY_FAILED_AFTER_MS = 60 * 60 * 1000;

interface LapseAfkJobData {
	timelapseId: string;
	playbackUrl: string;
	duration: number;
}

let _queue: Queue<LapseAfkJobData> | null = null;

function getQueue(): Queue<LapseAfkJobData> {
	if (!_queue) {
		_queue = new Queue<LapseAfkJobData>(QUEUE_NAME, {
			connection: getBullConnection(),
			defaultJobOptions: {
				// The result lives in the database; failed jobs are kept so their
				// error can be shown and so they aren't retried on every page load.
				removeOnComplete: true,
				removeOnFail: 1000,
				attempts: 3,
				backoff: { type: 'exponential', delay: 30_000 }
			}
		});
	}
	return _queue;
}

// One job per timelapse; BullMQ ignores adds whose job ID already exists.
function jobId(timelapseId: string): string {
	return `afk-${timelapseId}`;
}

/**
 * Queues AFK analysis for every timelapse that has no cached result yet. Cheap
 * enough to call on each review page load; already-queued, running, or
 * recently failed timelapses are skipped.
 */
export async function enqueueLapseAfkAnalyses(
	timelapses: Array<{ id: string; playbackUrl: string | null; duration: number }>
): Promise<void> {
	const candidates = timelapses.filter((t) => t.playbackUrl && t.duration > 0);
	if (candidates.length === 0) return;

	const cached = new Set((await getCachedLapseAfkAnalyses(candidates.map((t) => t.id))).map((a) => a.timelapseId));
	const queue = getQueue();
	let added = 0;
	for (const t of candidates) {
		if (cached.has(t.id)) continue;
		const existing = await queue.getJob(jobId(t.id));
		if (existing) {
			if (!(await existing.isFailed())) continue;
			if (Date.now() - (existing.finishedOn ?? 0) < RETRY_FAILED_AFTER_MS) continue;
			await existing.remove();
		}
		await queue.add(
			'analyze',
			{ timelapseId: t.id, playbackUrl: t.playbackUrl!, duration: t.duration },
			{ jobId: jobId(t.id) }
		);
		added++;
	}
	if (added > 0) log.info('queued Lapse AFK analyses', { added, cached: cached.size });
}

/** Where each timelapse's analysis stands, for the review UI to poll. */
export async function getLapseAfkStatuses(timelapseIds: string[]): Promise<Record<string, LapseAfkStatus>> {
	const statuses: Record<string, LapseAfkStatus> = {};
	for (const analysis of await getCachedLapseAfkAnalyses(timelapseIds)) {
		statuses[analysis.timelapseId] = { state: 'complete', analysis };
	}

	const queue = getQueue();
	await Promise.all(
		timelapseIds
			.filter((id) => !statuses[id])
			.map(async (id) => {
				const job = await queue.getJob(jobId(id));
				if (!job) {
					statuses[id] = { state: 'unavailable' };
				} else if (await job.isFailed()) {
					statuses[id] = { state: 'failed', error: job.failedReason || 'Analysis failed' };
				} else {
					statuses[id] = { state: 'pending', progress: typeof job.progress === 'number' ? job.progress : 0 };
				}
			})
	);
	return statuses;
}

async function processJob(job: Job<LapseAfkJobData>) {
	const { timelapseId, playbackUrl, duration } = job.data;
	const timer = log.time('analyze Lapse timelapse');
	let lastPercent = 0;
	await job.updateProgress(0); // a retry starts over
	const result = await detectLapseAfkIntervals(playbackUrl, duration, (fraction) => {
		// ffmpeg reports every 50ms; only write whole-percent changes to Redis.
		const percent = Math.floor(fraction * 100);
		if (percent <= lastPercent) return;
		lastPercent = percent;
		job.updateProgress(percent / 100).catch(() => {});
	});
	await saveLapseAfkAnalysis(timelapseId, { ...result, recordingDuration: duration });
	timer.end({ timelapseId, intervals: result.intervals.length, attempt: job.attemptsMade + 1 });
}

let worker: Worker<LapseAfkJobData> | null = null;

export function ensureLapseAfkWorkerStarted() {
	if (worker) return;
	worker = new Worker<LapseAfkJobData>(QUEUE_NAME, processJob, {
		connection: getBullConnection(),
		concurrency: CONCURRENCY
	});
	worker.on('failed', (job, err) => {
		log.error('Lapse AFK analysis failed', err, {
			timelapseId: job?.data.timelapseId,
			attempt: job?.attemptsMade
		});
	});
	log.info('Lapse AFK worker started', { concurrency: CONCURRENCY });
}
