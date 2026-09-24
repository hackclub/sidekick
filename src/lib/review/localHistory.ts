// VS Code "Local History" correlation. Authors can be asked for a zip of their
// editor's History folder (%APPDATA%\Code\User\History and friends). Every
// subfolder there holds an `entries.json` naming the file it tracks plus one
// full snapshot of that file per save / chat edit / refactor. We line those
// snapshots up against Hackatime heartbeats: real work leaves saves behind,
// while inflated time tends to show up as heartbeats with nothing landing.
//
// Everything here runs in the browser; the zip never leaves the reviewer's machine.

/** VS Code's default `workbench.localHistory.maxFileEntries` — older snapshots get pruned past this. */
export const HISTORY_ENTRY_CAP = 50;

/** Heartbeats further apart than this start a new session. */
const SESSION_GAP_MS = 10 * 60 * 1000;
/** Hackatime-style per-heartbeat time credit cap. */
const HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000;
/** Sessions shorter than this aren't worth flagging — a few minutes of reading is normal. */
const FLAG_MIN_SESSION_MS = 15 * 60 * 1000;
/** Saves can land a little after the last heartbeat (the plugin debounces). */
const SESSION_TRAILING_SLACK_MS = 5 * 60 * 1000;
/** Window after an `is_write` heartbeat in which its history entry must appear (VS Code merges saves within 10s). */
const WRITE_MATCH_BEFORE_MS = 5 * 1000;
const WRITE_MATCH_AFTER_MS = 60 * 1000;

// Hackatime editor names / user agents of VS Code and forks that keep the same
// History folder format. Heartbeats from other editors can't be checked.
const VSCODE_FAMILY = /vs ?code|vscodium|code-oss|cursor|windsurf|trae|kiro|positron|antigravity/i;

export type HistorySourceKind = 'save' | 'ai' | 'other';

export interface HistoryEntry {
	/** Unique across the archive: `<folder>/<id>`. */
	key: string;
	fileKey: string;
	/** Zip path of the snapshot, or null when the snapshot file is missing. */
	zipPath: string | null;
	timestamp: number;
	/** Raw `source` from entries.json (e.g. "Chat Edit: 'fix it'"); absent for plain saves. */
	source?: string;
	kind: HistorySourceKind;
	/** The chat prompt, for AI edits. */
	prompt?: string;
	/** Position in the file's entry list (0 = oldest retained snapshot). */
	index: number;
}

export interface HistoryFile {
	key: string;
	resource: string;
	/** Normalized, lowercased path used for matching. */
	path: string;
	/** Human-readable path (decoded, original case). */
	displayPath: string;
	entries: HistoryEntry[];
	/** Hit the per-file entry cap, so snapshots older than `entries[0]` were likely pruned. */
	capped: boolean;
}

export interface LocalHistory {
	fileName: string;
	files: HistoryFile[];
	entries: HistoryEntry[];
	readContent: (entry: HistoryEntry) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Minimal zip reader (central directory + stored/deflate), using the
// browser's DecompressionStream so we don't pull in a dependency.
// ---------------------------------------------------------------------------

interface ZipItem {
	name: string;
	method: number;
	compressedSize: number;
	localHeaderOffset: number;
}

function readZipDirectory(buf: ArrayBuffer): Map<string, ZipItem> {
	const view = new DataView(buf);
	const minEocd = Math.max(0, buf.byteLength - 22 - 0xffff);
	let eocd = -1;

	for (let i = buf.byteLength - 22; i >= minEocd; i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd === -1) throw new Error("That doesn't look like a zip file.");

	const count = view.getUint16(eocd + 10, true);
	let ptr = view.getUint32(eocd + 16, true);
	if (ptr === 0xffffffff || count === 0xffff) {
		throw new Error(
			'ZIP64 archives are not supported — re-zip the History folder with a standard zip tool.'
		);
	}

	const items = new Map<string, ZipItem>();
	const utf8 = new TextDecoder('utf-8');
	const latin1 = new TextDecoder('latin1');

	for (let n = 0; n < count; n++) {
		if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error('Corrupt zip central directory.');

		const flags = view.getUint16(ptr + 8, true);
		const method = view.getUint16(ptr + 10, true);
		const compressedSize = view.getUint32(ptr + 20, true);
		const nameLen = view.getUint16(ptr + 28, true);
		const extraLen = view.getUint16(ptr + 30, true);
		const commentLen = view.getUint16(ptr + 32, true);
		const localHeaderOffset = view.getUint32(ptr + 42, true);
		const nameBytes = new Uint8Array(buf, ptr + 46, nameLen);
		const name = (flags & 0x800 ? utf8 : latin1).decode(nameBytes).replace(/\\/g, '/');

		if (!name.endsWith('/')) items.set(name, { name, method, compressedSize, localHeaderOffset });
		ptr += 46 + nameLen + extraLen + commentLen;
	}

	return items;
}

async function readZipItem(buf: ArrayBuffer, item: ZipItem): Promise<Uint8Array> {
	const view = new DataView(buf);
	const lh = item.localHeaderOffset;
	if (view.getUint32(lh, true) !== 0x04034b50) throw new Error(`Corrupt zip entry: ${item.name}`);

	const start = lh + 30 + view.getUint16(lh + 26, true) + view.getUint16(lh + 28, true);
	const data = new Uint8Array(buf, start, item.compressedSize);

	if (item.method === 0) return data;
	if (item.method !== 8)
		throw new Error(`Unsupported zip compression method ${item.method} (${item.name})`);

	const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Lowercased, forward-slashed path with drive letters normalized ("c:/users/..."). */
export function normalizePath(p: string): string {
	let s = p.replace(/\\/g, '/').toLowerCase();
	s = s.replace(/^\/([a-z]:)/, '$1');
	// WSL mounts: /mnt/c/... → c:/...
	s = s.replace(/^\/mnt\/([a-z])\//, '$1:/');
	return s.replace(/\/+/g, '/');
}

function resourceDisplayPath(resource: string): string {
	try {
		const url = new URL(resource);
		const path = decodeURIComponent(url.pathname).replace(/^\/([a-zA-Z]:)/, '$1');
		return url.protocol === 'file:' ? path : `${url.protocol}${path}`;
	} catch {
		return resource;
	}
}

function resourcePath(resource: string): string {
	try {
		return normalizePath(decodeURIComponent(new URL(resource).pathname));
	} catch {
		return normalizePath(resource);
	}
}

function segments(p: string): string[] {
	return p.split('/').filter(Boolean);
}

function commonSuffixSegments(a: string[], b: string[]): number {
	let n = 0;
	while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
	return n;
}

export function baseName(p: string): string {
	return p.split(/[\\/]/).pop() || p;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function classifySource(source: string | undefined): { kind: HistorySourceKind; prompt?: string } {
	if (!source) return { kind: 'save' };
	const chat = source.match(/^chat edit:?\s*(.*)$/is);
	if (chat) {
		const prompt = chat[1].trim().replace(/^'([\s\S]*)'$/, '$1');
		return { kind: 'ai', prompt: prompt || undefined };
	}
	if (/copilot|inline chat|agent|cursor|composer/i.test(source)) return { kind: 'ai' };
	return { kind: 'other' };
}

interface RawEntries {
	resource?: string;
	entries?: { id?: string; timestamp?: number; source?: string }[];
}

export async function parseLocalHistoryZip(file: File): Promise<LocalHistory> {
	const buf = await file.arrayBuffer();
	const items = readZipDirectory(buf);
	const decoder = new TextDecoder('utf-8');

	const indexes = [...items.values()].filter((it) => /(^|\/)entries\.json$/i.test(it.name));
	if (indexes.length === 0) {
		throw new Error(
			'No entries.json files found — make sure the zip contains the VS Code History folder itself.'
		);
	}

	const files: HistoryFile[] = [];
	const entries: HistoryEntry[] = [];

	for (const idx of indexes) {
		let raw: RawEntries;
		try {
			raw = JSON.parse(decoder.decode(await readZipItem(buf, idx)));
		} catch {
			continue;
		}
		if (!raw.resource || !Array.isArray(raw.entries)) continue;

		const folder = idx.name.slice(0, idx.name.length - 'entries.json'.length);
		const fileKey = folder || idx.name;
		const fileEntries: HistoryEntry[] = raw.entries
			.filter((e) => e.id && typeof e.timestamp === 'number')
			.sort((a, b) => a.timestamp! - b.timestamp!)
			.map((e, index) => ({
				key: `${fileKey}${e.id}`,
				fileKey,
				zipPath: items.has(folder + e.id) ? folder + e.id : null,
				timestamp: e.timestamp!,
				source: e.source,
				index,
				...classifySource(e.source)
			}));

		if (fileEntries.length === 0) continue;

		files.push({
			key: fileKey,
			resource: raw.resource,
			path: resourcePath(raw.resource),
			displayPath: resourceDisplayPath(raw.resource),
			entries: fileEntries,
			capped: fileEntries.length >= HISTORY_ENTRY_CAP
		});
		entries.push(...fileEntries);
	}

	if (files.length === 0)
		throw new Error('The History folder in this zip has no readable entries.');

	entries.sort((a, b) => a.timestamp - b.timestamp);

	const contentCache = new Map<string, Promise<string | null>>();
	const readContent = (entry: HistoryEntry) => {
		const zipPath = entry.zipPath;
		if (!zipPath) return Promise.resolve(null);
		let p = contentCache.get(zipPath);
		if (!p) {
			p = readZipItem(buf, items.get(zipPath)!)
				.then((bytes) => decoder.decode(bytes))
				.catch(() => null);
			contentCache.set(zipPath, p);
		}
		return p;
	};

	return { fileName: file.name, files, entries, readContent };
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

export interface HistoryHeartbeat {
	time: number;
	entity: string;
	is_write: boolean;
	editor: string;
	user_agent: string;
}

export interface HistorySession {
	start: number;
	end: number;
	/** Hackatime-style credited time (ms). */
	durationMs: number;
	heartbeatCount: number;
	writeCount: number;
	entryCount: number;
	aiEntryCount: number;
	/** Entities touched during the session. */
	entities: string[];
	/**
	 * `missing` — long session with no history entries at all;
	 * `uncertain` — same, but a touched file's history was pruned past this point;
	 * null — looks fine.
	 */
	flag: 'missing' | 'uncertain' | null;
}

export interface UnmatchedWrite {
	time: number;
	entity: string;
	/** The file never shows up in the history at all (vs. just no entry near this save). */
	fileMissing: boolean;
}

export interface HistoryAnalysis {
	/** History files that correspond to a heartbeat entity. */
	matchedFileKeys: Set<string>;
	/** Normalized heartbeat entity → matched history file. */
	entityToFile: Map<string, HistoryFile>;
	/** Entries belonging to matched files, ascending. */
	projectEntries: HistoryEntry[];
	sessions: HistorySession[];
	flaggedSessions: HistorySession[];
	checkedHeartbeats: number;
	/** Heartbeats from editors that don't write VS Code history. */
	otherEditorHeartbeats: number;
	writes: { total: number; matched: number; pruned: number; unmatched: UnmatchedWrite[] };
	/** Project entries with no heartbeat within ±10 minutes — edits Hackatime never saw. */
	untrackedEntryCount: number;
}

function isVsCodeFamily(hb: HistoryHeartbeat): boolean {
	return VSCODE_FAMILY.test(hb.editor) || VSCODE_FAMILY.test(hb.user_agent);
}

function matchEntities(history: LocalHistory, entities: string[]): Map<string, HistoryFile> {
	const byPath = new Map(history.files.map((f) => [f.path, f]));
	const fileSegs = history.files.map((f) => ({ file: f, segs: segments(f.path) }));
	const result = new Map<string, HistoryFile>();

	for (const entity of entities) {
		const exact = byPath.get(entity);
		if (exact) {
			result.set(entity, exact);
			continue;
		}

		// Different roots (remote/WSL/containers, renamed user folders) — fall back
		// to the longest shared path tail, requiring enough of it to rule out
		// a same-named file in some other project.
		const entSegs = segments(entity);
		let best: HistoryFile | null = null;
		let bestLen = 0;
		for (const { file, segs } of fileSegs) {
			if (segs[segs.length - 1] !== entSegs[entSegs.length - 1]) continue;
			const len = commonSuffixSegments(segs, entSegs);
			const required = Math.min(3, segs.length, entSegs.length);
			if (len >= required && len > bestLen) {
				best = file;
				bestLen = len;
			}
		}
		if (best) result.set(entity, best);
	}

	return result;
}

function lowerBound(sorted: number[], t: number): number {
	let lo = 0;
	let hi = sorted.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (sorted[mid] < t) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function countInRange(sorted: number[], from: number, to: number): number {
	return lowerBound(sorted, to + 1) - lowerBound(sorted, from);
}

export function analyzeLocalHistory(
	history: LocalHistory,
	heartbeats: HistoryHeartbeat[]
): HistoryAnalysis {
	const checked = heartbeats.filter(isVsCodeFamily).sort((a, b) => a.time - b.time);
	const entitySet = new Set(heartbeats.map((hb) => normalizePath(hb.entity)).filter(Boolean));
	const entityToFile = matchEntities(history, [...entitySet]);

	const matchedFileKeys = new Set([...entityToFile.values()].map((f) => f.key));
	const projectEntries = history.entries.filter((e) => matchedFileKeys.has(e.fileKey));
	const entryTimes = projectEntries.map((e) => e.timestamp);
	const aiTimes = projectEntries.filter((e) => e.kind === 'ai').map((e) => e.timestamp);

	// Sessions over the heartbeats we can actually hold against the history.
	const sessions: HistorySession[] = [];
	let cur: { hbs: HistoryHeartbeat[] } | null = null;
	const flush = () => {
		if (!cur) return;
		const hbs = cur.hbs;
		const start = hbs[0].time;
		const end = hbs[hbs.length - 1].time;
		let durationMs = 0;
		for (let i = 1; i < hbs.length; i++) {
			durationMs += Math.min(hbs[i].time - hbs[i - 1].time, HEARTBEAT_TIMEOUT_MS);
		}
		const entities = [...new Set(hbs.map((hb) => hb.entity))];
		const entryCount = countInRange(entryTimes, start - 60_000, end + SESSION_TRAILING_SLACK_MS);

		let flag: HistorySession['flag'] = null;
		if (entryCount === 0 && durationMs >= FLAG_MIN_SESSION_MS) {
			const pruned = entities.some((ent) => {
				const f = entityToFile.get(normalizePath(ent));
				return !!f && f.capped && f.entries[0].timestamp > start;
			});
			flag = pruned ? 'uncertain' : 'missing';
		}

		sessions.push({
			start,
			end,
			durationMs,
			heartbeatCount: hbs.length,
			writeCount: hbs.filter((hb) => hb.is_write).length,
			entryCount,
			aiEntryCount: countInRange(aiTimes, start - 60_000, end + SESSION_TRAILING_SLACK_MS),
			entities,
			flag
		});
		cur = null;
	};

	for (const hb of checked) {
		if (cur && hb.time - cur.hbs[cur.hbs.length - 1].time > SESSION_GAP_MS) flush();
		(cur ??= { hbs: [] }).hbs.push(hb);
	}
	flush();

	// Every save Hackatime saw should have left a snapshot behind.
	const fileEntryTimes = new Map<string, number[]>();
	const writes = { total: 0, matched: 0, pruned: 0, unmatched: [] as UnmatchedWrite[] };
	let lastWrite: { entity: string; time: number } | null = null;

	for (const hb of checked) {
		if (!hb.is_write) continue;
		// Several write heartbeats for one save burst collapse into one snapshot.
		if (lastWrite && lastWrite.entity === hb.entity && hb.time - lastWrite.time < 10_000) continue;
		lastWrite = { entity: hb.entity, time: hb.time };
		writes.total++;

		const file = entityToFile.get(normalizePath(hb.entity));
		if (!file) {
			writes.unmatched.push({ time: hb.time, entity: hb.entity, fileMissing: true });
			continue;
		}
		if (file.capped && hb.time < file.entries[0].timestamp - WRITE_MATCH_BEFORE_MS) {
			writes.pruned++;
			continue;
		}

		let times = fileEntryTimes.get(file.key);
		if (!times) {
			times = file.entries.map((e) => e.timestamp);
			fileEntryTimes.set(file.key, times);
		}
		// A snapshot can be superseded by a later one within the merge window,
		// so "the next entry at or after this save" counts too.
		const next = lowerBound(times, hb.time - WRITE_MATCH_BEFORE_MS);
		if (next < times.length && times[next] <= hb.time + WRITE_MATCH_AFTER_MS) writes.matched++;
		else writes.unmatched.push({ time: hb.time, entity: hb.entity, fileMissing: false });
	}

	const hbTimes = heartbeats.map((hb) => hb.time).sort((a, b) => a - b);
	const untrackedEntryCount = projectEntries.filter(
		(e) => countInRange(hbTimes, e.timestamp - 10 * 60_000, e.timestamp + 10 * 60_000) === 0
	).length;

	return {
		matchedFileKeys,
		entityToFile,
		projectEntries,
		sessions,
		flaggedSessions: sessions.filter((s) => s.flag),
		checkedHeartbeats: checked.length,
		otherEditorHeartbeats: heartbeats.length - checked.length,
		writes,
		untrackedEntryCount
	};
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** A snapshot pinned above the heartbeat scatter. */
export interface HistoryMark {
	key: string;
	time: number;
	kind: HistorySourceKind;
	title: string;
	subtitle?: string;
}

/** A stretch of coding shaded on the heartbeat scatter. */
export interface FlaggedRange {
	start: number;
	end: number;
	severity: 'missing' | 'uncertain';
	label: string;
}
