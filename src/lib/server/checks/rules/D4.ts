import type { CheckDefinition } from '../types.js';
import { checkReachable } from '../reachable.js';

const DISALLOWED_HOSTS = [
	'colab.research.google.com',
	'colab.google.com',
	'kaggle.com',
	'www.kaggle.com',
	'mybinder.org',
	'binder.org',
	'notebooks.gesis.org',
	'leetcode.com',
	'www.leetcode.com'
];

export const D4: CheckDefinition = {
	id: 'D4',
	family: 'deterministic',
	description: 'Demo URL valid',
	severity: 'fail',
	async evaluate(ctx) {
		const url = ctx.project.demoUrl?.trim();
		if (!url) {
			return { pass: false, summary: 'No demo URL provided' };
		}

		try {
			const parsed = new URL(url);
			const host = parsed.hostname.toLowerCase();

			for (const disallowed of DISALLOWED_HOSTS) {
				if (host === disallowed || host.endsWith('.' + disallowed)) {
					return {
						pass: false,
						summary: `Demo URL points to disallowed platform: ${disallowed}`,
						details: { host, disallowed }
					};
				}
			}
		} catch {
			return {
				pass: false,
				summary: 'Demo URL is not a valid URL',
				details: { url }
			};
		}

		const result = await checkReachable(url);
		if (result.ok) {
			const summary = result.note
				? `Demo URL ${result.note}`
				: `Demo URL returns ${result.status}`;
			return { pass: true, summary };
		}
		return {
			pass: false,
			summary: `Demo URL returns ${result.status} ${result.statusText}`,
			details: { status: result.status }
		};
	}
};
