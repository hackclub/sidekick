import type { CheckDefinition } from '../types.js';

export const D5: CheckDefinition = {
	id: 'D5',
	family: 'deterministic',
	description: 'Identity verification status',
	severity: 'fail',
	async evaluate(ctx) {
		const authorId = ctx.project.authorId;
		if (!authorId.startsWith('U')) {
			return {
				pass: false,
				summary: 'Cannot check IDV: author does not have a Slack ID',
				details: { authorId, result: 'no_slack_id' }
			};
		}

		try {
			const res = await fetch(
				`https://auth.hackclub.com/api/external/check?slack_id=${encodeURIComponent(authorId)}`,
				{ signal: AbortSignal.timeout(10000) }
			);

			if (!res.ok) {
				return {
					pass: true,
					summary: `IDV check unavailable (HTTP ${res.status})`,
					details: { status: res.status }
				};
			}

			const data = await res.json();
			const result = data.result as string;

			const labels: Record<string, string> = {
				verified_eligible: 'Verified and eligible',
				verified_but_over_18: 'Verified but over 18',
				needs_submission: 'Has not started verification',
				pending: 'Verification is being reviewed',
				rejected: 'Verification was rejected',
				not_found: 'No user found'
			};

			if (result === 'verified_eligible') {
				return {
					pass: true,
					summary: labels[result],
					details: { result }
				};
			}

			return {
				pass: false,
				summary: labels[result] ?? `Unknown IDV status: ${result}`,
				details: { result }
			};
		} catch (e) {
			return {
				pass: true,
				summary: `IDV check error: ${e instanceof Error ? e.message : 'unknown'}`,
				details: { error: true }
			};
		}
	}
};
