import type { CheckDefinition } from '../types.js';

export const D1: CheckDefinition = {
	id: 'D1',
	family: 'deterministic',
	description: 'Required fields present',
	severity: 'fail',
	async evaluate(ctx) {
		const missing: string[] = [];

		if (!ctx.project.title?.trim()) missing.push('title');
		if (!ctx.project.description?.trim()) missing.push('description');
		if (!ctx.project.demoUrl?.trim()) missing.push('demoUrl');
		if (!ctx.project.codeUrl?.trim()) missing.push('codeUrl');

		if (missing.length > 0) {
			return {
				pass: false,
				summary: `Missing required fields: ${missing.join(', ')}`,
				details: { missingFields: missing }
			};
		}

		return {
			pass: true,
			summary: 'All required fields are present'
		};
	}
};
