// ============================================================================
// Project Details Export Schema
// ============================================================================
// Shape of the JSON produced by the "Copy JSON" button on the review page
// (ProjectCard). This is the canonical schema other tooling / agents should
// reference when consuming an exported project review payload.
//
// The export is assembled client-side in the review page from the data the
// reviewer currently sees. Integration sections (hackatime / github / airtable
// / lapse) load asynchronously, so each is `null` until its source resolves —
// a payload copied early may legitimately have nulls there.
// ============================================================================

import type { TimelineEvent } from '$lib/server/protocol/types.js';

/** Bump when the shape below changes in a backwards-incompatible way. */
export const PROJECT_DETAILS_EXPORT_SCHEMA_VERSION = 1;

export interface ProjectDetailsExport {
	/** Matches PROJECT_DETAILS_EXPORT_SCHEMA_VERSION at the time of export. */
	schemaVersion: number;
	/** ISO 8601 timestamp of when the payload was copied. */
	exportedAt: string;
	program: ProjectExportProgram;
	project: ProjectExportProject;
	author: ProjectExportAuthor;
	ships: ProjectExportShip[];
	/** ID of the ship currently awaiting review, or null if none is pending. */
	pendingShipId: string | null;
	/** Full review timeline (ships, approvals, rejections, comments, …). */
	timeline: TimelineEvent[];
	/** Hackatime coding stats, or null if unavailable / not yet loaded. */
	hackatime: ProjectExportHackatime | null;
	/** GitHub repository data, or null if unavailable / not yet loaded. */
	github: ProjectExportGithub | null;
	/** Matched Airtable YSWS records, or null if unavailable / not yet loaded. */
	airtable: ProjectExportAirtable | null;
	/** Lapse timelapses, or null if unavailable / not yet loaded. */
	lapse: ProjectExportLapse | null;
}

export interface ProjectExportProgram {
	id: string;
	name: string;
}

export interface ProjectExportProject {
	id: string;
	title: string;
	description: string;
	screenshotUrl: string | null;
	demoUrl: string | null;
	codeUrl: string;
	hackatimeProjectKeys: string[];
}

export interface ProjectExportAuthor {
	name: string;
	email: string | null;
	avatarUrl: string | null;
	slackId: string | null;
	hackatimeId: string | null;
	/** Human-readable join date label (e.g. "Joined 3mo ago"). */
	joinDate: string;
}

export interface ProjectExportShip {
	id: string;
	hoursSubmitted: number;
	/** ISO 8601 submission timestamp. */
	submittedAt: string;
	status: 'pending' | 'pending_hq' | 'approved' | 'rejected';
}

export interface ProjectExportHackatime {
	/** Total tracked coding time across the project's hackatime keys. */
	totalSeconds: number;
	/** Portion of `totalSeconds` attributed to AI-assisted coding. */
	aiSeconds: number;
	trustLevel: string | null;
	/** Per-hackatime-project time breakdown. */
	projectBreakdown: { name: string; totalSeconds: number }[];
}

export interface ProjectExportGithubCommit {
	sha: string;
	message: string;
	author: string;
	authorAvatarUrl: string | null;
	/** ISO 8601 commit date. */
	date: string;
}

export interface ProjectExportGithub {
	isPublic: boolean;
	readme: string | null;
	commits: ProjectExportGithubCommit[];
}

export interface ProjectExportAirtableRecord {
	id: string;
	url: string;
	hours: number;
	approvedAt: string | null;
	playableUrl: string | null;
	codeUrl: string | null;
	/** True when repo + demo + author name all matched this record. */
	isExact: boolean;
}

export interface ProjectExportAirtable {
	records: ProjectExportAirtableRecord[];
	/** Sum of hours from exact-match records (previously-counted hours). */
	previousHours: number;
}

export interface ProjectExportLapseEntry {
	id: string;
	name: string;
	description: string;
	visibility: string;
	thumbnailUrl: string | null;
	playbackUrl: string | null;
	duration: number;
	createdAt: number;
	ownerHandle: string;
	hackatimeProject: string | null;
}

export interface ProjectExportLapse {
	timelapses: ProjectExportLapseEntry[];
}
