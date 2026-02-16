'use client'

import type { GeneratedTurn as Turn } from '@/lib/data'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = Record<string, any>

interface BatchEntry {
	toolName: string
	toolUseId: string
	inputHint: string
	originalChars: number
	result: 'kept' | 'summarized' | 'error'
	summaryChars: number | null
	summaryPreview: string | null
	cost: number
	inputTokens: number
	outputTokens: number
}

function parseBatchEntry(turn: Turn): BatchEntry {
	const messages = turn.messages as AnyBlock[]
	const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
	const userText = typeof lastUserMsg?.content === 'string'
		? lastUserMsg.content
		: Array.isArray(lastUserMsg?.content)
			? lastUserMsg.content.map((b: AnyBlock) => b.text ?? '').join('')
			: ''

	const idMatch = userText.match(/tool_use_id="([^"]+)"/)
	const toolUseId = idMatch?.[1] ?? ''

	const nameMatch = userText.match(/\((\w+)/)
	const toolName = nameMatch?.[1] ?? 'unknown'

	const hintMatch = userText.match(/\(\w+(?:\([^)]*\))?,/)
	const inputHint = hintMatch ? hintMatch[0].slice(1, -1) : toolName

	const charsMatch = userText.match(/(\d[\d,]*)\s*chars?\)/)
	const originalChars = charsMatch ? parseInt(charsMatch[1].replace(/,/g, '')) : 0

	const response = turn.response as AnyBlock[]
	let result: 'kept' | 'summarized' | 'error' = 'error'
	let summaryChars: number | null = null
	let summaryPreview: string | null = null

	for (const block of response) {
		if (block.type !== 'tool_use') continue
		if (block.name === 'keep') {
			result = 'kept'
		} else if (block.name === 'summarize_lines' || block.name === 'summarize') {
			result = 'summarized'
			const keepLines = block.input?.keep_lines
			if (typeof keepLines === 'string') {
				summaryPreview = `kept lines: ${keepLines}`
			}
			const summary = block.input?.summary
			if (typeof summary === 'string') {
				summaryChars = summary.length
				summaryPreview = summary.length > 200 ? summary.slice(0, 200) + '…' : summary
			}
		}
	}

	return {
		toolName,
		toolUseId,
		inputHint,
		originalChars,
		result,
		summaryChars,
		summaryPreview,
		cost: turn.cost,
		inputTokens: turn.inputTokens,
		outputTokens: turn.outputTokens,
	}
}

function fmt(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
	return String(n)
}

export function BatchViewer({ turns }: { turns: Turn[] }) {
	const entries = turns.map(parseBatchEntry)

	const totalCost = turns.reduce((s, t) => s + t.cost, 0)
	const totalInput = turns.reduce((s, t) => s + t.inputTokens, 0)
	const totalOutput = turns.reduce((s, t) => s + t.outputTokens, 0)
	const totalCacheRead = turns.reduce((s, t) => s + t.cacheReadTokens, 0)

	const keptCount = entries.filter(e => e.result === 'kept').length
	const summarizedCount = entries.filter(e => e.result === 'summarized').length
	const errorCount = entries.filter(e => e.result === 'error').length

	const totalOriginalChars = entries.reduce((s, e) => s + e.originalChars, 0)
	const totalSummaryChars = entries.filter(e => e.summaryChars !== null).reduce((s, e) => s + (e.summaryChars ?? 0), 0)
	const keptChars = entries.filter(e => e.result === 'kept').reduce((s, e) => s + e.originalChars, 0)
	const resultingChars = keptChars + totalSummaryChars
	const compressionPct = totalOriginalChars > 0
		? ((1 - resultingChars / totalOriginalChars) * 100).toFixed(0)
		: '0'

	return (
		<div className="border border-(--border) rounded-lg overflow-hidden">
			{/* Header */}
			<div className="p-4 border-b border-(--border) bg-(--bg-card)">
				<div className="flex items-center justify-between text-sm">
					<div className="flex items-center gap-3">
						<span className="font-mono font-semibold">
							Batch of {entries.length} evaluations
						</span>
						<span className="text-xs text-(--text-dim)">{turns[0]?.modelId}</span>
						<span className="text-xs px-2 py-0.5 rounded-full bg-[#2d2006] text-[#f59e0b]">
							batch API
						</span>
					</div>
					<div className="flex items-center gap-4 text-xs text-(--text-dim)">
						<span>{fmt(totalInput)} in / {fmt(totalOutput)} out</span>
						{totalCacheRead > 0 && (
							<span className="text-[#c084fc]">{fmt(totalCacheRead)} cached</span>
						)}
						<span>${totalCost.toFixed(4)}</span>
					</div>
				</div>

				{/* Summary stats */}
				<div className="flex gap-4 mt-3 text-xs">
					{summarizedCount > 0 && (
						<span className="text-[#22c55e]">
							{summarizedCount} summarized
						</span>
					)}
					{keptCount > 0 && (
						<span className="text-(--text-dim)">
							{keptCount} kept
						</span>
					)}
					{errorCount > 0 && (
						<span className="text-(--error)">
							{errorCount} errors
						</span>
					)}
					{summarizedCount > 0 && (
						<span className="text-(--text-dim)">
							{fmt(totalOriginalChars)} chars → {fmt(resultingChars)} chars ({compressionPct}% reduced)
						</span>
					)}
				</div>
			</div>

			{/* Entries table */}
			<div className="divide-y divide-(--border)/30">
				{entries.map((entry, i) => (
					<div key={i} className="px-4 py-2.5 flex items-start gap-3 text-xs hover:bg-(--bg-hover) transition-colors">
						<div className="shrink-0 w-5 text-center font-mono text-(--text-dim)">
							{i + 1}
						</div>
						<div className="shrink-0">
							{entry.result === 'summarized' && (
								<span className="px-1.5 py-0.5 rounded bg-[#0f2e1a] text-[#22c55e]">summarized</span>
							)}
							{entry.result === 'kept' && (
								<span className="px-1.5 py-0.5 rounded bg-(--bg-hover) text-(--text-dim)">kept</span>
							)}
							{entry.result === 'error' && (
								<span className="px-1.5 py-0.5 rounded bg-[#2d1215] text-(--error)">error</span>
							)}
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2">
								<span className="font-mono font-medium text-(--text)">{entry.toolName}</span>
								<span className="text-(--text-dim)">{entry.originalChars.toLocaleString('en-US')} chars</span>
								{entry.result === 'summarized' && entry.summaryChars !== null && (
									<span className="text-[#22c55e]">→ {entry.summaryChars.toLocaleString('en-US')} chars</span>
								)}
							</div>
							{entry.summaryPreview && (
								<div className="mt-1 text-(--text-dim) font-mono break-all line-clamp-2">
									{entry.summaryPreview}
								</div>
							)}
						</div>
						<div className="shrink-0 text-right text-(--text-dim) font-mono">
							${entry.cost.toFixed(4)}
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
