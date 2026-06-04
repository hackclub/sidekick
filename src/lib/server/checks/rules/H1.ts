import type { CheckDefinition } from '../types.js';
import { getUserHeartbeats } from '../../integrations/hackatime.js';

function sampleDates(isoDates: string[], count: number): string[] {
	const unique = [...new Set(isoDates.map((d) => d.slice(0, 10)))].sort();
	if (unique.length === 0) return [];
	if (unique.length <= count) return unique;
	const step = (unique.length - 1) / (count - 1);
	return Array.from({ length: count }, (_, i) => unique[Math.round(i * step)]);
}

function entityMatchesRepo(entity: string, repoFiles: Set<string>): boolean {
	const normalized = entity.replace(/\\/g, '/');
	for (const repoFile of repoFiles) {
		if (normalized.endsWith('/' + repoFile) || normalized === repoFile) {
			return true;
		}
	}
	return false;
}

export const H1: CheckDefinition = {
	id: 'H1',
	family: 'hackatime',
	description: 'No unrelated Hackatime projects',
	severity: 'warn',
	async evaluate(ctx) {
		if (!ctx.hackatime || !ctx.github || ctx.hackatime.projectKeys.length === 0) {
			return {
				pass: true,
				summary: 'Skipped: missing Hackatime or GitHub data',
				details: { skipped: true }
			};
		}

		const repoFiles = new Set<string>();
		for (const commit of ctx.github.commits) {
			for (const file of commit.files) {
				repoFiles.add(file.filename);
			}
		}

		if (repoFiles.size === 0) {
			return {
				pass: true,
				summary: 'Skipped: no file data in commits',
				details: { skipped: true }
			};
		}

		const commitDates = ctx.github.commits.map((c) => c.date);
		const dates = sampleDates(commitDates, 5);

		const allHeartbeats: Array<{ entity: string; project: string }> = [];
		for (const date of dates) {
			try {
				const hbs = await getUserHeartbeats(ctx.hackatime.username, date);
				allHeartbeats.push(...hbs);
			} catch {
				// Date may have no heartbeats
			}
		}

		if (allHeartbeats.length === 0) {
			return {
				pass: true,
				summary: 'Skipped: no heartbeats found for sampled dates',
				details: { skipped: true, sampledDates: dates }
			};
		}

		const validKeys = ctx.hackatime.projectKeys.filter((k): k is string => !!k);
		const keySet = new Set(validKeys.map((k) => k.toLowerCase()));
		const hbsByProject = new Map<string, typeof allHeartbeats>();
		for (const hb of allHeartbeats) {
			if (!hb.project) continue;
			const key = hb.project.toLowerCase();
			if (!keySet.has(key)) continue;
			if (!hbsByProject.has(key)) hbsByProject.set(key, []);
			hbsByProject.get(key)!.push(hb);
		}

		const unrelated: string[] = [];
		for (const projectKey of validKeys) {
			const hbs = hbsByProject.get(projectKey.toLowerCase()) ?? [];
			if (hbs.length === 0) continue;

			const hasMatch = hbs.some((hb) => hb.entity && entityMatchesRepo(hb.entity, repoFiles));
			if (!hasMatch) {
				unrelated.push(projectKey);
			}
		}

		if (unrelated.length > 0) {
			return {
				pass: false,
				summary: `Potentially unrelated Hackatime project${unrelated.length > 1 ? 's' : ''}: ${unrelated.join(', ')}`,
				details: { unrelated, totalHeartbeats: allHeartbeats.length, repoFileCount: repoFiles.size }
			};
		}

		return {
			pass: true,
			summary: 'All Hackatime projects have heartbeats matching repo files',
			details: { projectCount: ctx.hackatime.projectKeys.length, sampledHeartbeats: allHeartbeats.length }
		};
	}
};
