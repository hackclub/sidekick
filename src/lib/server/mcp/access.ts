import { isHttpError } from '@sveltejs/kit';
import { db } from '../db.js';
import { requirePermission, type Permission } from '../rbac.js';
import { ProtocolClient, ProtocolError, ProtocolTransportError } from '../protocol/client.js';
import { HackatimeRateLimitError } from '../integrations/hackatime.js';
import { createLogger } from '../logger.js';
import { ReviewActionError } from '../review-actions.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { User } from '@prisma/client';

const log = createLogger('mcp');

export interface McpContext {
	user: User;
	tokenId: string;
	/** Sidekick's own origin, for links the agent hands to its reviewer. */
	origin: string;
}

/** An error whose message is meant for the agent as it stands. */
export class ToolError extends Error {}

/**
 * The program, the caller's membership and a protocol client, after the same
 * permission check the equivalent page runs. The token is the first gate;
 * this is the second, on every call.
 */
export async function programAccess(ctx: McpContext, programId: string, permission: Permission) {
	const membership = await requirePermission(ctx.user.id, programId, permission, {
		isSuperAdmin: ctx.user.isSuperAdmin
	});
	const program = await db.program.findUnique({ where: { id: programId } });
	if (!program || !program.isActive) throw new ToolError(`No active program with id ${programId}.`);
	return {
		program,
		membership,
		client: new ProtocolClient(program.masterEndpoint, program.secretKey)
	};
}

export function reviewUrl(ctx: McpContext, programId: string, projectId: string): string {
	return `${ctx.origin}/program/${programId}/review/${encodeURIComponent(projectId)}`;
}

/** Cuts long text, saying how much was cut so the agent knows to ask for more. */
export function clip(text: string | null | undefined, max: number): string | null {
	if (text == null) return null;
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max)}… [${trimmed.length - max} more characters]`;
}

export function hours(seconds: number): number {
	return Math.round((seconds / 3600) * 100) / 100;
}

// Every answer shares the agent's context window with the rest of its work,
// so no tool may hand back more than this, however large the record behind
// it is. Past it the answer is withheld and the agent is told to narrow it.
export const RESPONSE_LIMIT = 48_000;

export function jsonResult(value: unknown): CallToolResult {
	const text = JSON.stringify(value, null, 1);
	if (text.length > RESPONSE_LIMIT) {
		return errorResult(
			`The answer was ${text.length} characters, over the ${RESPONSE_LIMIT} limit. Narrower windows, single events and smaller pages fit.`
		);
	}
	return { content: [{ type: 'text', text }] };
}

export function errorResult(message: string): CallToolResult {
	return { isError: true, content: [{ type: 'text', text: message }] };
}

/** Runs a tool body, turning the errors an agent can act on into its error text. */
export async function runTool(
	name: string,
	ctx: McpContext,
	body: () => Promise<CallToolResult>
): Promise<CallToolResult> {
	const timer = log.time(`tool ${name}`);
	try {
		const result = await body();
		timer.end({ userId: ctx.user.id, isError: !!result.isError });
		return result;
	} catch (e) {
		timer.end({ userId: ctx.user.id, isError: true });
		if (e instanceof ToolError || e instanceof ReviewActionError) return errorResult(e.message);
		if (isHttpError(e)) return errorResult(e.body.message);
		if (e instanceof ProtocolError) {
			return errorResult(`The program's master endpoint refused: ${e.displayMessage}`);
		}
		if (e instanceof ProtocolTransportError) return errorResult(e.message);
		if (e instanceof HackatimeRateLimitError) {
			return errorResult('Hackatime is rate limiting Sidekick; wait half a minute and try again.');
		}
		log.error(`tool ${name} failed`, e, { userId: ctx.user.id });
		if (e instanceof TypeError && e.message === 'fetch failed') {
			return errorResult(
				`${name} could not reach an upstream service (Hackatime, GitHub, Airtable or Lapse). Try again in a moment.`
			);
		}
		return errorResult(`${name} failed unexpectedly (${e instanceof Error ? e.name : 'error'}).`);
	}
}
