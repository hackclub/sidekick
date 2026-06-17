import type { CheckDefinition } from '../types.js';

export const H1: CheckDefinition = {
	id: 'H1',
	family: 'hackatime',
	description: 'Not Hackatime banned',
	severity: 'critical',
	async evaluate(ctx) {
		if (!ctx.hackatime) {
			return {
				pass: true,
				summary: 'Skipped: no Hackatime data available',
				details: { skipped: true }
			};
		}

		if (!ctx.hackatime.trustLevel) {
			return {
				pass: true,
				summary: 'Skipped: trust level unknown',
				details: { skipped: true }
			};
		}

		if (ctx.hackatime.trustLevel.toLowerCase() === 'red') {
			return {
				pass: false,
				summary: `User Hackatime trust level is red (banned)`,
				details: { trustLevel: ctx.hackatime.trustLevel }
			};
		}

		return {
			pass: true,
			summary: `Hackatime trust level: ${ctx.hackatime.trustLevel}`,
			details: { trustLevel: ctx.hackatime.trustLevel }
		};
	}
};
