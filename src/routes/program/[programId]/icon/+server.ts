import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { getSessionUser } from '$lib/server/auth.js';
import { decodeDataUrl } from '$lib/server/icons.js';
import type { RequestHandler } from './$types.js';

// A program's icon as an image response (see $lib/server/icons). Cached by
// the browser for a day and revalidated by ETag; the link carries the
// program's updatedAt, so a new upload is a new URL.
export const GET: RequestHandler = async ({ params, cookies, request }) => {
	const user = await getSessionUser(cookies);
	if (!user) throw error(401);

	const program = await db.program.findUnique({
		where: { id: params.programId },
		select: { iconUrl: true, updatedAt: true }
	});
	if (!program?.iconUrl) throw error(404);
	if (!program.iconUrl.startsWith('data:')) throw redirect(302, program.iconUrl);

	const etag = `"${program.updatedAt.getTime()}"`;
	const headers = { ETag: etag, 'Cache-Control': 'private, max-age=86400' };
	if (request.headers.get('if-none-match') === etag)
		return new Response(null, { status: 304, headers });

	const decoded = decodeDataUrl(program.iconUrl);
	if (!decoded) throw error(404);
	return new Response(decoded.body, { headers: { ...headers, 'Content-Type': decoded.type } });
};
