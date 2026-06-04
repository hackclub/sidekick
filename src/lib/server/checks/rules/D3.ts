import type { CheckDefinition } from '../types.js';
import { checkReachable } from '../reachable.js';

export const D3: CheckDefinition = {
	id: 'D3',
	family: 'deterministic',
	description: 'Repository URL reachable',
	severity: 'fail',
	async evaluate(ctx) {
		const url = ctx.project.codeUrl?.trim();
		if (!url) {
			return { pass: false, summary: 'No code URL provided' };
		}

		const result = await checkReachable(url);
		if (result.ok) {
			const summary = result.note
				? `Repository URL ${result.note}`
				: `Repository URL returns ${result.status}`;
			return { pass: true, summary };
		}
		return {
			pass: false,
			summary: `Repository URL returns ${result.status} ${result.statusText}`,
			details: { status: result.status }
		};
	}
};
