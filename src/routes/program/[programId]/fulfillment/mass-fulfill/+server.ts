import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { requirePermission } from '$lib/server/rbac.js';
import { ProtocolClient, ProtocolError } from '$lib/server/protocol/client.js';
import { createLogger } from '$lib/server/logger.js';
import type { RequestHandler } from './$types.js';
import type { Order, RevealOrderAddressOutput } from '$lib/server/protocol/types.js';

const logger = createLogger('api:mass-fulfill');

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Not authenticated');

	const membership = await requirePermission(user.id, params.programId, 'canUpdateFulfillments', {
		isSuperAdmin: user.isSuperAdmin
	});

	if (!membership.canViewAddressData) {
		throw error(403, 'You do not have permission to view address data.');
	}

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});

	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);
	const body = await request.json();

	if (body.action === 'match') {
		logger.info('POST mass-fulfill match', { programId: params.programId, recordCount: body.records?.length ?? 0 });
		return handleMatch(client, body.records);
	} else if (body.action === 'execute') {
		logger.info('POST mass-fulfill execute', { programId: params.programId, matchCount: body.matches?.length ?? 0 });
		return handleExecute(client, params.programId, user.id, body.matches);
	}

	throw error(400, 'Invalid action');
};

// ---------------------------------------------------------------------------
// Fuzzy matching utilities
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const curr = [i];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
		}
		prev = curr;
	}

	return prev[b.length];
}

function extractNamePortion(text: string): string {
	const words = text.split(/\s+/);
	const nameWords: string[] = [];
	for (const word of words) {
		if (/\d/.test(word)) break;
		nameWords.push(word);
		if (nameWords.length >= 5) break;
	}
	return nameWords.join(' ');
}

function matchScore(letterText: string, addressName: string): number {
	const normText = letterText.toLowerCase().trim();
	const normName = addressName.toLowerCase().trim();
	if (!normName) return 0;

	// Tier 1: text starts with address name
	if (normText.startsWith(normName)) return 100;

	const textWords = normText.split(/\s+/).slice(0, 8);
	const nameWords = normName.split(/\s+/);

	// Tier 2: all name words found in first N text words
	if (nameWords.length > 0 && nameWords.every(nw => textWords.some(tw => tw === nw))) return 80;

	// Tier 3: Levenshtein on extracted name portion vs address name
	const extracted = extractNamePortion(normText);
	if (extracted) {
		const dist = levenshtein(extracted, normName);
		const maxLen = Math.max(extracted.length, normName.length);
		const sim = maxLen > 0 ? 1 - dist / maxLen : 0;
		if (sim >= 0.6) return Math.round(30 + sim * 40);
	}

	// Tier 4: first name exact match
	if (nameWords.length > 0 && textWords.length > 0 && textWords[0] === nameWords[0]) return 35;

	// Tier 5: first name fuzzy match
	if (nameWords.length > 0 && textWords.length > 0) {
		const d = levenshtein(textWords[0], nameWords[0]);
		const m = Math.max(textWords[0].length, nameWords[0].length);
		if (m > 0 && (1 - d / m) >= 0.7) return 25;
	}

	return 0;
}

function scoreToConfidence(score: number): 'high' | 'medium' | 'low' {
	if (score >= 80) return 'high';
	if (score >= 50) return 'medium';
	return 'low';
}

// ---------------------------------------------------------------------------
// Match handler
// ---------------------------------------------------------------------------

interface MatchRecord {
	letterId: string;
	fullText: string;
}

interface OrderWithAddress {
	order: Order;
	addressName: string;
}

async function handleMatch(client: ProtocolClient, records: MatchRecord[]) {
	const allOrders: Order[] = [];
	let cursor: string | undefined;
	do {
		const result = await client.fetchOrders({
			status: 'pending',
			cursor,
			limit: 50,
		});
		allOrders.push(...result.orders);
		cursor = result.nextCursor;
	} while (cursor);

	// Reveal addresses for all pending orders
	const ordersWithAddress: OrderWithAddress[] = [];
	for (const order of allOrders) {
		let address: RevealOrderAddressOutput | null = null;
		try {
			address = await client.revealOrderAddress({ orderId: order.id });
		} catch (e) {
			if (!(e instanceof ProtocolError)) throw e;
		}

		const firstName = (address?.firstName ?? '').trim();
		const lastName = (address?.lastName ?? '').trim();
		const addressName = [firstName, lastName].filter(Boolean).join(' ');

		ordersWithAddress.push({ order, addressName: addressName || order.userName });
	}

	const rows: {
		letterId: string;
		letterName: string;
		orderId: string | null;
		orderUserName: string | null;
		orderAddressName: string | null;
		confidence: 'high' | 'medium' | 'low' | null;
	}[] = [];

	const matchedOrderIds = new Set<string>();

	for (const record of records) {
		const letterName = extractNamePortion(record.fullText.trim()) || record.fullText.trim().split(/\s+/).slice(0, 3).join(' ');

		let bestEntry: OrderWithAddress | null = null;
		let bestScore = 0;

		for (const entry of ordersWithAddress) {
			if (matchedOrderIds.has(entry.order.id)) continue;
			const score = matchScore(record.fullText, entry.addressName);
			if (score > bestScore) {
				bestScore = score;
				bestEntry = entry;
			}
		}

		const MIN_SCORE = 25;
		if (bestEntry && bestScore >= MIN_SCORE) {
			matchedOrderIds.add(bestEntry.order.id);
			rows.push({
				letterId: record.letterId,
				letterName,
				orderId: bestEntry.order.id,
				orderUserName: bestEntry.order.userName,
				orderAddressName: bestEntry.addressName,
				confidence: scoreToConfidence(bestScore)
			});
		} else {
			rows.push({
				letterId: record.letterId,
				letterName,
				orderId: null,
				orderUserName: null,
				orderAddressName: null,
				confidence: null
			});
		}
	}

	const availableOrders = ordersWithAddress.map(e => ({
		id: e.order.id,
		userName: e.order.userName,
		addressName: e.addressName
	}));

	logger.info('Match completed', { totalRecords: records.length, matchedCount: rows.filter(r => r.orderId).length, availableOrders: availableOrders.length });
	return json({ rows, availableOrders });
}

// ---------------------------------------------------------------------------
// Execute handler
// ---------------------------------------------------------------------------

interface ExecuteMatch {
	orderId: string;
	letterId: string;
	reference: string;
}

async function handleExecute(
	client: ProtocolClient,
	programId: string,
	userId: string,
	matches: ExecuteMatch[]
) {
	let fulfilled = 0;
	const errors: { orderId: string; error: string }[] = [];

	for (const match of matches) {
		try {
			await client.updateOrderStatus({
				orderId: match.orderId,
				newStatus: 'fulfilled',
				reference: match.reference
			});

			await db.auditLog.create({
				data: {
					programId,
					userId,
					action: 'order_status_change',
					entityType: 'order',
					entityId: match.orderId,
					metadata: {
						status: 'fulfilled',
						reference: match.reference,
						source: 'mass-fulfill-theseus'
					}
				}
			});

			fulfilled++;
		} catch (e) {
			errors.push({
				orderId: match.orderId,
				error: e instanceof Error ? e.message : 'Unknown error'
			});
		}
	}

	logger.info('Execute completed', { fulfilled, errorCount: errors.length });
	return json({ fulfilled, errors });
}
