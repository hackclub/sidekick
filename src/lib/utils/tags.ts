import type { ProjectTag } from '$lib/server/protocol/types.js';

// Neutral gray used when a tag has no color, or a color we can't parse.
export const DEFAULT_TAG_COLOR = '#6b7280';

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// Normalize a program-supplied tag color to a hex string safe to interpolate
// into CSS. Accepts `#rgb` and `#rrggbb` (case-insensitive); anything else
// (missing, named colors, `rgb(...)`, garbage) falls back to the default gray so
// a bad value can never break the pill or inject arbitrary CSS.
export function normalizeTagColor(color?: string): string {
	if (typeof color !== 'string') return DEFAULT_TAG_COLOR;
	const trimmed = color.trim();
	return HEX_RE.test(trimmed) ? trimmed : DEFAULT_TAG_COLOR;
}

// Drop malformed entries from an upstream `tags` array: tags must be objects
// with a non-empty string label. Whitespace-only labels are ignored.
export function normalizeTags(tags: ProjectTag[] | undefined): ProjectTag[] {
	if (!Array.isArray(tags)) return [];
	return tags.filter(
		(t): t is ProjectTag => !!t && typeof t.label === 'string' && t.label.trim().length > 0
	);
}
