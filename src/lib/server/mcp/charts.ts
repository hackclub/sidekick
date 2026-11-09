// Pictures of Hackatime data for the agent. Reviewers judge heartbeats by
// their shape, not by reading them, and a model asked to find a shape in a
// few thousand numbers misses it but reads it off a chart, so the Hackatime
// tools answer with one. The day chart uses the review page's own
// series and colours (HeartbeatScatter.svelte), so the agent and its
// reviewer describe the same picture in the same words.

import { Resvg } from '@resvg/resvg-js';
import { clock } from './heartbeats.js';
import type { RawHeartbeat } from '../integrations/hackatime.js';

const FONT = 'DejaVu Sans, Helvetica, Arial, sans-serif';
const COLORS = {
	totalLines: '#7c3aed',
	lineno: '#06b6d4',
	cursor: '#e33062',
	ai: '#d47e2f',
	// Not the review page's violet: beside the violet file length a model
	// cannot tell the two apart.
	commit: '#111111',
	commitCount: '#8b5cf6',
	axis: '#737373',
	grid: '#ececec',
	bar: '#404040'
};

function esc(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function niceMax(value: number): number {
	if (value <= 0) return 1;
	const magnitude = 10 ** Math.floor(Math.log10(value));
	for (const step of [1, 2, 2.5, 5, 10]) {
		if (step * magnitude >= value) return step * magnitude;
	}
	return 10 * magnitude;
}

function ticks(max: number, count = 5): number[] {
	return Array.from({ length: count + 1 }, (_, i) => Math.round(((max * i) / count) * 100) / 100);
}

export function renderPng(svg: string): string {
	const resvg = new Resvg(svg, {
		background: '#ffffff',
		font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' }
	});
	return resvg.render().asPng().toString('base64');
}

export interface ChartCommit {
	timeS: number;
	label: string;
}

/**
 * One window of heartbeats as the review page's scatter plot: time across,
 * line number and file length on the left axis, cursor column on the right,
 * commits as violet verticals. "ai coding" heartbeats get an orange ring so a
 * prompting session is visible as such.
 */
export function heartbeatScatterSvg(opts: {
	title: string;
	heartbeats: RawHeartbeat[];
	commits: ChartCommit[];
	startS: number;
	endS: number;
	tz: string;
}): string {
	const W = 1400;
	const H = 720;
	const M = { left: 70, right: 70, top: 104, bottom: 56 };
	const plotW = W - M.left - M.right;
	const plotH = H - M.top - M.bottom;
	const span = Math.max(1, opts.endS - opts.startS);
	const x = (t: number) => M.left + ((t - opts.startS) / span) * plotW;

	const beats = opts.heartbeats;
	const maxLeft = niceMax(Math.max(1, ...beats.map((b) => Math.max(b.lines ?? 0, b.lineno ?? 0))));
	const maxRight = niceMax(Math.max(1, ...beats.map((b) => b.cursorpos ?? 0)));
	const yLeft = (v: number) => M.top + plotH - (v / maxLeft) * plotH;
	const yRight = (v: number) => M.top + plotH - (v / maxRight) * plotH;

	const parts: string[] = [];
	parts.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`
	);
	parts.push(
		`<text x="${M.left}" y="26" font-size="20" font-weight="bold" fill="#000">${esc(opts.title)}</text>`
	);

	const legend: Array<[string, string, boolean]> = [
		['total lines', COLORS.totalLines, false],
		['line number', COLORS.lineno, false],
		['cursor column (right axis)', COLORS.cursor, false],
		['ai coding heartbeat', COLORS.ai, true],
		['commit (dashed line)', COLORS.commit, false]
	];
	let lx = M.left;
	for (const [label, color, ring] of legend) {
		parts.push(
			ring
				? `<circle cx="${lx + 6}" cy="52" r="6" fill="none" stroke="${color}" stroke-width="2"/>`
				: `<circle cx="${lx + 6}" cy="52" r="6" fill="${color}"/>`
		);
		parts.push(
			`<text x="${lx + 18}" y="57" font-size="15" fill="${COLORS.axis}">${esc(label)}</text>`
		);
		lx += 30 + label.length * 8.6;
	}

	for (const v of ticks(maxLeft)) {
		const y = yLeft(v);
		parts.push(
			`<line x1="${M.left}" x2="${M.left + plotW}" y1="${y}" y2="${y}" stroke="${COLORS.grid}"/>`
		);
		parts.push(
			`<text x="${M.left - 8}" y="${y + 5}" font-size="13" text-anchor="end" fill="${COLORS.lineno}">${v}</text>`
		);
	}
	for (const v of ticks(maxRight)) {
		parts.push(
			`<text x="${M.left + plotW + 8}" y="${yRight(v) + 5}" font-size="13" fill="${COLORS.cursor}">${v}</text>`
		);
	}

	// About a dozen time labels, on round clock times, whatever the window's length.
	const stepS =
		[1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 240]
			.map((m) => m * 60)
			.find((step) => span / step <= 12) ?? 6 * 3600;
	for (let t = Math.ceil(opts.startS / stepS) * stepS; t <= opts.endS; t += stepS) {
		const tx = x(t);
		parts.push(
			`<line x1="${tx}" x2="${tx}" y1="${M.top + plotH}" y2="${M.top + plotH + 6}" stroke="${COLORS.axis}"/>`
		);
		parts.push(
			`<text x="${tx}" y="${M.top + plotH + 24}" font-size="13" text-anchor="middle" fill="${COLORS.axis}">${clock(t, opts.tz)}</text>`
		);
	}
	parts.push(
		`<rect x="${M.left}" y="${M.top}" width="${plotW}" height="${plotH}" fill="none" stroke="#d4d4d4"/>`
	);

	// Labels go in the first of two rows with room for them; a commit landing
	// on top of others keeps its line and loses its label, which the text
	// answer lists anyway.
	const labelRowsEnd = [-Infinity, -Infinity];
	for (const c of [...opts.commits].sort((a, b) => a.timeS - b.timeS)) {
		if (c.timeS < opts.startS || c.timeS > opts.endS) continue;
		const cx = x(c.timeS);
		parts.push(
			`<line x1="${cx}" x2="${cx}" y1="${M.top - 22}" y2="${M.top + plotH}" stroke="${COLORS.commit}" stroke-width="1.5" stroke-dasharray="6 4"/>`
		);
		const row = labelRowsEnd.findIndex((end) => cx > end + 4);
		if (row === -1) continue;
		labelRowsEnd[row] = cx + 3 + c.label.length * 8;
		parts.push(
			`<text x="${cx + 3}" y="${M.top - 14 + row * 12}" font-size="11" fill="${COLORS.commit}">${esc(c.label)}</text>`
		);
	}

	const r = beats.length > 3000 ? 2 : 3;
	const totals: string[] = [];
	const linenos: string[] = [];
	const cursors: string[] = [];
	const ai: string[] = [];
	for (const b of beats) {
		const bx = x(b.time).toFixed(1);
		if (typeof b.lines === 'number')
			totals.push(`<circle cx="${bx}" cy="${yLeft(b.lines).toFixed(1)}" r="${r}"/>`);
		if (typeof b.lineno === 'number')
			linenos.push(`<circle cx="${bx}" cy="${yLeft(b.lineno).toFixed(1)}" r="${r}"/>`);
		if (typeof b.cursorpos === 'number')
			cursors.push(`<circle cx="${bx}" cy="${yRight(b.cursorpos).toFixed(1)}" r="${r}"/>`);
		// Agent heartbeats often carry no line number; ring the file length
		// instead, or the axis.
		if ((b.category ?? '').toLowerCase() === 'ai coding') {
			const at = typeof b.lineno === 'number' && b.lineno > 0 ? b.lineno : (b.lines ?? 0);
			ai.push(`<circle cx="${bx}" cy="${yLeft(at).toFixed(1)}" r="${r + 4}"/>`);
		}
	}
	parts.push(`<g fill="${COLORS.totalLines}" fill-opacity="0.75">${totals.join('')}</g>`);
	parts.push(`<g fill="${COLORS.lineno}" fill-opacity="0.85">${linenos.join('')}</g>`);
	parts.push(`<g fill="${COLORS.cursor}" fill-opacity="0.6">${cursors.join('')}</g>`);
	parts.push(`<g fill="none" stroke="${COLORS.ai}" stroke-width="2">${ai.join('')}</g>`);

	if (beats.length === 0) {
		parts.push(
			`<text x="${W / 2}" y="${M.top + plotH / 2}" font-size="20" text-anchor="middle" fill="${COLORS.axis}">No heartbeats on the linked projects in this window</text>`
		);
	}
	parts.push('</svg>');
	return parts.join('');
}

export interface ChartDay {
	date: string;
	codingSeconds: number;
	aiSeconds: number;
	commits: number;
	flagged: boolean;
}

/**
 * The project's time as one bar a day (human time dark, "ai coding" orange),
 * the day's commit count above it, days with a detected heartbeat pattern marked red, and
 * the event start and each ship as verticals: where the claim sits, and
 * whether commits sit with it.
 */
export function dailyBarsSvg(opts: {
	title: string;
	days: ChartDay[];
	markers: Array<{ date: string; label: string; color: string }>;
}): string {
	const W = 1400;
	const H = 560;
	const M = { left: 70, right: 30, top: 80, bottom: 70 };
	const plotW = W - M.left - M.right;
	const plotH = H - M.top - M.bottom;
	const n = Math.max(1, opts.days.length);
	const slot = plotW / n;
	const barW = Math.max(1, Math.min(40, slot * 0.75));
	const maxH = niceMax(
		Math.max(0.5, ...opts.days.map((d) => (d.codingSeconds + d.aiSeconds) / 3600))
	);
	const y = (h: number) => M.top + plotH - (h / maxH) * plotH;
	const indexOf = new Map(opts.days.map((d, i) => [d.date, i]));

	const parts: string[] = [];
	parts.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`
	);
	parts.push(
		`<text x="${M.left}" y="26" font-size="20" font-weight="bold" fill="#000">${esc(opts.title)}</text>`
	);
	parts.push(
		`<text x="${M.left}" y="52" font-size="15" fill="${COLORS.axis}">bars: hours tracked a day (dark: coding, orange: ai coding) · violet number: commits that day · red underline: a detected heartbeat pattern that day</text>`
	);

	for (const v of ticks(maxH)) {
		parts.push(
			`<line x1="${M.left}" x2="${M.left + plotW}" y1="${y(v)}" y2="${y(v)}" stroke="${COLORS.grid}"/>`
		);
		parts.push(
			`<text x="${M.left - 8}" y="${y(v) + 5}" font-size="13" text-anchor="end" fill="${COLORS.axis}">${v}h</text>`
		);
	}

	const labelEvery = Math.max(1, Math.ceil(n / 24));
	const multiYear = n > 0 && opts.days[0].date.slice(0, 4) !== opts.days[n - 1].date.slice(0, 4);
	opts.days.forEach((d, i) => {
		const cx = M.left + slot * i + slot / 2;
		const human = d.codingSeconds / 3600;
		const ai = d.aiSeconds / 3600;
		if (human > 0) {
			parts.push(
				`<rect x="${cx - barW / 2}" y="${y(human)}" width="${barW}" height="${y(0) - y(human)}" fill="${COLORS.bar}"/>`
			);
		}
		if (ai > 0) {
			parts.push(
				`<rect x="${cx - barW / 2}" y="${y(human + ai)}" width="${barW}" height="${y(human) - y(human + ai)}" fill="${COLORS.ai}"/>`
			);
		}
		if (d.commits > 0) {
			parts.push(
				`<text x="${cx}" y="${y(human + ai) - 6}" font-size="13" font-weight="bold" text-anchor="middle" fill="${COLORS.commitCount}">${d.commits}</text>`
			);
		}
		if (d.flagged) {
			parts.push(
				`<rect x="${cx - barW / 2}" y="${y(0) + 2}" width="${barW}" height="5" fill="#bf0000"/>`
			);
		}
		if (i % labelEvery === 0) {
			parts.push(
				`<text x="${cx}" y="${M.top + plotH + 24}" font-size="12" text-anchor="end" fill="${COLORS.axis}" transform="rotate(-35 ${cx} ${M.top + plotH + 24})">${multiYear ? d.date : d.date.slice(5)}</text>`
			);
		}
	});

	for (const m of opts.markers) {
		const i = indexOf.get(m.date);
		if (i === undefined) continue;
		const mx = M.left + slot * i + slot / 2;
		parts.push(
			`<line x1="${mx}" x2="${mx}" y1="${M.top - 8}" y2="${M.top + plotH}" stroke="${m.color}" stroke-width="2" stroke-dasharray="5 4"/>`
		);
		parts.push(
			`<text x="${mx + 4}" y="${M.top - 10}" font-size="12" fill="${m.color}">${esc(m.label)}</text>`
		);
	}
	parts.push(
		`<rect x="${M.left}" y="${M.top}" width="${plotW}" height="${plotH}" fill="none" stroke="#d4d4d4"/>`
	);
	parts.push('</svg>');
	return parts.join('');
}
