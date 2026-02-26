'use client'

import { useMemo, useRef, useCallback, useEffect, useState, Fragment } from 'react'
import { CycleStats } from './CycleStats'
import { CycleSearch } from './CycleSearch'
import { SmartContent } from './SmartContent'
import type { GeneratedTurn as Turn } from '@/lib/data'
import { OVERHEAD_PHASES, phaseColors, phaseIcons } from '@/lib/phases'
import { useCurrency } from '@/lib/CurrencyProvider'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SystemBlock = Record<string, any>

function systemToString(blocks: unknown[]): string {
	return (blocks as SystemBlock[]).map(b => (typeof b === 'string' ? b : b.text ?? JSON.stringify(b, null, 2))).join('\n')
}

type FileRegion = { path: string; lines: Set<number> }

function parseWorkingContext(systemPrompt: string): Map<string, FileRegion> {
	const regions = new Map<string, FileRegion>()

	const wcMatch = systemPrompt.match(/## Working Context.*?\n([\s\S]*?)(?=\n##|$)/i)
	if (!wcMatch) return regions

	const wcText = wcMatch[1]
	const fileBlocks = wcText.split(/\n--- /).slice(1)

	for (const block of fileBlocks) {
		const headerMatch = block.match(/^(.+?) \(\d+ lines\) ---/)
		if (!headerMatch) continue

		const path = headerMatch[1]
		const lines = new Set<number>()

		const lineMatches = block.matchAll(/^(\d+) \|/gm)
		for (const m of lineMatches) {
			lines.add(parseInt(m[1], 10))
		}

		if (lines.size > 0) {
			regions.set(path, { path, lines })
		}
	}

	return regions
}

interface ReadOverlap {
	path: string
	requestedStart: number
	requestedEnd: number
	overlappingLines: number[]
	totalRequested: number
}

interface EvictedRead {
	path: string
	evictedLines: number[]
	totalRequested: number
}

function findMatchingRegion(filePath: string, context: Map<string, FileRegion>): FileRegion | undefined {
	const normalizedPath = filePath.replace(/\\/g, '/')
	for (const [path, region] of context) {
		const normalizedRegionPath = path.replace(/\\/g, '/')
		if (normalizedPath.endsWith(normalizedRegionPath) || normalizedRegionPath.endsWith(normalizedPath) || normalizedPath === normalizedRegionPath) {
			return region
		}
	}
	return undefined
}

function analyzeReadOverlap(
	readInput: { filePath?: string; startLine?: number; endLine?: number },
	context: Map<string, FileRegion>
): ReadOverlap | null {
	const filePath = readInput.filePath
	if (!filePath) return null

	const fileRegion = findMatchingRegion(filePath, context)
	if (!fileRegion || fileRegion.lines.size === 0) return null

	const start = readInput.startLine ?? 1
	const end = readInput.endLine ?? start + 100

	const overlapping: number[] = []
	for (let line = start; line <= end; line++) {
		if (fileRegion.lines.has(line)) {
			overlapping.push(line)
		}
	}

	if (overlapping.length === 0) return null

	return {
		path: filePath,
		requestedStart: start,
		requestedEnd: end,
		overlappingLines: overlapping,
		totalRequested: end - start + 1,
	}
}

function analyzeEvictedRead(
	readInput: { filePath?: string; startLine?: number; endLine?: number },
	currentContext: Map<string, FileRegion>,
	historyContexts: Map<string, FileRegion>[]
): EvictedRead | null {
	const filePath = readInput.filePath
	if (!filePath) return null

	const start = readInput.startLine ?? 1
	const end = readInput.endLine ?? start + 100

	const currentRegion = findMatchingRegion(filePath, currentContext)
	const currentLines = currentRegion?.lines ?? new Set<number>()

	const evicted: number[] = []
	for (let line = start; line <= end; line++) {
		if (currentLines.has(line)) continue

		for (const hist of historyContexts) {
			const histRegion = findMatchingRegion(filePath, hist)
			if (histRegion?.lines.has(line)) {
				evicted.push(line)
				break
			}
		}
	}

	if (evicted.length === 0) return null

	return {
		path: filePath,
		evictedLines: evicted,
		totalRequested: end - start + 1,
	}
}

type DiffRow =
	| { type: 'same'; left: string; right: string }
	| { type: 'changed'; left: string; right: string }
	| { type: 'removed'; left: string }
	| { type: 'added'; right: string }
	| { type: 'collapse'; count: number }

function computeDiffRows(prev: string[], curr: string[]): DiffRow[] {
	const MAX = 800
	const pClamped = prev.length > MAX ? prev.slice(0, MAX) : prev
	const cClamped = curr.length > MAX ? curr.slice(0, MAX) : curr
	const pn = pClamped.length, cm = cClamped.length

	const dp: number[][] = Array.from({ length: pn + 1 }, () => new Array(cm + 1).fill(0))
	for (let i = 1; i <= pn; i++) {
		for (let j = 1; j <= cm; j++) {
			dp[i][j] = pClamped[i - 1] === cClamped[j - 1]
				? dp[i - 1][j - 1] + 1
				: Math.max(dp[i - 1][j], dp[i][j - 1])
		}
	}

	const matches: [number, number][] = []
	let i = pn, j = cm
	while (i > 0 && j > 0) {
		if (pClamped[i - 1] === cClamped[j - 1]) {
			matches.push([i - 1, j - 1])
			i--; j--
		} else if (dp[i - 1][j] >= dp[i][j - 1]) {
			i--
		} else {
			j--
		}
	}
	matches.reverse()

	const rows: DiffRow[] = []
	let pi = 0, ci = 0

	const emitHunk = (removals: string[], additions: string[]) => {
		const len = Math.max(removals.length, additions.length)
		for (let k = 0; k < len; k++) {
			if (k < removals.length && k < additions.length) {
				rows.push({ type: 'changed', left: removals[k], right: additions[k] })
			} else if (k < removals.length) {
				rows.push({ type: 'removed', left: removals[k] })
			} else {
				rows.push({ type: 'added', right: additions[k] })
			}
		}
	}

	for (const [mi, mj] of matches) {
		emitHunk(pClamped.slice(pi, mi), cClamped.slice(ci, mj))
		rows.push({ type: 'same', left: pClamped[mi], right: cClamped[mj] })
		pi = mi + 1
		ci = mj + 1
	}
	emitHunk(pClamped.slice(pi), cClamped.slice(ci))

	return rows
}

function InlineSystemPrompt({ curr, prev, isPhaseStart }: { curr: string; prev: string | null; isPhaseStart: boolean }) {
	const [expanded, setExpanded] = useState(false)
	const [mode, setMode] = useState<'diff' | 'raw'>('diff')

	const changed = prev !== null && curr !== prev && !isPhaseStart
	const delta = prev !== null && !isPhaseStart ? curr.length - prev.length : 0

	const rows = useMemo(() => {
		if (!changed || !prev) return []
		return computeDiffRows(prev.split('\n'), curr.split('\n'))
	}, [changed, prev, curr])

	const display = useMemo(() => {
		if (rows.length === 0) return []
		const out: DiffRow[] = []
		let sameRun: DiffRow[] = []
		const flush = () => {
			if (sameRun.length <= 6) out.push(...sameRun)
			else {
				out.push(sameRun[0], sameRun[1], sameRun[2])
				out.push({ type: 'collapse', count: sameRun.length - 6 })
				out.push(sameRun[sameRun.length - 3], sameRun[sameRun.length - 2], sameRun[sameRun.length - 1])
			}
			sameRun = []
		}
		for (const row of rows) {
			if (row.type === 'same') sameRun.push(row)
			else { flush(); out.push(row) }
		}
		flush()
		return out
	}, [rows])

	const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

	const downloadText = (text: string, filename: string) => {
		const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = filename
		a.click()
		URL.revokeObjectURL(url)
	}

	return (
		<div className="mb-3 border border-(--border) rounded-lg overflow-hidden bg-(--bg-card)/50">
			<button
				onClick={() => setExpanded(e => !e)}
				className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-(--bg-hover) transition-colors"
			>
				<span className="text-purple-400 font-medium">System</span>
				<span className="text-(--text-dim) font-mono">{fmt(curr.length)} chars</span>
				{isPhaseStart && (
					<span className="px-1.5 py-0.5 rounded-full bg-blue-900/40 text-blue-300 text-[10px]">phase start</span>
				)}
				{changed && (
					<span className={`px-1.5 py-0.5 rounded-full text-[10px] ${delta < 0 ? 'bg-green-900/40 text-green-300' : delta > 0 ? 'bg-red-900/30 text-red-300' : 'bg-purple-900/40 text-purple-300'}`}>
						{delta > 0 ? '+' : ''}{fmt(delta)}
					</span>
				)}
				{!changed && !isPhaseStart && prev !== null && (
					<span className="text-(--text-dim) text-[10px]">unchanged</span>
				)}
				<span className="ml-auto text-(--text-dim)">{expanded ? '▼' : '▶'}</span>
			</button>

			{expanded && (
				<div className="border-t border-(--border)">
					<div className="flex justify-between items-center gap-1 p-1 border-b border-(--border)">
						<button
							onClick={() => downloadText(curr, 'system-prompt.txt')}
							className="px-2 py-0.5 text-[10px] rounded text-(--text-dim) hover:bg-(--bg-hover)"
						>
							📥 Download
						</button>
						{changed && (
							<div className="flex gap-1">
								<button onClick={() => setMode('diff')}
									className={`px-2 py-0.5 text-[10px] rounded ${mode === 'diff' ? 'bg-(--accent-dim) text-(--accent)' : 'text-(--text-dim) hover:bg-(--bg-hover)'}`}>
									Diff
								</button>
								<button onClick={() => setMode('raw')}
									className={`px-2 py-0.5 text-[10px] rounded ${mode === 'raw' ? 'bg-(--accent-dim) text-(--accent)' : 'text-(--text-dim) hover:bg-(--bg-hover)'}`}>
									Raw
								</button>
							</div>
						)}
					</div>
					<div className="p-2 max-h-128 overflow-y-auto">
						{mode === 'diff' && changed && display.length > 0 ? (
							<div className="text-xs font-mono grid grid-cols-2">
								{display.map((row, i) => {
									const cell = 'px-2 py-px whitespace-pre-wrap wrap-break-word min-h-[1.25rem]'
									if (row.type === 'collapse') {
										return <div key={i} className="col-span-2 text-(--text-dim) py-0.5 text-center text-[10px]">⋯ {row.count} unchanged ⋯</div>
									}
									if (row.type === 'same') {
										return <div key={i} className={`col-span-2 ${cell} text-(--text-dim)`}>{row.left || ' '}</div>
									}
									if (row.type === 'changed') {
										return (
											<Fragment key={i}>
												<div className={`${cell} bg-red-900/30 text-red-400 border-r border-(--border)`}>{row.left || ' '}</div>
												<div className={`${cell} bg-green-900/30 text-green-300`}>{row.right || ' '}</div>
											</Fragment>
										)
									}
									if (row.type === 'removed') {
										return (
											<Fragment key={i}>
												<div className={`${cell} bg-red-900/30 text-red-400 border-r border-(--border)`}>{row.left || ' '}</div>
												<div className={cell}> </div>
											</Fragment>
										)
									}
									return (
										<Fragment key={i}>
											<div className={`${cell} border-r border-(--border)`}> </div>
											<div className={`${cell} bg-green-900/30 text-green-300`}>{row.right || ' '}</div>
										</Fragment>
									)
								})}
							</div>
						) : (
							<textarea
								readOnly
								value={curr}
								title="System prompt content"
								className="w-full h-112 text-xs text-(--text-dim) font-mono bg-transparent border-none resize-none outline-none"
							/>
						)}
					</div>
				</div>
			)}
		</div>
	)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MessageBlock = Record<string, any>

interface OverheadGroup {
	phase: string
	turns: Turn[]
	overallStartIndex: number
}

interface FlowEntry {
	turn: Turn
	overallIndex: number
	prevCoreTurn: Turn | null
	overheadBefore: OverheadGroup[]
	phaseStart: boolean
	isFixStart: boolean
}

interface PhaseRun {
	phase: string
	startIndex: number
	count: number
}

function isFixPhaseStart(turn: Turn): boolean {
	if (turn.phase !== 'builder') return false
	const msgs = turn.messages as { role?: string }[]
	let userCount = 0, assistantCount = 0
	for (const m of msgs) {
		if (m.role === 'user') userCount++
		else if (m.role === 'assistant') assistantCount++
	}
	return userCount === 1 && assistantCount === 1
}

function buildFlow(turns: Turn[]): FlowEntry[] {
	const entries: FlowEntry[] = []
	let prevCore: Turn | null = null
	let prevPhase: string | null = null
	const pendingOverhead: OverheadGroup[] = []

	for (let idx = 0; idx < turns.length; idx++) {
		const turn = turns[idx]
		if (OVERHEAD_PHASES.has(turn.phase)) {
			const last = pendingOverhead[pendingOverhead.length - 1]
			if (last && last.phase === turn.phase) {
				last.turns.push(turn)
			} else {
				pendingOverhead.push({ phase: turn.phase, turns: [turn], overallStartIndex: idx })
			}
		} else {
			const isNewPhase = prevPhase !== turn.phase
			const isFix = turn.phase === 'builder' && isFixPhaseStart(turn)
			const phaseStart = isNewPhase || isFix
			entries.push({
				turn,
				overallIndex: idx,
				prevCoreTurn: prevCore,
				overheadBefore: pendingOverhead.splice(0),
				phaseStart,
				isFixStart: isFix,
			})
			prevCore = turn
			prevPhase = turn.phase
		}
	}

	return entries
}

function computePhaseRuns(flow: FlowEntry[]): PhaseRun[] {
	const runs: PhaseRun[] = []
	for (const e of flow) {
		if (e.phaseStart || runs.length === 0) {
			runs.push({ phase: e.turn.phase, startIndex: e.overallIndex, count: 1 })
		} else {
			runs[runs.length - 1].count++
		}
	}
	return runs
}

function fmtCost(n: number, formatCost?: (n: number) => string): string {
	if (formatCost) return formatCost(n)
	if (n >= 0.01) return `$${n.toFixed(2)}`
	if (n >= 0.001) return `$${n.toFixed(3)}`
	return `$${n.toFixed(4)}`
}

function extractBlockText(block: MessageBlock): string {
	if (block.type === 'thinking') {
		const text = block.thinking ?? block.text ?? ''
		if (!text) return ''
		const chars = text.length >= 1000 ? `${(text.length / 1000).toFixed(1)}k` : String(text.length)
		return `> 💭 *thinking — ${chars} chars*`
	}
	if (block.type === 'text') return block.text ?? ''
	if (block.type === 'tool_use') {
		const input = typeof block.input === 'object' ? JSON.stringify(block.input, null, 2) : String(block.input ?? '')
		return `**🔧 ${block.name}**\n\`\`\`json\n${input}\n\`\`\``
	}
	if (block.type === 'tool_result') {
		const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2)
		const id = block.tool_use_id?.slice(-8) ?? ''
		return `**Result** \`${id}\`\n\`\`\`\n${text}\n\`\`\``
	}
	return JSON.stringify(block, null, 2)
}

function extractMsgText(msg: MessageBlock): string {
	if (typeof msg.content === 'string') return msg.content
	if (Array.isArray(msg.content)) {
		return (msg.content as MessageBlock[]).map(extractBlockText).join('\n\n')
	}
	return JSON.stringify(msg.content, null, 2)
}

function buildConversationMd(flow: FlowEntry[], turns: Turn[], formatCost?: (n: number) => string): string {
	const lines: string[] = []
	const totalCost = turns.reduce((s, t) => s + t.cost, 0)
	lines.push(`# Conversation Export`)
	lines.push('')
	lines.push(`> ${turns.length} turns · ${fmtCost(totalCost, formatCost)} total cost`)
	lines.push('')

	for (const entry of flow) {
		const { turn, prevCoreTurn, overallIndex } = entry
		const msgs = turn.messages as MessageBlock[]
		const prevMsgs = prevCoreTurn ? prevCoreTurn.messages as MessageBlock[] : []
		const response = turn.response as MessageBlock[]

		if (entry.phaseStart) {
			lines.push(`---`)
			lines.push('')
			lines.push(`## ${phaseIcons[turn.phase] ?? '⚙️'} ${turn.phase}${entry.isFixStart ? ' (fix)' : ''}`)
			lines.push('')
		}

		for (const oh of entry.overheadBefore) {
			const cost = oh.turns.reduce((s, t) => s + t.cost, 0)
			lines.push(`> ${phaseIcons[oh.phase] ?? '⚙️'} **${oh.phase}** ×${oh.turns.length} · ${fmtCost(cost, formatCost)}`)
			lines.push('')
		}

		lines.push(`### Turn #${overallIndex + 1} — ${turn.phase} · ${turn.modelId} · ${turn.inputTokens.toLocaleString()} in / ${turn.outputTokens.toLocaleString()} out · ${fmtCost(turn.cost, formatCost)}`)
		lines.push('')

		const newMsgs = prevCoreTurn === null
			? msgs
			: msgs.slice(prevMsgs.length).filter(m => m.role === 'user')

		for (const msg of newMsgs) {
			const role = msg.role ?? 'unknown'
			lines.push(`#### ${role}`)
			lines.push('')
			lines.push(extractMsgText(msg))
			lines.push('')
		}

		if (response.length > 0) {
			lines.push(`#### response`)
			lines.push('')
			for (const block of response) {
				lines.push(extractBlockText(block))
				lines.push('')
			}
		}
	}

	return lines.join('\n')
}

function downloadMd(content: string, filename: string) {
	const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = filename
	a.click()
	URL.revokeObjectURL(url)
}

function OverheadInline({ group }: { group: OverheadGroup }) {
	const [expanded, setExpanded] = useState(false)
	const { formatCost } = useCurrency()
	const totalCost = group.turns.reduce((s, t) => s + t.cost, 0)

	return (
		<div
			className="my-2 border-l-2 pl-3 py-1 rounded-r"
			style={{ borderColor: phaseColors[group.phase] ?? '#737373', backgroundColor: 'rgba(255,255,255,0.02)' }}
		>
			<button
				onClick={() => setExpanded(!expanded)}
				className="flex items-center gap-2 text-xs text-(--text-dim) hover:text-(--text) transition-colors w-full"
			>
				<span>{phaseIcons[group.phase] ?? '⚙️'}</span>
				<span className="capitalize font-medium">{group.phase}</span>
				<span className="opacity-60">
					{group.turns.length > 1 ? `×${group.turns.length}` : ''}
				</span>
				<span className="opacity-60 font-mono">{formatCost(totalCost)}</span>
				<span className="ml-auto opacity-40">{expanded ? '▼' : '▶'}</span>
			</button>
			{expanded && (
				<div className="mt-2 space-y-1">
					{group.turns.map((t, i) => {
						const resp = (t.response as MessageBlock[])
						const text = resp.map(b => b.type === 'text' ? b.text : JSON.stringify(b)).join('\n')
						return (
							<pre key={i} className="text-xs font-mono text-(--text-dim) whitespace-pre-wrap wrap-break-word max-h-40 overflow-y-auto">
								{text.slice(0, 2000)}{text.length > 2000 ? '\n…' : ''}
							</pre>
						)
					})}
				</div>
			)}
		</div>
	)
}

function ExpandableText({ text, label, previewLen = 400 }: { text: string; label?: string; previewLen?: number }) {
	const [expanded, setExpanded] = useState(false)
	const needsExpand = text.length > previewLen

	const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

	const downloadText = (content: string, filename: string) => {
		const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = filename
		a.click()
		URL.revokeObjectURL(url)
	}

	if (!needsExpand) {
		return (
			<pre className="text-xs whitespace-pre-wrap wrap-break-word font-mono text-(--text-dim)">
				{text}
			</pre>
		)
	}

	return (
		<div>
			{!expanded ? (
				<>
					<pre className="text-xs whitespace-pre-wrap wrap-break-word font-mono text-(--text-dim)">
						{text.slice(0, previewLen)}…
					</pre>
					<button
						onClick={() => setExpanded(true)}
						className="text-[10px] text-(--accent) hover:underline mt-1"
					>
						Show all ({fmt(text.length)} chars)
					</button>
				</>
			) : (
				<>
					<div className="flex justify-end gap-2 mb-1">
						<button
							onClick={() => downloadText(text, `${label ?? 'content'}.txt`)}
							className="text-[10px] text-(--text-dim) hover:text-(--text)"
						>
							📥 Download
						</button>
						<button
							onClick={() => setExpanded(false)}
							className="text-[10px] text-(--text-dim) hover:text-(--text)"
						>
							Collapse
						</button>
					</div>
					<textarea
						readOnly
						value={text}
						title="Expanded content"
						className="w-full h-64 text-xs text-(--text-dim) font-mono bg-transparent border border-(--border) rounded resize-y outline-none p-2"
					/>
				</>
			)}
		</div>
	)
}

function UserMsgCompact({ msg }: { msg: MessageBlock }) {
	const content = msg.content
	if (typeof content === 'string') {
		return (
			<div data-message-block className="rounded border border-[#1e3a5f] px-3 py-2 mb-1">
				<div className="text-[10px] font-semibold text-(--blue) mb-0.5">{msg.role ?? 'user'}</div>
				<ExpandableText text={content} label="user-message" />
			</div>
		)
	}
	if (Array.isArray(content)) {
		return (
			<div data-message-block className="rounded border border-[#1e3a5f] px-3 py-2 mb-1 space-y-2">
				<div className="text-[10px] font-semibold text-(--blue) mb-0.5">{msg.role ?? 'user'}</div>
				{(content as MessageBlock[]).map((block, i) => {
					if (block.type === 'tool_result') {
						const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
						return (
							<div key={i} className="text-xs font-mono text-(--text-dim)">
								<span className="text-[10px] text-(--blue) opacity-60">result</span>
								<span className="opacity-30 ml-1">{block.tool_use_id?.slice(-8)}</span>
								<div className="mt-0.5">
									<ExpandableText text={text} label={`tool-result-${block.tool_use_id?.slice(-8)}`} />
								</div>
							</div>
						)
					}
					if (block.type === 'text' && block.text) {
						return (
							<div key={i}>
								<ExpandableText text={block.text as string} label="text-block" />
							</div>
						)
					}
					return null
				})}
			</div>
		)
	}
	return null
}

function ResponseCompact({ block, contextRegions, historyContexts }: { block: MessageBlock; contextRegions?: Map<string, FileRegion>; historyContexts?: Map<string, FileRegion>[] }) {
	const [thinkingExpanded, setThinkingExpanded] = useState(false)

	if (block.type === 'thinking') {
		const thinkingText = block.thinking ?? block.text ?? ''
		if (!thinkingText) return null
		const preview = thinkingText.slice(0, 200)
		const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

		return (
			<div data-thinking-block className="rounded border border-purple-800/50 bg-purple-950/20 px-3 py-2 mb-1">
				<button
					onClick={() => setThinkingExpanded(e => !e)}
					className="w-full flex items-center gap-2 text-xs text-left"
				>
					<span className="text-purple-400 font-medium">💭 thinking</span>
					<span className="text-(--text-dim) font-mono text-[10px]">{fmt(thinkingText.length)} chars</span>
					<span className="ml-auto text-(--text-dim)">{thinkingExpanded ? '▼' : '▶'}</span>
				</button>
				{!thinkingExpanded && thinkingText.length > 0 && (
					<div className="mt-1 text-xs text-(--text-dim) font-mono line-clamp-2 opacity-60">
						{preview}{thinkingText.length > 200 ? '…' : ''}
					</div>
				)}
				{thinkingExpanded && (
					<div className="mt-2 border-t border-purple-800/30 pt-2">
						<textarea
							readOnly
							value={thinkingText}
							title="Thinking content"
							className="w-full h-64 text-xs text-purple-300/80 font-mono bg-transparent border-none resize-y outline-none"
						/>
					</div>
				)}
			</div>
		)
	}

	if (block.type === 'text') {
		return (
			<div data-message-block className="rounded border border-(--border) px-3 py-2 mb-1">
				<SmartContent text={block.text ?? ''} maxHeight="20rem" />
			</div>
		)
	}
	if (block.type === 'tool_use') {
		const inputStr = typeof block.input === 'object' ? JSON.stringify(block.input) : String(block.input ?? '')

		let overlapInfo: ReadOverlap | null = null
		let evictedInfo: EvictedRead | null = null
		if (block.name === 'read_file' && contextRegions && typeof block.input === 'object') {
			const readInput = block.input as { filePath?: string; startLine?: number; endLine?: number }
			overlapInfo = analyzeReadOverlap(readInput, contextRegions)
			if (historyContexts && historyContexts.length > 0) {
				evictedInfo = analyzeEvictedRead(readInput, contextRegions, historyContexts)
			}
		}

		const overlapPct = overlapInfo ? Math.round((overlapInfo.overlappingLines.length / overlapInfo.totalRequested) * 100) : 0
		const isFullyRedundant = overlapPct >= 80
		const isPartiallyRedundant = overlapPct >= 20 && overlapPct < 80
		const hasEvicted = evictedInfo && evictedInfo.evictedLines.length > 0

		return (
			<div data-tool-block className={`rounded border px-3 py-2 mb-1 ${isFullyRedundant ? 'border-red-700/60 bg-red-950/20' : isPartiallyRedundant ? 'border-yellow-700/50 bg-yellow-950/10' : hasEvicted ? 'border-orange-700/50 bg-orange-950/10' : 'border-[#2d3a20]'}`}>
				<div className="flex items-center gap-2 text-xs flex-wrap">
					<span className="font-semibold text-(--accent)">🔧 {block.name}</span>
					<span className="text-(--text-dim) font-mono truncate text-[10px]">{inputStr.slice(0, 120)}{inputStr.length > 120 ? '…' : ''}</span>
					<span className="ml-auto flex gap-1">
						{overlapInfo && (
							<span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${isFullyRedundant ? 'bg-red-900/50 text-red-300' : isPartiallyRedundant ? 'bg-yellow-900/40 text-yellow-300' : 'bg-blue-900/30 text-blue-300'}`}>
								{overlapInfo.overlappingLines.length}/{overlapInfo.totalRequested} in ctx
							</span>
						)}
						{evictedInfo && evictedInfo.evictedLines.length > 0 && (
							<span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-orange-900/50 text-orange-300" title="These lines were previously in context but got evicted">
								{evictedInfo.evictedLines.length} evicted
							</span>
						)}
					</span>
				</div>
			</div>
		)
	}
	return null
}

function getMessageSummary(msg: MessageBlock): string {
	if (msg.role === 'user') {
		if (typeof msg.content === 'string') return `user: ${msg.content.slice(0, 100)}...`
		if (Array.isArray(msg.content)) {
			const first = msg.content[0]
			if (first?.type === 'tool_result') return `tool_result: ${first.tool_use_id?.slice(-8)}`
			if (first?.type === 'text') return `user text: ${(first.text as string)?.slice(0, 60)}...`
			return `user: ${msg.content.length} blocks`
		}
	}
	if (msg.role === 'assistant') {
		if (Array.isArray(msg.content)) {
			const tools = (msg.content as MessageBlock[]).filter(b => b.type === 'tool_use')
			if (tools.length > 0) return `assistant: ${tools.map(t => t.name).join(', ')}`
			return `assistant: ${(msg.content as MessageBlock[]).length} blocks`
		}
	}
	return `${msg.role ?? 'unknown'}`
}

function CompressedDetails({ items }: { items: { index: number; prevMsg: MessageBlock; currMsg: MessageBlock }[] }) {
	return (
		<div className="mb-3 rounded border border-(--accent)/30 bg-(--accent)/5 px-3 py-2">
			<div className="text-[10px] font-semibold text-(--accent) mb-2">Compressed Messages</div>
			<div className="space-y-1.5">
				{items.map((item, i) => {
					const prevLen = JSON.stringify(item.prevMsg).length
					const currLen = JSON.stringify(item.currMsg).length
					const diff = prevLen - currLen
					return (
						<div key={i} className="text-[10px] font-mono">
							<span className="text-(--text-dim)">#{item.index + 1}</span>
							<span className="ml-2 text-(--text)">{getMessageSummary(item.prevMsg)}</span>
							<span className="ml-2 text-(--accent)">
								{diff > 0 ? `-${(diff / 1000).toFixed(1)}k` : `+${(Math.abs(diff) / 1000).toFixed(1)}k`}
							</span>
						</div>
					)
				})}
			</div>
		</div>
	)
}

function TurnCard({ entry, innerRef, historyContexts }: {
	entry: FlowEntry
	innerRef: (el: HTMLElement | null) => void
	historyContexts: Map<string, FileRegion>[]
}) {
	const { formatCost } = useCurrency()
	const { turn, prevCoreTurn, overallIndex, phaseStart } = entry
	const msgs = turn.messages as MessageBlock[]
	const prevMsgs = useMemo(() => prevCoreTurn ? prevCoreTurn.messages as MessageBlock[] : [], [prevCoreTurn])
	const response = turn.response as MessageBlock[]

	const currSystem = systemToString(turn.system as unknown[])
	const prevSystem = prevCoreTurn ? systemToString(prevCoreTurn.system as unknown[]) : null

	const contextRegions = useMemo(() => parseWorkingContext(currSystem), [currSystem])

	const newMsgs = prevCoreTurn === null
		? msgs
		: msgs.slice(prevMsgs.length).filter(m => m.role === 'user')

	const [showCompressed, setShowCompressed] = useState(false)

	const compressedMsgs = useMemo(() => {
		if (!prevCoreTurn) return []
		const result: { index: number; prevMsg: MessageBlock; currMsg: MessageBlock }[] = []
		for (let i = 0; i < Math.min(msgs.length, prevMsgs.length); i++) {
			if (JSON.stringify(msgs[i]) !== JSON.stringify(prevMsgs[i])) {
				result.push({ index: i, prevMsg: prevMsgs[i], currMsg: msgs[i] })
			}
		}
		return result
	}, [msgs, prevMsgs, prevCoreTurn])

	const redundantReads = useMemo(() => {
		let totalRedundant = 0
		let totalReads = 0
		for (const block of response) {
			if (block.type === 'tool_use' && block.name === 'read_file' && typeof block.input === 'object') {
				totalReads++
				const overlap = analyzeReadOverlap(block.input as { filePath?: string; startLine?: number; endLine?: number }, contextRegions)
				if (overlap && overlap.overlappingLines.length / overlap.totalRequested >= 0.5) {
					totalRedundant++
				}
			}
		}
		return { totalRedundant, totalReads }
	}, [response, contextRegions])

	return (
		<div ref={innerRef}>
			<div className="flex items-center gap-2 my-4">
				<div className="h-px flex-1" style={{ backgroundColor: phaseColors[turn.phase] ?? '#444', opacity: 0.3 }} />
				<div className="flex items-center gap-2 text-xs shrink-0">
					<span style={{ color: phaseColors[turn.phase] }}>{phaseIcons[turn.phase] ?? '⚙️'}</span>
					<span className="font-mono font-semibold text-(--text)">#{overallIndex + 1}</span>
					<span className="text-(--text-dim)">{turn.modelId}</span>
					<span className="text-(--text-dim)">{turn.inputTokens.toLocaleString('en-US')} in / {turn.outputTokens.toLocaleString('en-US')} out</span>
					<span className="text-(--text-dim) font-mono">{formatCost(turn.cost)}</span>
					{compressedMsgs.length > 0 && (
						<button
							onClick={() => setShowCompressed(s => !s)}
							className="text-[10px] px-1.5 py-0.5 rounded bg-(--accent-dim) text-(--accent) hover:bg-(--accent)/20 transition-colors"
						>
							{compressedMsgs.length} compressed {showCompressed ? '▼' : '▶'}
						</button>
					)}
					{redundantReads.totalRedundant > 0 && (
						<span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/50 text-red-300">
							{redundantReads.totalRedundant}/{redundantReads.totalReads} re-reads
						</span>
					)}
				</div>
				<div className="h-px flex-1" style={{ backgroundColor: phaseColors[turn.phase] ?? '#444', opacity: 0.3 }} />
			</div>

			{showCompressed && compressedMsgs.length > 0 && (
				<CompressedDetails items={compressedMsgs} />
			)}

			<InlineSystemPrompt curr={currSystem} prev={prevSystem} isPhaseStart={phaseStart} />

			{newMsgs.length > 0 && (
				<div className="mb-2">
					{newMsgs.map((msg, i) => <UserMsgCompact key={i} msg={msg} />)}
				</div>
			)}

			<div className="ml-4 border-l-2 pl-3 space-y-1" style={{ borderColor: phaseColors[turn.phase] ?? '#fbbf24' }}>
				{response.map((block, i) => <ResponseCompact key={i} block={block} contextRegions={contextRegions} historyContexts={historyContexts} />)}
			</div>
		</div>
	)
}

export function CycleContent({ turns, initialTurn }: { turns: Turn[]; initialTurn?: number }) {
	const { formatCost } = useCurrency()
	const turnRefs = useRef<Map<number, HTMLElement>>(new Map())

	const flow = useMemo(() => buildFlow(turns), [turns])
	const phaseRuns = useMemo(() => computePhaseRuns(flow), [flow])

	const systemContextHistory = useMemo(() => {
		const history: Map<string, FileRegion>[] = []
		for (const entry of flow) {
			const systemStr = systemToString(entry.turn.system as unknown[])
			const regions = parseWorkingContext(systemStr)
			history.push(regions)
		}
		return history
	}, [flow])

	useEffect(() => {
		if (initialTurn === undefined) return
		requestAnimationFrame(() => {
			const el = turnRefs.current.get(initialTurn)
			if (el) {
				const yOffset = -80
				const y = el.getBoundingClientRect().top + window.scrollY + yOffset
				window.scrollTo({ top: y, behavior: 'smooth' })
			}
		})
	}, []) // eslint-disable-line react-hooks/exhaustive-deps

	const handleTurnClick = useCallback((overallIndex: number) => {
		const el = turnRefs.current.get(overallIndex)
		if (!el) return
		const yOffset = -80
		const y = el.getBoundingClientRect().top + window.scrollY + yOffset
		window.scrollTo({ top: y, behavior: 'smooth' })
	}, [])

	const handleMinimapClick = useCallback((runIndex: number) => {
		const run = phaseRuns[runIndex]
		if (run) {
			const el = turnRefs.current.get(run.startIndex)
			if (el) {
				const yOffset = -80
				const y = el.getBoundingClientRect().top + window.scrollY + yOffset
				window.scrollTo({ top: y, behavior: 'smooth' })
			}
		}
	}, [phaseRuns])

	const handleDownload = useCallback(() => {
		const md = buildConversationMd(flow, turns, formatCost)
		const id = turns[0]?.iterationId?.slice(-8) ?? 'cycle'
		downloadMd(md, `conversation-${id}.md`)
	}, [flow, turns, formatCost])

	return (
		<>
			<CycleSearch />
			<CycleStats turns={turns} onTurnClick={handleTurnClick} />

			<div className="flex justify-end gap-2 mb-3">
				<button
					onClick={handleDownload}
					className="text-xs text-(--text-dim) hover:text-(--text) transition-colors px-3 py-1.5 rounded border border-(--border) hover:bg-(--bg-hover)"
				>
					📥 Download .md
				</button>
			</div>

			<div className="relative" data-cycle-content>
				{flow.map((entry, i) => (
					<Fragment key={entry.overallIndex}>
						{entry.phaseStart && (
							<div className="mt-8 mb-2 first:mt-0">
								<h2 className="text-lg font-semibold capitalize flex items-center gap-2">
									<span className="text-(--text-dim)">{phaseIcons[entry.turn.phase] ?? '⚙️'}</span>
									{entry.turn.phase}
									{entry.isFixStart && (
										<span className="text-sm font-normal text-(--error)">(fix)</span>
									)}
								</h2>
							</div>
						)}

						{entry.overheadBefore.map((oh, j) => (
							<OverheadInline key={`oh-${entry.overallIndex}-${j}`} group={oh} />
						))}

						<TurnCard
							entry={entry}
							innerRef={el => {
								if (el) turnRefs.current.set(entry.overallIndex, el)
								else turnRefs.current.delete(entry.overallIndex)
							}}
							historyContexts={systemContextHistory.slice(0, i)}
						/>
					</Fragment>
				))}
			</div>

			<Minimap
				phaseRuns={phaseRuns}
				turnRefs={turnRefs}
				onSegmentClick={handleMinimapClick}
			/>
		</>
	)
}

function Minimap({ phaseRuns, turnRefs, onSegmentClick }: {
	phaseRuns: PhaseRun[]
	turnRefs: React.RefObject<Map<number, HTMLElement>>
	onSegmentClick: (runIndex: number) => void
}) {
	const markerRef = useRef<HTMLDivElement>(null)
	const trackRef = useRef<HTMLDivElement>(null)
	const segmentRefs = useRef<HTMLDivElement[]>([])
	const labelRefs = useRef<HTMLDivElement[]>([])
	const [segmentHeights, setSegmentHeights] = useState<number[]>([])

	useEffect(() => {
		let raf = 0
		const update = () => {
			cancelAnimationFrame(raf)
			raf = requestAnimationFrame(() => {
				const refs = turnRefs.current
				if (!refs || !trackRef.current || !markerRef.current) return

				const contentEl = document.querySelector('[data-cycle-content]')
				if (!contentEl) return

				const contentRect = contentEl.getBoundingClientRect()
				const viewportHeight = window.innerHeight
				const scrollableHeight = contentRect.height - viewportHeight
				const scrolledIntoContent = -contentRect.top

				const progress = scrollableHeight > 0
					? Math.max(0, Math.min(1, scrolledIntoContent / scrollableHeight))
					: 0

				const trackH = trackRef.current.clientHeight
				markerRef.current.style.top = `${progress * (trackH - 3)}px`
			})
		}
		window.addEventListener('scroll', update, { passive: true })
		window.addEventListener('resize', update, { passive: true })
		const timer = setTimeout(update, 200)
		return () => {
			window.removeEventListener('scroll', update)
			window.removeEventListener('resize', update)
			cancelAnimationFrame(raf)
			clearTimeout(timer)
		}
	}, [phaseRuns, turnRefs])

	useEffect(() => {
		const calcHeights = () => {
			const refs = turnRefs.current
			if (!refs || refs.size === 0) return

			const contentEl = document.querySelector('[data-cycle-content]')
			if (!contentEl) return
			const contentTop = contentEl.getBoundingClientRect().top + window.scrollY
			const contentHeight = contentEl.getBoundingClientRect().height

			const heights: number[] = []
			for (let i = 0; i < phaseRuns.length; i++) {
				const run = phaseRuns[i]
				const el = refs.get(run.startIndex)
				if (!el) {
					heights.push(1)
					continue
				}
				const startY = el.getBoundingClientRect().top + window.scrollY - contentTop

				let endY = contentHeight
				if (i < phaseRuns.length - 1) {
					const nextEl = refs.get(phaseRuns[i + 1].startIndex)
					if (nextEl) {
						endY = nextEl.getBoundingClientRect().top + window.scrollY - contentTop
					}
				}

				heights.push(Math.max(1, endY - startY))
			}

			setSegmentHeights(heights)
		}

		const timer = setTimeout(calcHeights, 300)
		window.addEventListener('resize', calcHeights)
		return () => {
			clearTimeout(timer)
			window.removeEventListener('resize', calcHeights)
		}
	}, [phaseRuns, turnRefs])

	const totalHeight = segmentHeights.reduce((a, b) => a + b, 0) || 1

	return (
		<div className="fixed right-3 top-4 bottom-4 z-50 flex items-start gap-1">
			<div
				ref={trackRef}
				className="relative rounded-full overflow-hidden bg-(--bg-card) border border-(--border) h-full"
				style={{ width: 10 }}
			>
				{phaseRuns.map((run, i) => {
					const pct = segmentHeights.length > 0 ? (segmentHeights[i] / totalHeight) * 100 : (1 / phaseRuns.length) * 100
					return (
						<div
							key={i}
							ref={el => { if (el) segmentRefs.current[i] = el }}
							className="w-full cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
							style={{
								height: `${pct}%`,
								minHeight: 6,
								backgroundColor: phaseColors[run.phase] ?? '#737373',
							}}
							onClick={() => onSegmentClick(i)}
						/>
					)
				})}
				<div
					ref={markerRef}
					className="absolute left-0 w-full h-0.75 rounded-full bg-white shadow-[0_0_4px_rgba(255,255,255,0.6)]"
					style={{ top: 0 }}
				/>
			</div>

			<div className="flex flex-col h-full">
				{phaseRuns.map((run, i) => {
					const pct = segmentHeights.length > 0 ? (segmentHeights[i] / totalHeight) * 100 : (1 / phaseRuns.length) * 100
					return (
						<div
							key={i}
							ref={el => { if (el) labelRefs.current[i] = el }}
							className="flex items-center cursor-pointer group"
							style={{ height: `${pct}%`, minHeight: 6 }}
							onClick={() => onSegmentClick(i)}
						>
							<span
								className="text-[9px] leading-none group-hover:text-(--text) transition-colors capitalize whitespace-nowrap"
								style={{ color: phaseColors[run.phase] ?? '#737373' }}
							>
								{run.phase[0]?.toUpperCase()}{run.count > 1 ? ` ×${run.count}` : ''}
							</span>
						</div>
					)
				})}
			</div>
		</div>
	)
}
