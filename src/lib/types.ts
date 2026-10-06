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

/** A user currently viewing a review page (see `$lib/server/presence`). */
export interface PresenceViewer {
	id: string;
	name: string;
	avatarUrl: string | null;
}

export interface ProgramSummary {
	id: string;
	name: string;
	iconUrl: string | null;
	description: string | null;
	isMember: boolean;
	isPinned: boolean;
}
