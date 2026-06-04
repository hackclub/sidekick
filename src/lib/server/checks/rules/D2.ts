import type { CheckDefinition } from '../types.js';

function isValidHttpUrl(url: string): boolean {
	return url.startsWith('http://') || url.startsWith('https://');
}

export const D2: CheckDefinition = {
	id: 'D2',
	family: 'deterministic',
	description: 'Valid URLs',
	severity: 'fail',
	async evaluate(ctx) {
		const invalid: string[] = [];

		if (ctx.project.demoUrl && !isValidHttpUrl(ctx.project.demoUrl)) {
			invalid.push(`demoUrl (${ctx.project.demoUrl})`);
		}

		if (ctx.project.codeUrl && !isValidHttpUrl(ctx.project.codeUrl)) {
			invalid.push(`codeUrl (${ctx.project.codeUrl})`);
		}

		if (invalid.length > 0) {
			return {
				pass: false,
				summary: `Invalid URLs: ${invalid.join(', ')}`,
				details: { invalidUrls: invalid }
			};
		}

		return {
			pass: true,
			summary: 'All URLs are valid HTTP(S) links'
		};
	}
};
