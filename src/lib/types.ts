export interface SessionUser {
	id: string;
	hcaId: string;
	email: string;
	name: string;
	avatarUrl: string | null;
	slackId: string | null;
	hackatimeId: string | null;
	isSuperAdmin: boolean;
	isProgramAuthor: boolean;
}

export interface ProgramSummary {
	id: string;
	name: string;
	iconUrl: string | null;
	description: string | null;
}
