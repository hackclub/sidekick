import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { env } from '$env/dynamic/private';
import type { Prisma } from '@prisma/client';
import { db } from '../db.js';
import {
	LAPSE_AFK_ALGORITHM_VERSION,
	findLapseAfkIntervals,
	type LapseAfkAnalysis,
	type LapseAfkInterval
} from '$lib/review/lapseAfk.js';

// scdet's mean absolute frame difference (0-1 per pixel, on a 64x36 grayscale
// downscale) above which a frame counts as visibly different from the last.
const MAFD_THRESHOLD = 0.05;
const FRAME_LINE = /^frame:\d+\s+pts:\d+\s+pts_time:(\S+)/;
const MAFD_LINE = /^lavfi\.scd\.mafd=(\S+)/;
const DURATION_LINE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;
const OUT_TIME_LINE = /^out_time_ms=(\d+)/;

/** Lookout-backed timelapses are assembled from periodic screenshots, one frame each. */
function isLookoutPlaybackUrl(playbackUrl: string): boolean {
	try {
		return new URL(playbackUrl).hostname === 'lookout.hackclub.com';
	} catch {
		return false;
	}
}

export async function detectLapseAfkIntervals(
	playbackUrl: string,
	recordingDuration: number,
	onProgress: (fraction: number) => void
): Promise<{ videoDuration: number; intervals: LapseAfkInterval[] }> {
	const response = await fetch(playbackUrl);
	if (!response.ok || !response.body) {
		throw new Error(`Lapse video request failed with status ${response.status}`);
	}

	const body = response.body;
	const child = spawn(
		env.FFMPEG_PATH?.trim() || 'ffmpeg',
		[
			'-hide_banner',
			'-i',
			'pipe:0',
			'-vf',
			'scale=64:36,format=gray,scdet=threshold=0,metadata=print:file=-',
			'-progress',
			'pipe:2',
			'-stats_period',
			'0.05',
			'-f',
			'null',
			'-'
		],
		{ stdio: ['pipe', 'pipe', 'pipe'] }
	);
	const inputError = pipeline(Readable.fromWeb(body as NodeReadableStream), child.stdin).then(
		() => null,
		(cause: unknown) => (cause instanceof Error ? cause : new Error('Lapse video stream failed'))
	);

	const frames: { videoSeconds: number; changed: boolean }[] = [];
	let pendingVideoSeconds: number | null = null;
	let stderr = '';
	let inputDurationMs: number | null = null;

	createInterface({ input: child.stdout }).on('line', (line) => {
		const frameMatch = FRAME_LINE.exec(line);
		if (frameMatch) {
			pendingVideoSeconds = Number(frameMatch[1]);
			return;
		}
		const mafdMatch = MAFD_LINE.exec(line);
		if (mafdMatch && pendingVideoSeconds !== null) {
			frames.push({ videoSeconds: pendingVideoSeconds, changed: Number(mafdMatch[1]) > MAFD_THRESHOLD });
			pendingVideoSeconds = null;
		}
	});

	createInterface({ input: child.stderr }).on('line', (line) => {
		stderr += `${line}\n`;
		if (stderr.length > 8192) stderr = stderr.slice(-8192);
		if (inputDurationMs === null) {
			const durationMatch = DURATION_LINE.exec(line);
			if (durationMatch) {
				const [, hours, minutes, seconds] = durationMatch;
				inputDurationMs = (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000;
			}
			return;
		}
		const outTimeMatch = OUT_TIME_LINE.exec(line);
		if (outTimeMatch && inputDurationMs > 0) {
			// Despite the name, ffmpeg reports out_time_ms in microseconds.
			onProgress(Math.min(1, Number(outTimeMatch[1]) / 1000 / inputDurationMs));
		}
	});

	const exitCode = await new Promise<number>((resolve, reject) => {
		child.on('error', reject);
		child.on('close', (code) => resolve(code ?? 1));
	});
	const streamError = await inputError;

	if (exitCode !== 0) {
		throw new Error(`ffmpeg exited with code ${exitCode}: ${stderr.trim().slice(-500)}`);
	}
	if (streamError) {
		throw new Error(`Lapse video stream failed: ${streamError.message}`);
	}
	if (frames.length === 0) {
		throw new Error('ffmpeg produced no frames for this recording');
	}
	onProgress(1);

	// Frames are spread evenly over the recording, so video time maps linearly
	// onto real time.
	const videoDuration = frames[frames.length - 1].videoSeconds;
	return {
		videoDuration,
		intervals: findLapseAfkIntervals(
			frames.map((frame, index) => ({
				atSeconds: Math.min(recordingDuration, (frame.videoSeconds / videoDuration) * recordingDuration),
				changed: index === 0 ? false : frame.changed
			})),
			// A Lookout frame is one screenshot, so a single unchanged frame can
			// already span minutes; require two before calling it AFK.
			{ recordingDuration, minSamples: isLookoutPlaybackUrl(playbackUrl) ? 2 : 1 }
		)
	};
}

function toAnalysis(row: {
	timelapseId: string;
	algorithmVersion: number;
	videoDuration: number;
	recordingDuration: number;
	intervals: unknown;
	totalAfkSeconds: number;
	analyzedAt: Date;
}): LapseAfkAnalysis {
	return {
		...row,
		intervals: row.intervals as LapseAfkInterval[],
		analyzedAt: row.analyzedAt.toISOString()
	};
}

// Timelapses are immutable once published, so an analysis is cached per Lapse
// ID for good; only a detector change (LAPSE_AFK_ALGORITHM_VERSION) retires it.

/** Cached analyses for the given timelapses, skipping ones from older algorithm versions. */
export async function getCachedLapseAfkAnalyses(timelapseIds: string[]): Promise<LapseAfkAnalysis[]> {
	if (timelapseIds.length === 0) return [];
	const rows = await db.lapseAfkAnalysis.findMany({
		where: { timelapseId: { in: timelapseIds }, algorithmVersion: LAPSE_AFK_ALGORITHM_VERSION }
	});
	return rows.map(toAnalysis);
}

export async function saveLapseAfkAnalysis(
	timelapseId: string,
	result: { videoDuration: number; recordingDuration: number; intervals: LapseAfkInterval[] }
): Promise<LapseAfkAnalysis> {
	const data = {
		algorithmVersion: LAPSE_AFK_ALGORITHM_VERSION,
		videoDuration: result.videoDuration,
		recordingDuration: result.recordingDuration,
		intervals: result.intervals as unknown as Prisma.InputJsonValue,
		totalAfkSeconds: result.intervals.reduce((total, i) => total + i.durationSeconds, 0),
		analyzedAt: new Date()
	};
	const row = await db.lapseAfkAnalysis.upsert({
		where: { timelapseId },
		create: { timelapseId, ...data },
		update: data
	});
	return toAnalysis(row);
}
