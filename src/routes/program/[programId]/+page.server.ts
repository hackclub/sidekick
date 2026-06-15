import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { ProtocolClient } from '$lib/server/protocol/client.js';
import { createLogger } from '$lib/server/logger.js';
import type { PageServerLoad } from './$types.js';

const log = createLogger('page:dashboard');

export const load: PageServerLoad = async ({ params, parent }) => {
	const tLoad = log.time('load');
	const { user } = await parent();
	if (!user) throw redirect(302, '/auth/login');

	const program = await db.program.findUniqueOrThrow({
		where: { id: params.programId }
	});

	const client = new ProtocolClient(program.masterEndpoint, program.secretKey);

	const stats = await client.getProgramStats({});

	const now = new Date();
	const weekAgo = new Date(now.getTime() - 7 * 86400000);
	const twelveWeeksAgo = new Date(now.getTime() - 12 * 7 * 86400000);

	const [fulfillmentLogs, reviewLogs] = await Promise.all([
		db.auditLog.findMany({
			where: {
				programId: params.programId,
				action: { in: ['order_status_change', 'order_fields_update'] }
			},
			include: { user: true },
			orderBy: { createdAt: 'desc' },
			take: 500
		}),
		db.auditLog.findMany({
			where: {
				programId: params.programId,
				action: { startsWith: 'review_' }
			},
			include: { user: true },
			orderBy: { createdAt: 'desc' },
			take: 500
		})
	]);

	const fulfillmentLogsByUser = aggregateByUser(
		fulfillmentLogs.filter((l) => l.createdAt >= weekAgo)
	);
	const fulfillmentLogsAllTime = aggregateByUser(fulfillmentLogs);
	const reviewLogsByUser = aggregateByUser(
		reviewLogs.filter((l) => l.createdAt >= weekAgo)
	);
	const reviewLogsAllTime = aggregateByUser(reviewLogs);

	const fulfillmentVolume = buildWeeklyVolume(fulfillmentLogs, twelveWeeksAgo, now);
	const reviewVolume = buildWeeklyVolume(reviewLogs, twelveWeeksAgo, now);

	log.info('dashboard data loaded', {
		programId: params.programId,
		pendingReviewCount: stats.pendingReviewCount,
		pendingFulfillmentCount: stats.pendingFulfillmentCount,
		fulfillmentLogCount: fulfillmentLogs.length,
		reviewLogCount: reviewLogs.length
	});
	tLoad.end();

	return {
		pendingReviewCount: stats.pendingReviewCount,
		pendingFulfillmentCount: stats.pendingFulfillmentCount,
		fulfillmentLeaderboardWeekly: fulfillmentLogsByUser,
		fulfillmentLeaderboardAllTime: fulfillmentLogsAllTime,
		reviewLeaderboardWeekly: reviewLogsByUser,
		reviewLeaderboardAllTime: reviewLogsAllTime,
		fulfillmentVolume,
		reviewVolume,
		recentFulfillments: fulfillmentLogs.slice(0, 6).map((l) => ({
			userName: l.user.name,
			userAvatarUrl: l.user.avatarUrl,
			action: l.action,
			entityId: l.entityId,
			metadata: l.metadata as Record<string, unknown> | null,
			createdAt: l.createdAt.toISOString()
		})),
		recentReviews: reviewLogs.slice(0, 6).map((l) => ({
			userName: l.user.name,
			userAvatarUrl: l.user.avatarUrl,
			action: l.action,
			entityId: l.entityId,
			metadata: l.metadata as Record<string, unknown> | null,
			createdAt: l.createdAt.toISOString()
		}))
	};
};

function aggregateByUser(
	logs: Array<{ user: { name: string; avatarUrl: string | null } }>
): Array<{ username: string; avatarUrl: string | null; value: number }> {
	const map = new Map<string, { avatarUrl: string | null; count: number }>();
	for (const log of logs) {
		const existing = map.get(log.user.name);
		if (existing) {
			existing.count++;
		} else {
			map.set(log.user.name, { avatarUrl: log.user.avatarUrl, count: 1 });
		}
	}
	return Array.from(map.entries())
		.map(([username, { avatarUrl, count }]) => ({ username, avatarUrl, value: count }))
		.sort((a, b) => b.value - a.value);
}

function buildWeeklyVolume(
	logs: Array<{ createdAt: Date }>,
	start: Date,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	_end: Date
): number[] {
	const weeks: number[] = new Array(12).fill(0);
	const startMs = start.getTime();
	const weekMs = 7 * 86400000;
	for (const log of logs) {
		const logMs = log.createdAt.getTime();
		if (logMs < startMs) continue;
		const weekIndex = Math.min(Math.floor((logMs - startMs) / weekMs), 11);
		weeks[weekIndex]++;
	}
	return weeks;
}
