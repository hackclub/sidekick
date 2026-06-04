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
