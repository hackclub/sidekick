import type { CheckDefinition } from '../types.js';

export const G1: CheckDefinition = {
	id: 'G1',
	family: 'github',
	description: 'Repository is public',
	severity: 'fail',
	async evaluate(ctx) {
		if (!ctx.github) {
			return {
				pass: true,
				summary: 'Skipped: no GitHub data available',
				details: { skipped: true }
			};
		}

		if (!ctx.github.isPublic) {
			return {
				pass: false,
				summary: `Repository ${ctx.github.owner}/${ctx.github.repo} is not public`,
				details: { owner: ctx.github.owner, repo: ctx.github.repo, isPublic: false }
			};
		}

		return {
			pass: true,
			summary: `Repository ${ctx.github.owner}/${ctx.github.repo} is public`
		};
	}
};
