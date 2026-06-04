import type { CheckDefinition } from '../types.js';

export const AT1: CheckDefinition = {
	id: 'AT1',
	family: 'airtable',
	description: 'Not double-dipped',
	severity: 'fail',
	async evaluate(ctx) {
		if (!ctx.airtable || !ctx.hackatime) {
			return {
				pass: true,
				summary: 'Skipped: missing Airtable or Hackatime data',
				details: { skipped: true }
			};
		}

		if (ctx.airtable.totalPreviousHours <= 0) {
			return {
				pass: true,
				summary: 'No previous hours claimed'
			};
		}

		const totalHours = ctx.hackatime.totalSeconds / 3600;
		const aiHours = ctx.hackatime.aiSeconds / 3600;
		const netNewHours = totalHours - aiHours - ctx.airtable.totalPreviousHours;

		if (netNewHours <= 0) {
			return {
				pass: false,
				summary: `All hours already claimed (${ctx.airtable.totalPreviousHours.toFixed(1)}h previous, ${totalHours.toFixed(1)}h total, ${aiHours.toFixed(1)}h AI)`,
				details: {
					totalHours,
					aiHours,
					previousHours: ctx.airtable.totalPreviousHours,
					netNewHours
				}
			};
		}

		return {
			pass: true,
			summary: `${netNewHours.toFixed(1)} net new hours available after deducting ${ctx.airtable.totalPreviousHours.toFixed(1)}h previous claims`,
			details: {
				totalHours,
				aiHours,
				previousHours: ctx.airtable.totalPreviousHours,
				netNewHours
			}
		};
	}
};
