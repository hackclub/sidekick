import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticateMcpToken } from '$lib/server/mcp/tokens.js';
import { createMcpServer } from '$lib/server/mcp/server.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';

const log = createLogger('mcp:http');

// The Model Context Protocol's Streamable HTTP transport, stateless: every
// POST carries one JSON-RPC message, gets a fresh server bound to the token's
// owner, and is answered with plain JSON. Nothing lives between calls, so
// there is no session to resume and no stream to open with GET. See
// docs/MCP.md.

function refuse(status: number, message: string): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			...(status === 401 ? { 'WWW-Authenticate': 'Bearer realm="sidekick"' } : {})
		}
	});
}

export const POST: RequestHandler = async ({ request, url }) => {
	const auth = await authenticateMcpToken(request.headers.get('authorization'));
	if (!auth) return refuse(401, 'unauthorized');

	const server = createMcpServer({ user: auth.user, tokenId: auth.tokenId, origin: url.origin });
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});
	try {
		await server.connect(transport);
		const response = await transport.handleRequest(request);
		response.headers.set('Cache-Control', 'no-store');
		return response;
	} catch (e) {
		log.error('mcp request failed', e, { userId: auth.user.id });
		return refuse(500, 'internal error');
	} finally {
		// With JSON responses the answer is complete once handleRequest returns.
		void server.close();
	}
};

export const GET: RequestHandler = () =>
	refuse(405, 'this server is stateless; POST JSON-RPC messages');
export const DELETE: RequestHandler = () =>
	refuse(405, 'this server is stateless; there is no session to end');
