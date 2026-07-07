const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(id: string): boolean {
	return UUID_RE.test(id);
}

/**
 * Shortens UUIDs to their first 8 hex characters, like an abbreviated commit SHA.
 * Non-UUID IDs are returned unchanged.
 */
export function shortenId(id: string): string {
	return isUuid(id) ? id.slice(0, 8) : id;
}
