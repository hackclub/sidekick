import { Save, Sparkles, History } from 'lucide-svelte';
import type { HistorySourceKind } from './localHistory.js';

export const HISTORY_KIND_STYLE = {
	save: { icon: Save, color: '#0d9488', label: 'Save' },
	ai: { icon: Sparkles, color: '#a855f7', label: 'AI chat edit' },
	other: { icon: History, color: '#64748b', label: 'Edit' }
} as const satisfies Record<HistorySourceKind, unknown>;
