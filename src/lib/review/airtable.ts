/**
 * A record in the unified YSWS Airtable matched against the project under
 * review. Built by the review page's server load — carries no PII.
 */
export interface AirtableMatch {
	/** Airtable's own record id (`rec…`) — unique per record. */
	recordId: string;
	/** Program the record was submitted to, e.g. "Hackpad". */
	program: string;
	/** Canonical Airtable link; null unless the viewer can authorize reviews. */
	url: string | null;
	hours: number;
	approvedAt: string | null;
	createdAt: string | null;
	playableUrl: string | null;
	codeUrl: string | null;
	description: string | null;
	screenshotUrl: string | null;
	overrideHours: number | null;
	overrideHoursJustification: string | null;
	isExact: boolean;
	mismatches: string[];
}
