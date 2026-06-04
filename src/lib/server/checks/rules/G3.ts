import type { CheckDefinition } from '../types.js';

export const G3: CheckDefinition = {
	id: 'G3',
	family: 'github',
	description: 'Re-ship has changes',
	severity: 'fail',
	async evaluate(ctx) {
		const approvals = ctx.timeline
			.filter((e) => e.type === 'approval')
			.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

		if (approvals.length === 0) {
			return {
				pass: true,
				summary: 'First ship — no prior approval to compare against'
			};
		}

		if (!ctx.github) {
			return {
				pass: true,
				summary: 'Skipped: no GitHub data available',
				details: { skipped: true }
			};
		}

		const lastApprovalDate = new Date(approvals[0].timestamp);

		const commitsAfter = ctx.github.commits.filter(
			(c) => new Date(c.date) > lastApprovalDate
		);

		if (commitsAfter.length === 0) {
			return {
				pass: false,
				summary: `No commits found after last approval (${lastApprovalDate.toISOString().slice(0, 10)})`,
				details: {
					lastApproval: approvals[0].timestamp,
					totalCommits: ctx.github.commits.length
				}
			};
		}

		return {
			pass: true,
			summary: `${commitsAfter.length} commit${commitsAfter.length !== 1 ? 's' : ''} after last approval`,
			details: {
				commitsAfterApproval: commitsAfter.length,
				lastApproval: approvals[0].timestamp,
				latestCommit: commitsAfter[0].date
			}
		};
	}
};
