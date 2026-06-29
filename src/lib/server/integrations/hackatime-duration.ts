/**
 * Faithful TypeScript port of Hackatime's heartbeat -> duration aggregation.
 *
 * Mirrors `Heartbeat#duration_seconds` and friends in Hackatime
 * (app/models/concerns/heartbeatable.rb). The canonical SQL is:
 *
 *   CASE WHEN LAG(time) OVER (PARTITION BY <group> ORDER BY time, id) IS NULL
 *        THEN 0
 *        ELSE LEAST(time - LAG(time) OVER (...), timeout)
 *   END
 *
 * summed per group and cast to an integer number of seconds. Keep this in lockstep
 * with Hackatime — any divergence shows up as miscredited coding hours.
 */

/** Hackatime's `heartbeat_timeout_duration` default: 2 minutes. Gaps are capped here. */
export const HEARTBEAT_TIMEOUT_S = 120;

/** Bounds enforced by Hackatime's `with_valid_timestamps` scope. */
const MIN_VALID_TIME = 0;
const MAX_VALID_TIME = 253402300799;

export interface DurationHeartbeat {
	/** Unix timestamp in seconds (matches Hackatime's `time` column). */
	time: number;
	/** Optional row id, used only as the tie-break after `time` (Hackatime orders by `time, id`). */
	id?: number;
	project?: string | null;
	category?: string | null;
}

/**
 * Sums capped inter-heartbeat gaps for a single contiguous stream, replicating
 * Hackatime's per-group `SUM(LEAST(time - LAG(time), timeout))`. Drops
 * out-of-range timestamps and orders by `(time, id)` exactly as Hackatime does.
 * The result is rounded to whole seconds to match Hackatime's `::integer` cast.
 */
export function sumCappedGaps(heartbeats: DurationHeartbeat[]): number {
	const valid = heartbeats.filter(
		(hb) => hb.time != null && hb.time >= MIN_VALID_TIME && hb.time <= MAX_VALID_TIME
	);
	if (valid.length < 2) return 0;

	valid.sort((a, b) => a.time - b.time || (a.id ?? 0) - (b.id ?? 0));

	let total = 0;
	for (let i = 1; i < valid.length; i++) {
		total += Math.min(valid[i].time - valid[i - 1].time, HEARTBEAT_TIMEOUT_S);
	}
	return Math.round(total);
}

/**
 * Aggregates coding seconds the way Hackatime's `/projects/details` endpoint does:
 * partitioned by project (`PARTITION BY project`), each project rounded to an
 * integer, then summed. Pass `excludeCategories` to drop heartbeats by category
 * (lower-cased compare) BEFORE aggregating — removing interior heartbeats re-merges
 * the surrounding gaps, which is why `aggregate(all) - aggregate(exclude X)` is the
 * sound way to measure category X's contribution.
 */
export function aggregateByProject(
	heartbeats: DurationHeartbeat[],
	opts: { excludeCategories?: string[] } = {}
): number {
	const exclude = new Set((opts.excludeCategories ?? []).map((c) => c.toLowerCase()));

	const byProject = new Map<string, DurationHeartbeat[]>();
	for (const hb of heartbeats) {
		if (exclude.size > 0 && exclude.has((hb.category ?? '').toLowerCase())) continue;
		const key = hb.project ?? '';
		let group = byProject.get(key);
		if (!group) {
			group = [];
			byProject.set(key, group);
		}
		group.push(hb);
	}

	let total = 0;
	for (const group of byProject.values()) {
		total += sumCappedGaps(group);
	}
	return total;
}
