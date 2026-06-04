import type { SessionUser, ProgramSummary } from '$lib/types.js';

declare global {
	namespace App {
		interface Locals {
			user: SessionUser | null;
		}
		
		interface PageData {
			user: SessionUser | null;
			programs: ProgramSummary[];
		}
	}
}

export {};
