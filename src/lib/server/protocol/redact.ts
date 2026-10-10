import type { Project } from './types.js';

// A project's `authorHcaName` is the author's real name from Hack Club Auth.
// Only members with canViewHeartbeats (HQ and fraud reviewers) may see it, so
// strip it from projects before they're sent to anyone else's browser.
export function redactAuthorIdentity(project: Project): Project {
	return project.authorHcaName === undefined ? project : { ...project, authorHcaName: undefined };
}
