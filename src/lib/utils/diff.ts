export interface DiffSegment {
	type: 'equal' | 'add' | 'remove';
	value: string;
}

export function wordDiff(oldText: string, newText: string): DiffSegment[] {
	const oldWords = tokenize(oldText);
	const newWords = tokenize(newText);
	const lcs = longestCommonSubsequence(oldWords, newWords);

	const result: DiffSegment[] = [];
	let oi = 0;
	let ni = 0;
	let li = 0;

	while (li < lcs.length) {
		const [lo, ln] = lcs[li];

		if (oi < lo) {
			result.push({ type: 'remove', value: oldWords.slice(oi, lo).join('') });
		}
		if (ni < ln) {
			result.push({ type: 'add', value: newWords.slice(ni, ln).join('') });
		}
		result.push({ type: 'equal', value: oldWords[lo] });

		oi = lo + 1;
		ni = ln + 1;
		li++;
	}

	if (oi < oldWords.length) {
		result.push({ type: 'remove', value: oldWords.slice(oi).join('') });
	}
	if (ni < newWords.length) {
		result.push({ type: 'add', value: newWords.slice(ni).join('') });
	}

	return mergeAdjacent(result);
}

function tokenize(text: string): string[] {
	return text.match(/\S+|\s+/g) ?? [];
}

function longestCommonSubsequence(a: string[], b: string[]): [number, number][] {
	const m = a.length;
	const n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			if (a[i] === b[j]) {
				dp[i][j] = dp[i + 1][j + 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
			}
		}
	}

	const pairs: [number, number][] = [];
	let i = 0;
	let j = 0;
	while (i < m && j < n) {
		if (a[i] === b[j]) {
			pairs.push([i, j]);
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			i++;
		} else {
			j++;
		}
	}
	return pairs;
}

function mergeAdjacent(segments: DiffSegment[]): DiffSegment[] {
	const merged: DiffSegment[] = [];
	for (const seg of segments) {
		const last = merged[merged.length - 1];
		if (last && last.type === seg.type) {
			last.value += seg.value;
		} else {
			merged.push({ ...seg });
		}
	}
	return merged;
}

export interface LineDiffOp {
	type: 'equal' | 'add' | 'remove';
	line: string;
	/** 1-based line numbers in the old/new text (absent on the side the line doesn't exist). */
	oldNo?: number;
	newNo?: number;
}

export interface LineDiffHunk {
	ops: LineDiffOp[];
	/** Unchanged lines hidden before this hunk. */
	skippedBefore: number;
}

export interface LineDiffResult {
	hunks: LineDiffHunk[];
	added: number;
	removed: number;
	/** The changed region was too large for an LCS; shown as a full replace. */
	approximate: boolean;
}

// Above this many cells the LCS table gets too big to build interactively.
const MAX_LCS_CELLS = 4_000_000;

/** Line-level diff grouped into hunks with `context` lines around each change. */
export function lineDiff(oldText: string, newText: string, context = 3): LineDiffResult {
	const a = oldText.split(/\r?\n/);
	const b = newText.split(/\r?\n/);

	let pre = 0;
	while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
	let suf = 0;
	while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

	const am = a.slice(pre, a.length - suf);
	const bm = b.slice(pre, b.length - suf);
	const middle: ('equal' | 'add' | 'remove')[] = [];
	let approximate = false;

	if ((am.length + 1) * (bm.length + 1) > MAX_LCS_CELLS) {
		approximate = true;
		for (let i = 0; i < am.length; i++) middle.push('remove');
		for (let j = 0; j < bm.length; j++) middle.push('add');
	} else {
		const m = am.length;
		const n = bm.length;
		const w = n + 1;
		const dp = new Uint32Array((m + 1) * w);
		for (let i = m - 1; i >= 0; i--) {
			for (let j = n - 1; j >= 0; j--) {
				dp[i * w + j] = am[i] === bm[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
			}
		}
		let i = 0;
		let j = 0;
		while (i < m || j < n) {
			if (i < m && j < n && am[i] === bm[j]) {
				middle.push('equal');
				i++;
				j++;
			} else if (i < m && (j >= n || dp[(i + 1) * w + j] >= dp[i * w + j + 1])) {
				middle.push('remove');
				i++;
			} else {
				middle.push('add');
				j++;
			}
		}
	}

	const ops: LineDiffOp[] = [];
	let oi = 0;
	let ni = 0;
	const push = (type: LineDiffOp['type']) => {
		if (type === 'equal') ops.push({ type, line: b[ni], oldNo: ++oi, newNo: ++ni });
		else if (type === 'add') ops.push({ type, line: b[ni], newNo: ++ni });
		else ops.push({ type, line: a[oi], oldNo: ++oi });
	};
	for (let k = 0; k < pre; k++) push('equal');
	for (const t of middle) push(t);
	for (let k = 0; k < suf; k++) push('equal');

	let added = 0;
	let removed = 0;
	const hunks: LineDiffHunk[] = [];
	let hunk: LineDiffHunk | null = null;
	let lastEmitted = -1;

	for (let k = 0; k < ops.length; k++) {
		if (ops[k].type === 'equal') continue;
		if (ops[k].type === 'add') added++;
		else removed++;

		const from = Math.max(k - context, lastEmitted + 1);
		if (!hunk || from > lastEmitted + 1) {
			hunk = { ops: [], skippedBefore: from - (lastEmitted + 1) };
			hunks.push(hunk);
		}
		const to = Math.min(ops.length - 1, k + context);
		for (let x = from; x <= to; x++) {
			if (x <= lastEmitted) continue;
			// Trailing context stops at the next change; that change extends the hunk itself.
			if (x > k && ops[x].type !== 'equal') break;
			hunk.ops.push(ops[x]);
			lastEmitted = x;
		}
	}

	return { hunks, added, removed, approximate };
}
