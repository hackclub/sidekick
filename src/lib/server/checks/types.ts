import type { Project, Ship, TimelineEvent } from '../protocol/types.js';

export type CheckFamily = 'deterministic' | 'hackatime' | 'github' | 'airtable';
export type CheckSeverity = 'info' | 'warn' | 'fail' | 'critical';

export interface CheckResult {
	pass: boolean;
	summary: string;
	details?: Record<string, unknown>;
}

export interface CheckContext {
	project: Project;
	ship: Ship;
	timeline: TimelineEvent[];
	hackatime: {
		username: string;
		totalSeconds: number;
		aiSeconds: number;
		projectKeys: string[];
		trustLevel: string | null;
	} | null;
	github: {
		owner: string;
		repo: string;
		commits: Array<{
			sha: string;
			message: string;
			date: string;
			files: Array<{ filename: string }>;
		}>;
		readmeContent: string | null;
		isPublic: boolean;
	} | null;
	airtable: {
		existingRecords: Array<{
			playableUrl: string;
			codeUrl: string;
			hoursSpent: number;
		}>;
		totalPreviousHours: number;
	} | null;
}

export interface CheckDefinition {
	id: string;
	family: CheckFamily;
	description: string;
	severity: CheckSeverity;
	evaluate(ctx: CheckContext): Promise<CheckResult>;
}
