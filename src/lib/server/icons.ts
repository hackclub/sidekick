// Program icons are stored as data URLs (the manage page uploads them that
// way). Pages must not inline them: the root layout lists every program on
// every load, and six icons made 555 KB of base64 in the page data of every
// navigation and every form action's reload, over a second of transfer on
// a good link while the review itself was 80 KB. Pages link the icon route
// instead, versioned by the program's updatedAt so the browser keeps it.

type IconSource = { id: string; iconUrl: string | null; updatedAt: Date };

export function programIconUrl(program: IconSource): string | null {
	if (!program.iconUrl) return null;
	if (!program.iconUrl.startsWith('data:')) return program.iconUrl;
	return `/program/${program.id}/icon?v=${program.updatedAt.getTime()}`;
}

// The bytes and type behind a data URL, or null when it is not one.
export function decodeDataUrl(dataUrl: string): { type: string; body: ArrayBuffer } | null {
	const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
	if (!match) return null;
	const bytes = Buffer.from(match[2], 'base64');
	return {
		type: match[1],
		body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
	};
}
