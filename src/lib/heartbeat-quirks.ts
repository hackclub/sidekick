export interface QuirkRule {
	name: string;
	userAgentMatch: string;
	match: (hb: { lines: number; cursorpos: number; lineno: number; user_agent: string }) => boolean;
}

export const QUIRK_RULES: QuirkRule[] = [
	{
		name: 'unity-hackatime',
		userAgentMatch: 'unity-hackatime',
		match: (hb) =>
			hb.user_agent.toLowerCase().includes('unity-hackatime') &&
			hb.lines === 0 &&
			hb.cursorpos === 0 &&
			hb.lineno === 0
	}
];

export function isQuirkHeartbeat(hb: {
	lines: number;
	cursorpos: number;
	lineno: number;
	user_agent: string;
}): boolean {
	return QUIRK_RULES.some((rule) => rule.match(hb));
}
