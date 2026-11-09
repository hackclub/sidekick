import {
	dateInTimezone,
	getMatchedProjects,
	getRawHeartbeatRange,
	getUserProjects,
	tzDayBounds,
	type RawHeartbeat
} from '../integrations/hackatime.js';
import { aggregateByProject } from '../integrations/hackatime-duration.js';
import { ToolError, hours } from './access.js';
import { clock, heartbeatPatterns, summarizeHeartbeats } from './heartbeats.js';
import { dailyBarsSvg, heartbeatScatterSvg, renderPng } from './charts.js';
import { loadCommits, requireHackatime, type Subject } from './subject.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const CHART_DAYS = 120;
const ROWS_LIMIT = 300;

function isLinked(subject: Subject, hb: RawHeartbeat): boolean {
	const keys = new Set(subject.project.hackatimeProjectKeys.map((k) => k.toLowerCase()));
	return keys.has((hb.project ?? '').toLowerCase());
}

function aiSplit(beats: RawHeartbeat[]): { total: number; ai: number } {
	const total = aggregateByProject(beats);
	const ai = Math.max(0, total - aggregateByProject(beats, { excludeCategories: ['ai coding'] }));
	return { total, ai };
}

function shares(
	beats: RawHeartbeat[],
	field: 'editor' | 'category' | 'machine' | 'language'
): string {
	const groups = new Map<string, RawHeartbeat[]>();
	for (const hb of beats) {
		const key = (hb[field] || 'unknown') as string;
		let group = groups.get(key);
		if (!group) groups.set(key, (group = []));
		group.push(hb);
	}
	const seconds = [...groups].map(([name, hbs]) => [name, aggregateByProject(hbs)] as const);
	const total = seconds.reduce((s, [, v]) => s + v, 0) || 1;
	return seconds
		.sort((a, b) => b[1] - a[1])
		.slice(0, 6)
		.map(([name, s]) => `${name} ${Math.round((s / total) * 100)}%`)
		.join(', ');
}

function datesBetween(first: string, last: string): string[] {
	const out: string[] = [];
	const d = new Date(`${first}T00:00:00Z`);
	const end = new Date(`${last}T00:00:00Z`);
	while (d <= end && out.length < 1000) {
		out.push(d.toISOString().slice(0, 10));
		d.setUTCDate(d.getUTCDate() + 1);
	}
	return out;
}

/** Every heartbeat on the linked projects inside the program's window, in time order. */
async function linkedHeartbeats(subject: Subject, userId: string) {
	const matched = await getMatchedProjects(userId, subject.project.hackatimeProjectKeys);
	if (!matched) return { beats: [] as RawHeartbeat[], truncated: false, names: [] as string[] };
	const start = subject.project.hackatimeStartDate;
	// The start date is a date in the author's timezone, which can begin up to
	// 14 hours before it does in UTC; the caller trims to it exactly.
	// Hackatime's heartbeat times are fractional and its range parameters are
	// not, hence the rounding.
	const startS = Math.floor(
		start
			? Math.max(matched.earliestS, new Date(`${start}T00:00:00Z`).getTime() / 1000 - 14 * 3600)
			: matched.earliestS
	);
	const endS = Math.ceil(matched.latestS) + 1;
	const results = await Promise.all(
		matched.names.map((name) => getRawHeartbeatRange(userId, startS, endS, name))
	);
	const beats = results.flatMap((r) => r.heartbeats).sort((a, b) => a.time - b.time);
	return { beats, truncated: results.some((r) => r.truncated), names: matched.names };
}

/**
 * The shape of the project's tracked time: a bar a day with commits and
 * patterns marked, plus the totals and the days that carry the time. Never
 * the heartbeats themselves.
 */
export async function hackatimeOverview(subject: Subject, tz: string): Promise<CallToolResult> {
	const userId = requireHackatime(subject);
	const [{ beats: allBeats, truncated, names }, commits, userProjects] = await Promise.all([
		linkedHeartbeats(subject, userId),
		loadCommits(subject.project),
		getUserProjects(userId).catch(() => [])
	]);
	const start = subject.project.hackatimeStartDate ?? null;
	const beats = start ? allBeats.filter((b) => dateInTimezone(b.time, tz) >= start) : allBeats;
	const preStart = start
		? aiSplit(allBeats.filter((b) => dateInTimezone(b.time, tz) < start))
		: null;

	if (beats.length === 0) {
		return {
			content: [
				{
					type: 'text',
					text: `No heartbeats on the linked Hackatime projects (${subject.project.hackatimeProjectKeys.join(', ')})${start ? ` on or after ${start}` : ''}. Matched Hackatime project names: ${names.join(', ') || 'none'}.`
				}
			]
		};
	}

	const byDay = new Map<string, RawHeartbeat[]>();
	for (const hb of beats) {
		const date = dateInTimezone(hb.time, tz);
		let group = byDay.get(date);
		if (!group) byDay.set(date, (group = []));
		group.push(hb);
	}
	const commitsByDay = new Map<string, number>();
	for (const c of commits ?? []) {
		const date = dateInTimezone(c.timeS, tz);
		commitsByDay.set(date, (commitsByDay.get(date) ?? 0) + 1);
	}

	const firstDate = dateInTimezone(beats[0].time, tz);
	const lastDate = dateInTimezone(beats[beats.length - 1].time, tz);
	const days = datesBetween(firstDate, lastDate).map((date) => {
		const dayBeats = byDay.get(date) ?? [];
		const { total, ai } = aiSplit(dayBeats);
		const flags = dayBeats.length > 0 ? heartbeatPatterns(dayBeats, tz) : [];
		return {
			date,
			codingSeconds: total - ai,
			aiSeconds: ai,
			commits: commitsByDay.get(date) ?? 0,
			flagged: flags.length > 0,
			flags,
			heartbeats: dayBeats.length
		};
	});

	const totals = aiSplit(beats);
	const active = days.filter((d) => d.heartbeats > 0);
	const lines: string[] = [];
	lines.push(
		`Linked Hackatime projects: ${names.join(', ')}. Timezone ${tz}. ${start ? `Counting from the program's start date ${start}.` : 'No program start date; counting all time.'}`
	);
	lines.push(
		`Tracked ${hours(totals.total)}h over ${active.length} active days (${firstDate} to ${lastDate}), of which ${hours(totals.ai)}h is "ai coding".${preStart && preStart.total > 0 ? ` A further ${hours(preStart.total)}h falls before the start date and is not counted.` : ''}${truncated ? ' The heartbeat fetch hit its cap, so these are lower bounds.' : ''}`
	);
	if (subject.pendingShip) {
		lines.push(`The pending ship claims ${subject.pendingShip.hoursSubmitted}h.`);
	}
	lines.push(
		`Editors: ${shares(beats, 'editor')}. Categories: ${shares(beats, 'category')}. Machines: ${shares(beats, 'machine')}.`
	);

	const top = active
		.filter((d) => d.codingSeconds + d.aiSeconds > 0)
		.sort((a, b) => b.codingSeconds + b.aiSeconds - (a.codingSeconds + a.aiSeconds));
	lines.push(
		`Days carrying the most time: ${top
			.slice(0, 8)
			.map((d) => `${d.date} ${hours(d.codingSeconds + d.aiSeconds)}h/${d.commits} commits`)
			.join('; ')}.`
	);
	if (commits === null) {
		lines.push(
			'Commits: the code URL is not a GitHub repository Sidekick can read, so the chart has no commit counts.'
		);
	} else {
		const noCommit = active.filter((d) => d.commits === 0);
		const noCommitSeconds = noCommit.reduce((s, d) => s + d.codingSeconds + d.aiSeconds, 0);
		lines.push(
			`${commits.length} commits in the repository. ${noCommit.length} of ${active.length} active days have no commit (${hours(noCommitSeconds)}h).`
		);
		const commitOnly = days.filter((d) => d.heartbeats === 0 && d.commits > 0);
		if (commitOnly.length > 0) {
			lines.push(
				`Commits on days with no tracked time: ${commitOnly.map((d) => `${d.date} (${d.commits})`).join(', ')}.`
			);
		}
		const before = (commits ?? []).filter((c) => c.timeS < beats[0].time).length;
		if (before > 0) lines.push(`${before} commits predate the first tracked heartbeat.`);
	}
	const flagged = days.filter((d) => d.flagged);
	lines.push(
		flagged.length > 0
			? `Days with a detected heartbeat pattern: ${flagged.map((d) => `${d.date}: ${d.flags.join('; ')}`).join(' | ')}.`
			: 'No day has a detected heartbeat pattern (parked cursor, fixed-interval run, linear line run).'
	);

	// Projects that started while this one was being built are the ones worth
	// a look (the same work under another name, a sibling tracked separately);
	// long-lived ones overlap everything and say nothing.
	const linkedLower = new Set(names.map((n) => n.toLowerCase()));
	const windowStart = beats[0].time;
	const windowEnd = beats[beats.length - 1].time;
	const started = userProjects.filter(
		(p) =>
			p.name.trim() &&
			!linkedLower.has(p.name.toLowerCase()) &&
			p.first_heartbeat >= windowStart &&
			p.first_heartbeat <= windowEnd
	);
	if (started.length > 0) {
		lines.push(
			`Hackatime projects of theirs that started while this one was tracked (not linked): ${started
				.slice(0, 12)
				.map(
					(p) =>
						`${p.name} (${dateInTimezone(p.first_heartbeat, tz)} to ${dateInTimezone(p.last_heartbeat, tz)})`
				)
				.join(', ')}${started.length > 12 ? `, and ${started.length - 12} more` : ''}.`
		);
	}

	// A long span is drawn as its active days side by side, or the bars that
	// matter would be slivers between months of nothing.
	const sparse = days.length > CHART_DAYS;
	const chartDays = sparse
		? days.filter((d) => d.heartbeats > 0 || d.commits > 0).slice(-CHART_DAYS)
		: days;
	const markers = [
		...(start ? [{ date: start, label: 'start', color: '#737373' }] : []),
		...subject.project.ships.map((s, i) => ({
			date: dateInTimezone(Math.floor(new Date(s.submittedAt).getTime() / 1000), tz),
			label: `ship ${i + 1} (${s.status})`,
			color: '#0085b5'
		}))
	];
	const png = renderPng(
		dailyBarsSvg({
			title: `${subject.project.title}: ${hours(totals.total)}h tracked${sparse ? ' (only days with time or commits are drawn; the gaps between them are not to scale)' : ''}`,
			days: chartDays,
			markers
		})
	);

	return {
		content: [
			{ type: 'text', text: lines.join('\n') },
			{ type: 'image', data: png, mimeType: 'image/png' }
		]
	};
}

function parseClock(date: string, value: string | undefined, tz: string): number | null {
	if (!value) return null;
	const m = value.match(/^(\d{1,2}):(\d{2})$/);
	if (!m) throw new ToolError(`Times are HH:MM in the author's timezone (${tz}); got "${value}".`);
	return tzDayBounds(date, tz).startS + parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60;
}

/**
 * One day (or a window of it) the way the Fraud Squad reads it: the summary
 * text and the scatter plot, with the day's commits on it. `rows` adds the
 * raw heartbeats, only for a narrow window.
 */
export async function hackatimeDay(
	subject: Subject,
	tz: string,
	opts: { date: string; from?: string; to?: string; rows?: boolean }
): Promise<CallToolResult> {
	const userId = requireHackatime(subject);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) throw new ToolError('date is YYYY-MM-DD.');
	const day = tzDayBounds(opts.date, tz);
	const fromS = parseClock(opts.date, opts.from, tz) ?? day.startS;
	const toS = parseClock(opts.date, opts.to, tz) ?? day.endS;
	if (toS <= fromS) throw new ToolError('"to" must be after "from".');

	const [{ heartbeats: dayBeats, truncated }, commits] = await Promise.all([
		getRawHeartbeatRange(userId, day.startS, day.endS),
		loadCommits(subject.project)
	]);
	const inWindow = dayBeats
		.filter((hb) => hb.time >= fromS && hb.time <= toS)
		.sort((a, b) => a.time - b.time);
	const linked = inWindow.filter((hb) => isLinked(subject, hb));
	const others = inWindow.filter((hb) => !isLinked(subject, hb));

	const windowLabel = opts.from || opts.to ? `${clock(fromS, tz)}-${clock(toS, tz)} ` : '';
	const lines: string[] = [];
	const { total, ai } = aiSplit(linked);
	lines.push(
		`${opts.date} ${windowLabel}(${tz}) on the linked projects: ${hours(total)}h tracked, ${hours(ai)}h of it "ai coding".${truncated ? ' The fetch hit its cap; the day is incomplete.' : ''}`
	);
	if (subject.project.hackatimeStartDate && opts.date < subject.project.hackatimeStartDate) {
		lines.push(
			`This day is before the program's start date (${subject.project.hackatimeStartDate}) and counts toward nothing.`
		);
	}
	lines.push(...summarizeHeartbeats(linked, tz));

	if (others.length > 0) {
		const byProject = new Map<string, RawHeartbeat[]>();
		for (const hb of others) {
			const name = hb.project || '(no project)';
			let group = byProject.get(name);
			if (!group) byProject.set(name, (group = []));
			group.push(hb);
		}
		lines.push(
			`Other projects the same ${windowLabel ? 'window' : 'day'} (not linked): ${[...byProject]
				.map(([name, hbs]) => [name, aggregateByProject(hbs)] as const)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 10)
				.map(([name, s]) => `${name} ${Math.round(s / 60)}m`)
				.join(', ')}.`
		);
	}

	const dayCommits = (commits ?? []).filter((c) => c.timeS >= fromS && c.timeS <= toS);
	lines.push(
		commits === null
			? 'Commits: the repository is not readable from here.'
			: dayCommits.length > 0
				? `Commits in this window: ${dayCommits
						.slice()
						.reverse()
						.map(
							(c) =>
								`${clock(c.timeS, tz)} ${c.sha.slice(0, 7)} "${c.message.split('\n')[0].slice(0, 80)}"`
						)
						.join('; ')}.`
				: 'No commits in this window.'
	);

	if (opts.rows) {
		if (linked.length > ROWS_LIMIT) {
			lines.push(
				`Rows withheld: ${linked.length} heartbeats is over ${ROWS_LIMIT}. Narrow the window with from/to.`
			);
		} else {
			lines.push('Rows (time, file, line, cursor, lines, write, category, editor):');
			for (const hb of linked) {
				lines.push(
					`${new Date(hb.time * 1000).toLocaleTimeString('en-GB', { timeZone: tz, hourCycle: 'h23' })} ${hb.entity} ${hb.lineno} ${hb.cursorpos} ${hb.lines} ${hb.is_write ? 'w' : '-'} ${hb.category} ${hb.editor}`
				);
			}
		}
	}

	// The plot spans the linked heartbeats rather than the whole day, so a
	// two-hour session is not a sliver at one edge.
	const pad = 5 * 60;
	const plotStart = opts.from
		? fromS
		: linked.length
			? Math.max(fromS, linked[0].time - pad)
			: fromS;
	const plotEnd = opts.to
		? toS
		: linked.length
			? Math.min(toS, linked[linked.length - 1].time + pad)
			: toS;
	const png = renderPng(
		heartbeatScatterSvg({
			title: `${opts.date} ${clock(plotStart, tz)}-${clock(plotEnd, tz)} (${tz}): ${linked.length} heartbeats, ${hours(total)}h`,
			heartbeats: linked,
			commits: dayCommits.map((c) => ({ timeS: c.timeS, label: c.sha.slice(0, 7) })),
			startS: plotStart,
			endS: plotEnd,
			tz
		})
	);

	return {
		content: [
			{ type: 'text', text: lines.join('\n') },
			{ type: 'image', data: png, mimeType: 'image/png' }
		]
	};
}
