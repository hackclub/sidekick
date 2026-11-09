// A stretch of raw Hackatime heartbeats folded into the view the Fraud Squad
// reads: sessions, files with how their line counts moved, the interval
// pattern, the longest linear run of line numbers, the pastes, and a closing
// line naming the scripted-looking patterns found, if any. It reports what is
// there and never what it means.
// Models read thousands of raw rows badly, so the agent gets this text plus
// the scatter plot (charts.ts) instead. Ported from Crescent's autoreviewer
// (reviewer/src/heartbeats.ts), so both agents see a day the same way; the
// thresholds are kept in step with it.

import type { RawHeartbeat } from '../integrations/hackatime.js';

const SESSION_GAP_SECONDS = 15 * 60;
const FILES_SHOWN = 14;
const TALLY_SHOWN = 6;
const PASTE_LINES = 40;
const PARKED_MINUTES = 30;
const PARKED_BEATS = 15;
const EVEN_RUN = 20;
const LINEAR_RUN = 10;
const DENSITY_WRITES = 100;
const DENSITY_PER_LINE = 8;

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

export function clock(timeS: number, tz: string): string {
	let formatter = clockFormatters.get(tz);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
			timeZone: tz
		});
		clockFormatters.set(tz, formatter);
	}
	return formatter.format(new Date(timeS * 1000));
}

function hourOf(timeS: number, tz: string): number {
	return parseInt(clock(timeS, tz).slice(0, 2), 10);
}

function tally(beats: RawHeartbeat[], key: keyof RawHeartbeat): string {
	const counts = new Map<string, number>();
	for (const beat of beats) {
		const value = String(beat[key] ?? '').trim() || 'unknown';
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
	const shown = sorted.slice(0, TALLY_SHOWN).map(([value, n]) => `${value} ${n}`);
	if (sorted.length > TALLY_SHOWN) shown.push(`+${sorted.length - TALLY_SHOWN} more`);
	return shown.join(', ');
}

export function shortPath(entity: string): string {
	const parts = entity.split(/[/\\]/).filter(Boolean);
	return parts.length <= 3 ? entity : `.../${parts.slice(-3).join('/')}`;
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
	return sorted[index] ?? 0;
}

export interface Session {
	start: number;
	end: number;
	beats: number;
	writes: number;
}

export function sessions(beats: RawHeartbeat[]): Session[] {
	const out: Session[] = [];
	for (const beat of beats) {
		const last = out[out.length - 1];
		if (last && beat.time - last.end <= SESSION_GAP_SECONDS) {
			last.end = beat.time;
			last.beats += 1;
			if (beat.is_write) last.writes += 1;
		} else {
			out.push({ start: beat.time, end: beat.time, beats: 1, writes: beat.is_write ? 1 : 0 });
		}
	}
	return out;
}

interface FileStats {
	entity: string;
	beats: number;
	writes: number;
	first: number;
	last: number;
	linesFirst: number | null;
	linesLast: number | null;
	linesMax: number | null;
	linenoMin: number | null;
	linenoMax: number | null;
	categories: Set<string>;
}

function fileStats(beats: RawHeartbeat[]): FileStats[] {
	const files = new Map<string, FileStats>();
	for (const beat of beats) {
		const entity = String(beat.entity ?? '').trim() || '(no file)';
		let stats = files.get(entity);
		if (!stats) {
			stats = {
				entity,
				beats: 0,
				writes: 0,
				first: beat.time,
				last: beat.time,
				linesFirst: null,
				linesLast: null,
				linesMax: null,
				linenoMin: null,
				linenoMax: null,
				categories: new Set()
			};
			files.set(entity, stats);
		}
		stats.beats += 1;
		if (beat.is_write) stats.writes += 1;
		stats.first = Math.min(stats.first, beat.time);
		stats.last = Math.max(stats.last, beat.time);
		if (typeof beat.lines === 'number') {
			if (stats.linesFirst === null) stats.linesFirst = beat.lines;
			stats.linesLast = beat.lines;
			stats.linesMax = Math.max(stats.linesMax ?? beat.lines, beat.lines);
		}
		if (typeof beat.lineno === 'number') {
			stats.linenoMin = Math.min(stats.linenoMin ?? beat.lineno, beat.lineno);
			stats.linenoMax = Math.max(stats.linenoMax ?? beat.lineno, beat.lineno);
		}
		if (beat.category) stats.categories.add(String(beat.category));
	}
	return [...files.values()].sort((a, b) => b.beats - a.beats);
}

interface Intervals {
	median: number;
	p10: number;
	p90: number;
	modal: number;
	modalShare: number;
	longestEvenRun: number;
}

// Gaps between consecutive heartbeats, and how regular they are. A person's
// gaps are all over the place; a script's cluster on one value. The modal
// share is the fraction of gaps within two seconds of the most common one;
// the even run is the longest stretch of consecutive gaps that all sit there.
function intervals(beats: RawHeartbeat[]): Intervals | null {
	if (beats.length < 3) return null;
	const gaps: number[] = [];
	for (let i = 1; i < beats.length; i += 1) {
		gaps.push(Math.round((beats[i].time - beats[i - 1].time) * 10) / 10);
	}

	const sorted = [...gaps].sort((a, b) => a - b);
	const buckets = new Map<number, number>();
	for (const gap of gaps) {
		const bucket = Math.round(gap / 2) * 2;
		buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
	}
	const [modal, modalCount] = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
	let longest = 0;
	let run = 0;
	for (const gap of gaps) {
		if (Math.abs(gap - modal) <= 2) {
			run += 1;
			longest = Math.max(longest, run);
		} else run = 0;
	}
	return {
		median: percentile(sorted, 0.5),
		p10: percentile(sorted, 0.1),
		p90: percentile(sorted, 0.9),
		modal,
		modalShare: modalCount / gaps.length,
		longestEvenRun: longest
	};
}

interface LinearRun {
	length: number;
	entity: string;
	from: number;
	to: number;
	start: number;
}

// The longest stretch of consecutive heartbeats on one file whose line number
// goes up by exactly one each time ("rods to god" on the Fraud Squad's
// graph): what an autotyper leaves behind.
function longestLinearRun(beats: RawHeartbeat[]): LinearRun | null {
	let best: LinearRun | null = null;
	let run: LinearRun | null = null;
	for (let i = 1; i < beats.length; i += 1) {
		const prev = beats[i - 1];
		const beat = beats[i];
		const sameFile = (prev.entity ?? '') === (beat.entity ?? '');
		const step =
			typeof prev.lineno === 'number' && typeof beat.lineno === 'number'
				? beat.lineno - prev.lineno
				: null;
		if (sameFile && step === 1) {
			if (run) {
				run.length += 1;
				run.to = beat.lineno;
			} else {
				run = {
					length: 2,
					entity: String(beat.entity ?? ''),
					from: prev.lineno,
					to: beat.lineno,
					start: prev.time
				};
			}
			if (!best || run.length > best.length) best = { ...run };
		} else run = null;
	}
	return best && best.length >= 5 ? best : null;
}

interface Paste {
	entity: string;
	from: number;
	to: number;
	seconds: number;
	at: number;
}

// Jumps in a file's line count between two consecutive heartbeats on it:
// forty lines in a few seconds is a paste (or a generated file landing), not
// typing.
function pastes(beats: RawHeartbeat[]): Paste[] {
	const lastSeen = new Map<string, RawHeartbeat>();
	const found: Paste[] = [];
	for (const beat of beats) {
		const entity = String(beat.entity ?? '');
		const prev = lastSeen.get(entity);
		if (prev && typeof prev.lines === 'number' && typeof beat.lines === 'number') {
			const delta = beat.lines - prev.lines;
			const seconds = beat.time - prev.time;
			if (delta >= PASTE_LINES && seconds <= 120) {
				found.push({
					entity,
					from: prev.lines,
					to: beat.lines,
					seconds: Math.round(seconds),
					at: beat.time
				});
			}
		}
		lastSeen.set(entity, beat);
	}
	return found.sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, 8);
}

function hourHistogram(beats: RawHeartbeat[], tz: string): string {
	const hoursCount = new Array<number>(24).fill(0);
	for (const beat of beats) hoursCount[hourOf(beat.time, tz)] += 1;
	return hoursCount
		.map((n, hour) => (n ? `${String(hour).padStart(2, '0')}h:${n}` : null))
		.filter(Boolean)
		.join(' ');
}

interface Parked {
	entity: string;
	lineno: number;
	minutes: number;
	beats: number;
	writes: number;
	start: number;
}

// The longest stretch of consecutive heartbeats on one file with the line
// number never moving: an editor left open with a keep-alive, or a script
// sending heartbeats for a file nobody is editing.
function longestParked(beats: RawHeartbeat[]): Parked | null {
	let best: Parked | null = null;
	let run: Parked | null = null;
	for (const beat of beats) {
		const entity = String(beat.entity ?? '');
		const lineno = typeof beat.lineno === 'number' ? beat.lineno : null;
		const last = run ? run.start + run.minutes * 60 : 0;
		if (
			run &&
			lineno !== null &&
			run.entity === entity &&
			run.lineno === lineno &&
			beat.time - last <= SESSION_GAP_SECONDS
		) {
			run.beats += 1;
			if (beat.is_write) run.writes += 1;
			run.minutes = (beat.time - run.start) / 60;
		} else {
			run =
				lineno === null
					? null
					: {
							entity,
							lineno,
							minutes: 0,
							beats: 1,
							writes: beat.is_write ? 1 : 0,
							start: beat.time
						};
		}
		if (run && (!best || run.minutes > best.minutes)) best = { ...run };
	}
	return best && best.minutes >= PARKED_MINUTES && best.beats >= PARKED_BEATS ? best : null;
}

/**
 * The patterns a script or keep-alive leaves (a parked cursor, a fixed-interval
 * run, a line number rising by one), named outright so they cannot be read
 * past in the rest of the summary. Empty when the stretch carries none.
 */
export function heartbeatPatterns(beats: RawHeartbeat[], tz: string): string[] {
	const sorted = [...beats].sort((a, b) => a.time - b.time);
	const gaps = intervals(sorted);
	const linear = longestLinearRun(sorted);
	const parked = longestParked(sorted);
	const found: string[] = [];
	if (parked && parked.writes <= 2) {
		found.push(
			`cursor parked on ${shortPath(parked.entity)} line ${parked.lineno} for ${parked.minutes.toFixed(0)} minutes from ${clock(parked.start, tz)} (${parked.beats} heartbeats, ${parked.writes} writes)`
		);
	}
	// A keep-alive fires every minute or two; a run at a sub-ten-second interval
	// is a burst of saves or a bulk flush, which the density note covers.
	if (gaps && gaps.longestEvenRun >= EVEN_RUN && gaps.modal >= 10) {
		const writeShare = sorted.filter((b) => b.is_write).length / sorted.length;
		if (writeShare <= 0.35) {
			found.push(
				`${gaps.longestEvenRun} consecutive heartbeats at a fixed ${gaps.modal}s interval with ${(writeShare * 100).toFixed(0)}% writes overall`
			);
		}
	}
	if (linear && linear.length >= LINEAR_RUN) {
		found.push(
			`line number rising by exactly one for ${linear.length} consecutive heartbeats on ${shortPath(linear.entity)}`
		);
	}
	return found;
}

/** The text the agent reads about a stretch of heartbeats. Counts over adjectives; nothing decided. */
export function summarizeHeartbeats(beatsIn: RawHeartbeat[], tz: string): string[] {
	const beats = [...beatsIn].sort((a, b) => a.time - b.time);
	const lines: string[] = [];
	if (beats.length === 0) return ['No heartbeats on the linked projects in this window.'];

	const writes = beats.filter((b) => b.is_write).length;
	const first = beats[0];
	const last = beats[beats.length - 1];
	lines.push(
		`${beats.length} heartbeats from ${clock(first.time, tz)} to ${clock(last.time, tz)}, ${writes} writes (${((writes / beats.length) * 100).toFixed(0)}%), ${beats.filter((b) => typeof b.lineno !== 'number').length} without a line number.`
	);
	lines.push(`By hour: ${hourHistogram(beats, tz)}`);
	lines.push(
		`Sessions (a gap over 15 min starts a new one): ${sessions(beats)
			.map((s) => `${clock(s.start, tz)}-${clock(s.end, tz)} ${s.beats} beats/${s.writes} writes`)
			.join('; ')}`
	);
	lines.push(`Categories: ${tally(beats, 'category')}`);
	lines.push(`Projects: ${tally(beats, 'project')}`);
	lines.push(
		`Editors: ${tally(beats, 'editor')}; machines: ${tally(beats, 'machine')}; user agents: ${tally(beats, 'user_agent')}`
	);
	lines.push(`Languages: ${tally(beats, 'language')}`);

	const files = fileStats(beats);
	lines.push(`Files (${files.length} distinct), most heartbeats first:`);
	for (const file of files.slice(0, FILES_SHOWN)) {
		const growth =
			file.linesFirst === null
				? 'lines unknown'
				: `lines ${file.linesFirst}->${file.linesLast}${file.linesMax !== null && file.linesMax > (file.linesLast ?? 0) ? ` (peak ${file.linesMax})` : ''}`;
		const cursor =
			file.linenoMin === null ? '' : `, cursor lines ${file.linenoMin}-${file.linenoMax}`;
		lines.push(
			`- ${shortPath(file.entity)}: ${file.beats} beats, ${file.writes} writes, ${clock(file.first, tz)}-${clock(file.last, tz)}, ${growth}${cursor}${file.categories.size > 1 ? `, categories ${[...file.categories].join('/')}` : ''}`
		);
	}
	if (files.length > FILES_SHOWN) lines.push(`- and ${files.length - FILES_SHOWN} more files`);

	const dense = files.find(
		(file) =>
			file.linesFirst !== null &&
			file.linesLast !== null &&
			file.writes >= DENSITY_WRITES &&
			file.writes / Math.max(1, file.linesLast - file.linesFirst) >= DENSITY_PER_LINE
	);
	if (dense) {
		const grown = Math.max(1, (dense.linesLast ?? 0) - (dense.linesFirst ?? 0));
		lines.push(
			`Write density: ${dense.writes} write heartbeats on ${shortPath(dense.entity)} for a net growth of ${grown} lines (${(dense.writes / grown).toFixed(0)} writes per line added).`
		);
	}
	const gaps = intervals(beats);
	if (gaps) {
		lines.push(
			`Intervals between heartbeats: median ${gaps.median}s, p10 ${gaps.p10}s, p90 ${gaps.p90}s; most common ${gaps.modal}s covering ${(gaps.modalShare * 100).toFixed(0)}% of gaps, longest run at that interval ${gaps.longestEvenRun}.`
		);
	}
	const linear = longestLinearRun(beats);
	lines.push(
		linear
			? `Longest run of consecutive heartbeats on one file with the line number rising by exactly one: ${linear.length} beats on ${shortPath(linear.entity)} (lines ${linear.from}-${linear.to}, from ${clock(linear.start, tz)}).`
			: 'No run of five or more consecutive heartbeats with the line number rising by exactly one.'
	);
	const jumps = pastes(beats);
	lines.push(
		jumps.length
			? `Line-count jumps of ${PASTE_LINES}+ within two minutes on one file (pastes or generated files landing): ${jumps
					.map(
						(p) =>
							`${shortPath(p.entity)} ${p.from}->${p.to} in ${p.seconds}s at ${clock(p.at, tz)}`
					)
					.join('; ')}.`
			: `No line-count jump of ${PASTE_LINES}+ lines within two minutes on one file.`
	);
	const found = heartbeatPatterns(beats, tz);
	lines.push(
		found.length
			? `Patterns detected: ${found.join('; ')}.`
			: 'Patterns detected: none (no parked cursor, fixed-interval run or linear line run).'
	);
	return lines;
}
