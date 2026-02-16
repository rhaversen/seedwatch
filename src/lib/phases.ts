export const OVERHEAD_PHASES = new Set(['memory', 'summarizer'])

export const phaseColors: Record<string, string> = {
	planner:    '#3b82f6',
	builder:    '#22c55e',
	fixer:      '#ef4444',
	reflect:    '#f59e0b',
	memory:     '#a855f7',
	summarizer: '#f472b6',
}

export const phaseIcons: Record<string, string> = {
	planner:    '🧭',
	builder:    '🔧',
	fixer:      '🩹',
	reflect:    '🪞',
	memory:     '🧠',
	summarizer: '🗜️',
}
