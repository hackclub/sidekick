// AFK ("away from keyboard") detection for Lapse timelapses, ported from
// Telescreen. A span of video in which no frame differs visibly from the one
// before it, lasting longer than LAPSE_AFK_MIN_SECONDS of *recording* time,
// is flagged as AFK. Frame differences come from ffmpeg's scdet filter (see
// integrations/lapse-afk.ts), run in the background by queue/lapse-afk.ts;
// this module only does the span-finding so the client can share the types.

// Bump whenever the detector or its thresholds change; cached analyses with
// an older version are ignored and re-run.
export const LAPSE_AFK_ALGORITHM_VERSION = 4;
const LAPSE_AFK_MIN_SECONDS = 60;

export interface LapseAfkInterval {
	startSeconds: number;
	endSeconds: number;
	durationSeconds: number;
}

export interface LapseAfkAnalysis {
	timelapseId: string;
	algorithmVersion: number;
	videoDuration: number;
	/** Real-world duration the timelapse covers; interval times are in this scale. */
	recordingDuration: number;
	intervals: LapseAfkInterval[];
	totalAfkSeconds: number;
	analyzedAt: string;
}

export type LapseAfkStatus =
	| { state: 'complete'; analysis: LapseAfkAnalysis }
	/** Queued or running; progress is 0 until ffmpeg starts reporting. */
	| { state: 'pending'; progress: number }
	| { state: 'failed'; error: string }
	/** Never queued, e.g. the timelapse has no playable video. */
	| { state: 'unavailable' };

export interface LapseFrameSample {
	atSeconds: number;
	changed: boolean;
}

export function findLapseAfkIntervals(
	samples: LapseFrameSample[],
	{ recordingDuration = Infinity, minSamples = 1 }: { recordingDuration?: number; minSamples?: number } = {}
): LapseAfkInterval[] {
	if (samples.length < 2 || recordingDuration < LAPSE_AFK_MIN_SECONDS) return [];
	const ordered = [...samples].sort((a, b) => a.atSeconds - b.atSeconds);
	const intervals: LapseAfkInterval[] = [];
	let start = ordered[0].atSeconds;
	let count = 1;

	const flush = (end: number) => {
		if (end - start > LAPSE_AFK_MIN_SECONDS && count >= minSamples) {
			intervals.push({ startSeconds: start, endSeconds: end, durationSeconds: end - start });
		}
	};

	for (let i = 1; i < ordered.length; i++) {
		const sample = ordered[i];
		if (!sample.changed) {
			count++;
			continue;
		}
		flush(ordered[i - 1].atSeconds);
		start = sample.atSeconds;
		count = 1;
	}

	flush(ordered[ordered.length - 1].atSeconds);
	return intervals;
}
