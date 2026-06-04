import { writable } from 'svelte/store';
import type { ProgramSummary } from '$lib/types.js';

export const currentProgram = writable<ProgramSummary | null>(null);
