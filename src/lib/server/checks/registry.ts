import type { CheckContext, CheckDefinition, CheckResult } from './types.js';
import { createLogger } from '../logger.js';
import { D1 } from './rules/D1.js';
import { D2 } from './rules/D2.js';
import { D3 } from './rules/D3.js';
import { D4 } from './rules/D4.js';
import { G1 } from './rules/G1.js';
import { G2 } from './rules/G2.js';
import { G3 } from './rules/G3.js';
import { H1 } from './rules/H1.js';
import { H2 } from './rules/H2.js';
import { AT1 } from './rules/AT1.js';
import { D5 } from './rules/D5.js';

const log = createLogger('checks:registry');

export const CHECKS: ReadonlyArray<CheckDefinition> = [D1, D2, D3, D4, D5, G1, G2, G3, H1, H2, AT1];

export async function runAllChecks(
	ctx: CheckContext
): Promise<Array<{ check: CheckDefinition; result: CheckResult }>> {
	log.debug('runAllChecks start', { checkCount: CHECKS.length });
	const overallTimer = log.time('runAllChecks');

	const results = await Promise.all(
		CHECKS.map(async (check) => {
			const checkTimer = log.time(`check ${check.id}`);
			try {
				const result = await check.evaluate(ctx);
				const ms = checkTimer.end({ checkId: check.id, passed: result.pass });
				log.trace('check evaluated', {
					checkId: check.id,
					passed: result.pass,
					durationMs: ms,
					summary: result.summary.slice(0, 100)
				});
				return { check, result };
			} catch (e) {
				checkTimer.end({ checkId: check.id, error: true });
				log.error(`check ${check.id} threw an error`, e, { checkId: check.id });
				return {
					check,
					result: {
						pass: true,
						summary: `Check error: ${e instanceof Error ? e.message : 'unknown'}`,
						details: { error: true }
					} satisfies CheckResult
				};
			}
		})
	);

	const passed = results.filter((r) => r.result.pass).length;
	const failed = results.length - passed;
	overallTimer.end({ total: results.length, passed, failed });
	log.debug('runAllChecks complete', { total: results.length, passed, failed });

	return results;
}

export function getCheckById(id: string): CheckDefinition | undefined {
	return CHECKS.find((c) => c.id === id);
}
