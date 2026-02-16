'use client'

import { useState, useMemo, useRef, useCallback, useEffect, Fragment } from 'react'
import type { GeneratedTurn as Turn } from '@/lib/data'
import { phaseColors, phaseIcons } from '@/lib/phases'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MessageBlock = Record<string, any>

type MessageStatus = 'unchanged' | 'changed' | 'new' | 'initial'

interface ClassifiedMsg {
	msg: MessageBlock
	prevMsg: MessageBlock | null
	status: MessageStatus
}

interface OverheadMarker {
	phase: string
	turns: Turn[]
	overallStartIndex: number
	isBatch: boolean
	afterLocalIndex: number
}

interface SummarizerInfo {
	toolName: string
	inputHint: string
	originalChars: number
	result: 'kept' | 'summarized' | 'error'
	keepLines: string | null
	reasoning: string | null
	toolCall: MessageBlock | null
}

function buildSummarizerMap(overheadMarkers: OverheadMarker[]): Map<string, SummarizerInfo> {
	const map = new Map<string, SummarizerInfo>()
	for (const marker of overheadMarkers) {
		if (marker.phase !== 'summarizer') continue
		for (const turn of marker.turns) {
			const messages = turn.messages as MessageBlock[]
			const response = turn.response as MessageBlock[]
			const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
			const userText = typeof lastUserMsg?.content === 'string'
				? lastUserMsg.content
				: Array.isArray(lastUserMsg?.content)
					? lastUserMsg.content.map((b: MessageBlock) => b.text ?? '').join('')
					: ''

			const idMatch = userText.match(/tool_use_id="([^"]+)"/)
			const toolUseId = idMatch?.[1]
			if (!toolUseId) continue

			const hintMatch = userText.match(/\(([^)]+)\)/)
			const hint = hintMatch?.[1] ?? ''
			const toolName = hint.split(/[,:]/)[0]?.trim() ?? 'unknown'
			const inputHint = hint.split(/[:,]/).slice(1).join(',').trim()
			const charsMatch = userText.match(/(\d[\d,]*)\s*chars?\)/)
			const originalChars = charsMatch ? parseInt(charsMatch[1].replace(/,/g, '')) : 0

			let result: 'kept' | 'summarized' | 'error' = 'error'
			let keepLines: string | null = null
			let toolCall: MessageBlock | null = null
			const reasoningParts: string[] = []

			for (const block of response) {
				if (block.type === 'text') reasoningParts.push(block.text)
				if (block.type !== 'tool_use') continue
				toolCall = block
				if (block.name === 'keep') {
					result = 'kept'
				} else if (block.name === 'summarize_lines' || block.name === 'summarize') {
					result = 'summarized'
					keepLines = block.input?.keep_lines ?? null
				}
			}

			map.set(toolUseId, {
				toolName, inputHint, originalChars, result, keepLines,
				reasoning: reasoningParts.length > 0 ? reasoningParts.join('\n') : null,
				toolCall,
			})
		}
	}
	return map
}

export function TurnViewer({ turns, overallStartIndex = 0, overallIndices, selectedTurn, selectionKey = 0, overheadMarkers = [] }: { turns: Turn[]; overallStartIndex?: number; overallIndices?: number[]; selectedTurn?: number; selectionKey?: number; overheadMarkers?: OverheadMarker[] }) {
	const [currentTurn, setCurrentTurn] = useState(0)
	const [anim, setAnim] = useState<'forward' | 'backward' | null>(null)
	const containerRef = useRef<HTMLDivElement>(null)
	const scrollAccum = useRef(0)
	const lastTrigger = useRef(0)
	const consecutive = useRef(0)
	const animTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

	const navigate = useCallback((direction: 'forward' | 'backward') => {
		setCurrentTurn(prev => {
			const next = direction === 'forward'
				? Math.min(prev + 1, turns.length - 1)
				: Math.max(prev - 1, 0)
			if (next === prev) return prev

			if (animTimeout.current) clearTimeout(animTimeout.current)
			setAnim(direction)
			animTimeout.current = setTimeout(() => setAnim(null), 350)
			return next
		})
	}, [turns.length])

	useEffect(() => {
		const el = containerRef.current
		if (!el) return

		const onWheel = (e: WheelEvent) => {
			let target = e.target as HTMLElement | null
			while (target && target !== el) {
				const style = getComputedStyle(target)
				const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') && target.scrollHeight > target.clientHeight
				if (isScrollable) return
				target = target.parentElement
			}

			const dx = e.deltaX
			const dy = e.deltaY
			const horizontal = Math.abs(dx) > Math.abs(dy) * 0.4 ? dx : (e.shiftKey ? dy : 0)
			if (horizontal === 0) return

			e.preventDefault()
			scrollAccum.current += horizontal

			const threshold = 55
			if (Math.abs(scrollAccum.current) < threshold) return

			const now = Date.now()
			const elapsed = now - lastTrigger.current

			if (elapsed < 1500) consecutive.current++
			else consecutive.current = 0

			const debounce = Math.max(80, 380 * Math.pow(0.72, consecutive.current))
			if (elapsed < debounce) {
				scrollAccum.current = 0
				return
			}

			const dir: 'forward' | 'backward' = scrollAccum.current > 0 ? 'forward' : 'backward'
			scrollAccum.current = 0
			lastTrigger.current = now
			navigate(dir)
		}

		el.addEventListener('wheel', onWheel, { passive: false })
		return () => el.removeEventListener('wheel', onWheel)
	}, [navigate])

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'ArrowRight') navigate('forward')
			else if (e.key === 'ArrowLeft') navigate('backward')
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [navigate])

	useEffect(() => {
		if (selectedTurn === undefined) return
		const localIndex = overallIndices
			? overallIndices.indexOf(selectedTurn)
			: selectedTurn - overallStartIndex
		if (localIndex < 0 || localIndex >= turns.length) return
		setCurrentTurn(localIndex)
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedTurn, selectionKey])

	const turn = turns[currentTurn]
	const prevTurn = currentTurn > 0 ? turns[currentTurn - 1] : null

	const currMessages = turn.messages as MessageBlock[]
	const prevMessages = prevTurn ? (prevTurn.messages as MessageBlock[]) : []
	const currSystem = turn.system as MessageBlock[]
	const prevSystem = prevTurn ? (prevTurn.system as MessageBlock[]) : []
	const systemChanged = prevTurn !== null && JSON.stringify(currSystem) !== JSON.stringify(prevSystem)

	const classified = classifyMessages(prevMessages, currMessages, currentTurn === 0)
	const enterAnim = anim === 'forward' ? 'anim-enter-right' : anim === 'backward' ? 'anim-enter-left' : ''
	const exitAnim = anim === 'forward' ? 'anim-exit-left' : anim === 'backward' ? 'anim-exit-right' : ''

	const cumulativeCost = turns.slice(0, currentTurn + 1).reduce((s, t) => s + t.cost, 0)
	const changedCount = classified.filter(c => c.status === 'changed').length
	const newCount = classified.filter(c => c.status === 'new').length

	const summarizerMap = useMemo(() => buildSummarizerMap(overheadMarkers), [overheadMarkers])
	const nonSummarizerMarkers = useMemo(() => overheadMarkers.filter(m => m.phase !== 'summarizer'), [overheadMarkers])

	return (
		<div ref={containerRef} className="relative" tabIndex={0}>
			{/* Header bar */}
			<div className="sticky top-0 z-10 bg-(--bg) border border-(--border) rounded-lg p-3 mb-4">
				<div className="flex items-center justify-between text-sm">
					<div className="flex items-center gap-3">
						<span className="font-mono font-semibold">
							Turn {overallIndices ? overallIndices[currentTurn] + 1 : overallStartIndex + currentTurn + 1}
							<span className="text-(--text-dim) font-normal"> · {turn.phase} {currentTurn + 1}/{turns.length}</span>
						</span>
						<span className="text-xs text-(--text-dim)">{turn.modelId}</span>
						{turn.batch && (
							<span className="text-xs px-2 py-0.5 rounded-full bg-[#2d2006] text-[#f59e0b]">
								batch
							</span>
						)}
						{changedCount > 0 && (
							<span className="text-xs px-2 py-0.5 rounded-full bg-(--accent-dim) text-(--accent)">
								{changedCount} compressed
							</span>
						)}
						{newCount > 0 && currentTurn > 0 && (
							<span className="text-xs px-2 py-0.5 rounded-full bg-[#1e3a5f] text-(--blue)">
								+{newCount} new
							</span>
						)}
					</div>
					<div className="flex items-center gap-4 text-xs text-(--text-dim)">
						<span>{turn.inputTokens.toLocaleString('en-US')} in / {turn.outputTokens.toLocaleString('en-US')} out</span>
						{(turn.cacheReadTokens > 0 || turn.cacheWrite5mTokens > 0 || turn.cacheWrite1hTokens > 0) && (
							<span className="text-[#c084fc]">
								{turn.cacheReadTokens > 0 && `${turn.cacheReadTokens.toLocaleString('en-US')} cached`}
								{turn.cacheReadTokens > 0 && (turn.cacheWrite5mTokens > 0 || turn.cacheWrite1hTokens > 0) && ' · '}
								{turn.cacheWrite5mTokens > 0 && `${turn.cacheWrite5mTokens.toLocaleString('en-US')} write-5m`}
								{turn.cacheWrite5mTokens > 0 && turn.cacheWrite1hTokens > 0 && ' · '}
								{turn.cacheWrite1hTokens > 0 && `${turn.cacheWrite1hTokens.toLocaleString('en-US')} write-1h`}
							</span>
						)}
						<span>${cumulativeCost.toFixed(4)}</span>
					</div>
				</div>
				<div className="mt-2 h-1 bg-(--border) rounded-full overflow-hidden">
					<div
						className="h-full bg-(--accent) rounded-full transition-all duration-300"
						style={{ width: `${((currentTurn + 1) / turns.length) * 100}%` }}
					/>
				</div>
				<div className="text-[10px] text-(--text-dim) mt-1.5 text-center">
					scroll ← → or arrow keys
				</div>
			</div>

			{/* System prompt */}
			<SystemSection
				current={currSystem}
				previous={prevSystem}
				changed={systemChanged}
				isFirst={currentTurn === 0}
			/>

			{/* Messages */}
			<div className="space-y-1 mt-3">
				{classified.map((cm, i) => (
					<div key={i} className="relative overflow-hidden">
						{anim !== null && cm.status === 'changed' && cm.prevMsg && (
							<div className={`absolute inset-x-0 top-0 z-0 ${exitAnim} pointer-events-none`}>
								<MessageBubble message={cm.prevMsg} muted />
							</div>
						)}
						<div className={cm.status !== 'unchanged' && anim !== null ? `relative z-10 ${enterAnim}` : ''}>
							<MessageBubble
								message={cm.msg}
								prevMessage={cm.prevMsg}
								muted={cm.status === 'unchanged'}
								variant={cm.status}
								summarizerMap={summarizerMap}
							/>
						</div>
					</div>
				))}
			</div>

			{/* Response */}
			<div className={`mt-3 ${anim !== null ? enterAnim : ''}`}>
				<div className="text-xs font-semibold text-(--warn) mb-1">Response</div>
				{(turn.response as MessageBlock[]).map((block, i) => (
					<ResponseBlock key={i} block={block} />
				))}
			</div>

			{/* Inline overhead markers (non-summarizer only — summarizer is shown inline on messages) */}
			{nonSummarizerMarkers
				.filter(m => m.afterLocalIndex <= currentTurn)
				.map((marker, mi) => (
					<InlineOverhead key={`oh-past-${mi}`} marker={marker} />
				))
			}
			{nonSummarizerMarkers
				.filter(m => m.afterLocalIndex > currentTurn)
				.map((marker, mi) => (
					<InlineOverhead key={`oh-stack-${mi}`} marker={marker} />
				))
			}
		</div>
	)
}

/* ── Inline overhead marker ──────────────────────────────────────── */

const ohPhaseColors = phaseColors
const ohPhaseIcons = phaseIcons

function InlineOverhead({ marker }: { marker: OverheadMarker }) {
	const [expanded, setExpanded] = useState(false)
	const totalCost = marker.turns.reduce((s, t) => s + t.cost, 0)
	const costStr = totalCost >= 0.01 ? `$${totalCost.toFixed(2)}` : totalCost >= 0.001 ? `$${totalCost.toFixed(3)}` : `$${totalCost.toFixed(4)}`

	return (
		<div
			className="my-2 border-l-2 pl-3 py-1 rounded-r"
			style={{ borderColor: ohPhaseColors[marker.phase] ?? '#737373', backgroundColor: 'rgba(255,255,255,0.02)' }}
		>
			<button
				onClick={() => setExpanded(!expanded)}
				className="flex items-center gap-2 text-sm text-(--text-dim) hover:text-(--text) transition-colors w-full"
			>
				<span>{ohPhaseIcons[marker.phase] ?? '⚙️'}</span>
				<span className="capitalize font-medium">{marker.phase}</span>
				{(marker.isBatch || marker.turns.length > 1) && (
					<span className="text-xs opacity-60">
						{marker.isBatch
							? `batch of ${marker.turns.length}`
							: `${marker.turns.length} turns`}
					</span>
				)}
				<span className="text-xs opacity-60 font-mono">{costStr}</span>
				<span className="ml-auto text-xs opacity-40">{expanded ? '▼' : '▶'}</span>
			</button>
			{expanded && (
				<div className="mt-2">
					{marker.isBatch ? (
						<pre className="text-xs font-mono text-(--text-dim) whitespace-pre-wrap wrap-break-word max-h-60 overflow-y-auto">
							{marker.turns.map(t =>
								(t.response as MessageBlock[]).map(b => b.type === 'text' ? b.text : JSON.stringify(b)).join('\n')
							).join('\n---\n')}
						</pre>
					) : (
						<TurnViewer turns={marker.turns} overallStartIndex={marker.overallStartIndex} />
					)}
				</div>
			)}
		</div>
	)
}

/* ── System prompt section ──────────────────────────────────────── */

function SystemSection({
	current, previous, changed, isFirst,
}: {
	current: MessageBlock[]
	previous: MessageBlock[]
	changed: boolean
	isFirst: boolean
}) {
	const [expanded, setExpanded] = useState(false)

	if (current.length === 0) return null

	const currStr = systemToString(current)
	const prevStr = systemToString(previous)
	const currLen = currStr.length
	const prevLen = prevStr.length
	const diff = prevLen - currLen
	const pct = prevLen > 0 ? Math.round(Math.abs(diff) / prevLen * 100) : 0

	const changedLineCount = changed
		? currStr.split('\n').filter((l, i, a) => {
			const prev = prevStr.split('\n')
			return i >= prev.length || l !== prev[i]
		}).length + Math.max(0, prevStr.split('\n').length - currStr.split('\n').length)
		: 0

	const changeSummary = diff > 0
		? `−${diff} chars (${pct}%)`
		: diff < 0
			? `+${Math.abs(diff)} chars`
			: `${changedLineCount} line${changedLineCount !== 1 ? 's' : ''} modified`

	return (
		<div className={`border rounded-lg overflow-hidden mb-3 ${changed ? 'border-purple-800 bg-[#1a1520]' : 'border-(--border)'}`}>
			<button
				onClick={() => setExpanded(!expanded)}
				className="w-full text-left p-2.5 flex items-center justify-between hover:bg-(--bg-hover) transition-colors"
			>
				<div className="flex items-center gap-2 text-xs">
					<span className="text-purple-400 font-semibold">System Prompt</span>
					{changed && (
						<span className="px-2 py-0.5 rounded-full bg-purple-900/50 text-purple-300">
							changed · {changeSummary}
						</span>
					)}
					{!changed && !isFirst && (
						<span className="text-(--text-dim)">unchanged</span>
					)}
				</div>
				<span className="flex items-center gap-1.5 text-xs text-(--text-dim)">
					<span>{currLen.toLocaleString('en-US')} chars</span>
					<span>·</span>
					<span>{expanded ? '▾' : '▸'}</span>
				</span>
			</button>

			{expanded && (
				<div className="border-t border-(--border) p-3">
					{changed && previous.length > 0 ? (
						<DiffView prev={prevStr} curr={currStr} />
					) : (
						<pre className="text-xs text-(--text-dim) whitespace-pre-wrap wrap-break-word font-mono max-h-80 overflow-y-auto">
							{currStr.slice(0, 6000)}{currStr.length > 6000 ? '\n…(truncated)' : ''}
						</pre>
					)}
				</div>
			)}
		</div>
	)
}

type DiffRow =
	| { type: 'same'; left: string; right: string }
	| { type: 'changed'; left: string; right: string }
	| { type: 'removed'; left: string }
	| { type: 'added'; right: string }
	| { type: 'collapse'; count: number }

function computeDiffRows(prev: string[], curr: string[]): DiffRow[] {
	const n = prev.length, m = curr.length
	const MAX = 800
	const pClamped = n > MAX ? prev.slice(0, MAX) : prev
	const cClamped = m > MAX ? curr.slice(0, MAX) : curr
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

function DiffView({ prev, curr }: { prev: string; curr: string }) {
	const rows = computeDiffRows(prev.split('\n'), curr.split('\n'))

	const display: DiffRow[] = []
	let sameRun: DiffRow[] = []

	const flushSame = () => {
		if (sameRun.length === 0) return
		if (sameRun.length <= 4) {
			display.push(...sameRun)
		} else {
			display.push(sameRun[0], sameRun[1])
			display.push({ type: 'collapse', count: sameRun.length - 4 })
			display.push(sameRun[sameRun.length - 2], sameRun[sameRun.length - 1])
		}
		sameRun = []
	}

	for (const row of rows) {
		if (row.type === 'same') {
			sameRun.push(row)
		} else {
			flushSame()
			display.push(row)
		}
	}
	flushSame()

	const cell = 'px-2 py-px whitespace-pre-wrap wrap-break-word min-h-[1.25rem]'

	return (
		<div className="text-xs font-mono max-h-[32rem] overflow-y-auto grid grid-cols-2">
			{display.map((row, i) => {
				if (row.type === 'collapse') {
					return (
						<div key={i} className="col-span-2 text-(--text-dim) py-0.5 text-center text-[10px]">
							⋯ {row.count} unchanged lines ⋯
						</div>
					)
				}
				if (row.type === 'same') {
					return (
						<div key={i} className={`col-span-2 ${cell} text-(--text-dim)`}>
							{row.left || ' '}
						</div>
					)
				}
				if (row.type === 'changed') {
					return (
						<Fragment key={i}>
							<div className={`${cell} bg-red-900/30 text-red-400 border-r border-(--border)`}>
								{row.left || ' '}
							</div>
							<div className={`${cell} bg-green-900/30 text-green-300`}>
								{row.right || ' '}
							</div>
						</Fragment>
					)
				}
				if (row.type === 'removed') {
					return (
						<Fragment key={i}>
							<div className={`${cell} bg-red-900/30 text-red-400 border-r border-(--border)`}>
								{row.left || ' '}
							</div>
							<div className={`${cell} border-r-0`}> </div>
						</Fragment>
					)
				}
				return (
					<Fragment key={i}>
						<div className={`${cell} border-r border-(--border)`}> </div>
						<div className={`${cell} bg-green-900/30 text-green-300`}>
							{row.right || ' '}
						</div>
					</Fragment>
				)
			})}
		</div>
	)
}

/* ── Message bubbles ────────────────────────────────────────────── */

function MessageBubble({ message, prevMessage, muted, variant, summarizerMap }: {
	message: MessageBlock
	prevMessage?: MessageBlock | null
	muted?: boolean
	variant?: MessageStatus
	summarizerMap?: Map<string, SummarizerInfo>
}) {
	const [expanded, setExpanded] = useState(false)
	const [showAll, setShowAll] = useState(false)
	const content = extractContent(message)
	const prevContent = prevMessage ? extractContent(prevMessage) : ''
	const preview = content.slice(0, 200)
	const isLong = content.length > 200
	const hasDiff = variant === 'changed' && prevMessage

	const diff = hasDiff ? prevContent.length - content.length : 0
	const pct = hasDiff && prevContent.length > 0 ? Math.round(Math.abs(diff) / prevContent.length * 100) : 0
	const diffLabel = diff > 0
		? `−${diff.toLocaleString('en-US')} chars (${pct}%)`
		: diff < 0
			? `+${Math.abs(diff).toLocaleString('en-US')} chars`
			: 'modified'

	const annotatedIds = new Set<string>()
	if (variant === 'changed' && prevMessage && Array.isArray(message.content) && summarizerMap) {
		const prevBlocks = Array.isArray(prevMessage.content) ? prevMessage.content as MessageBlock[] : []
		for (const b of message.content as MessageBlock[]) {
			if (b.type !== 'tool_result' || !b.tool_use_id) continue
			if (!summarizerMap.has(b.tool_use_id)) continue
			const prevBlock = prevBlocks.find((pb: MessageBlock) => pb.type === 'tool_result' && pb.tool_use_id === b.tool_use_id)
			if (!prevBlock) continue
			if (JSON.stringify(prevBlock.content) !== JSON.stringify(b.content)) {
				annotatedIds.add(b.tool_use_id)
			}
		}
	}
	const hasAnnotations = annotatedIds.size > 0

	const borderClass =
		variant === 'new' ? 'border-[#1e3a5f]' :
		variant === 'changed' ? 'border-(--accent-dim)' :
		'border-(--border)'

	const roleColors: Record<string, string> = {
		user: 'text-(--blue)',
		assistant: 'text-(--warn)',
		system: 'text-purple-400',
	}

	return (
		<div className={`border ${borderClass} rounded-lg p-2.5 mb-1 transition-opacity duration-200 ${muted ? 'opacity-40' : ''}`}>
			<div className="flex items-center justify-between mb-1">
				<div className="flex items-center gap-2">
					<span className={`text-xs font-semibold ${roleColors[message.role] ?? 'text-(--text-dim)'}`}>
						{message.role ?? 'unknown'}
					</span>
					{variant === 'changed' && (
						<span className="text-[10px] px-1.5 py-0.5 rounded bg-(--accent-dim) text-(--accent)">compressed · {diffLabel}</span>
					)}
					{variant === 'new' && (
						<span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1e3a5f] text-(--blue)">new</span>
					)}
				</div>
				<div className="flex items-center gap-1.5 text-xs text-(--text-dim)">
					<button onClick={() => setExpanded(!expanded)} className="hover:text-(--text)">
						{expanded ? 'collapse' : hasDiff ? 'show diff' : isLong ? 'expand' : 'expand'}
					</button>
					<span>·</span>
					<span>{content.length.toLocaleString('en-US')} chars</span>
				</div>
			</div>

			{hasAnnotations ? (
				<ContentBlocksWithAnnotations
					blocks={message.content as MessageBlock[]}
					summarizerMap={summarizerMap!}
					annotatedIds={annotatedIds}
					expanded={expanded}
					hasDiff={!!hasDiff}
					prevMessage={prevMessage!}
				/>
			) : expanded ? (
				hasDiff ? (
					<DiffView prev={prevContent} curr={content} />
				) : (
					<div>
						<pre className={`text-xs whitespace-pre-wrap wrap-break-word font-mono text-(--text-dim) max-h-[32rem] overflow-y-auto`}>
							{showAll || content.length <= 10_000 ? content : content.slice(0, 10_000)}
						</pre>
						{!showAll && content.length > 10_000 && (
							<button
								onClick={() => setShowAll(true)}
								className="mt-1 text-xs text-(--accent) hover:underline"
							>
								Show all {content.length.toLocaleString('en-US')} chars ({Math.round((content.length - 10_000) / 1000)}k more)
							</button>
						)}
					</div>
				)
			) : (
				<pre className={`text-xs whitespace-pre-wrap wrap-break-word font-mono text-(--text-dim)`}>
					{preview}{isLong ? '…' : ''}
				</pre>
			)}
		</div>
	)
}

function ContentBlocksWithAnnotations({ blocks, summarizerMap, annotatedIds, expanded, hasDiff, prevMessage }: {
	blocks: MessageBlock[]
	summarizerMap: Map<string, SummarizerInfo>
	annotatedIds: Set<string>
	expanded: boolean
	hasDiff: boolean
	prevMessage: MessageBlock
}) {
	const prevBlocks = Array.isArray(prevMessage.content) ? prevMessage.content as MessageBlock[] : []

	return (
		<div className="space-y-1">
			{blocks.map((block, i) => {
				if (block.type === 'tool_result' && block.tool_use_id) {
					const info = summarizerMap.get(block.tool_use_id)
					const isAnnotated = annotatedIds.has(block.tool_use_id)
					const blockText = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
					const prevBlock = prevBlocks.find((pb: MessageBlock) => pb.type === 'tool_result' && pb.tool_use_id === block.tool_use_id)
					const prevText = prevBlock ? (typeof prevBlock.content === 'string' ? prevBlock.content : JSON.stringify(prevBlock.content)) : ''
					const contentChanged = prevText && prevText !== blockText

					return (
						<div key={i}>
							<ToolResultBlock
								toolUseId={block.tool_use_id}
								content={blockText}
								prevContent={contentChanged ? prevText : undefined}
								expanded={expanded}
								hasDiff={hasDiff && !!contentChanged}
							/>
							{isAnnotated && info && (
								<SummarizerAnnotation info={info} />
							)}
						</div>
					)
				}

				const text = block.type === 'text' ? block.text ?? ''
					: block.type === 'tool_use' ? `[tool_use: ${block.name}]${block.input ? ' ' + JSON.stringify(block.input) : ''}`
					: JSON.stringify(block)
				if (!text) return null

				return (
					<pre key={i} className={`text-xs whitespace-pre-wrap wrap-break-word font-mono text-(--text-dim) ${expanded ? '' : 'line-clamp-2'}`}>
						{expanded ? text : text.slice(0, 200)}{!expanded && text.length > 200 ? '…' : ''}
					</pre>
				)
			})}
		</div>
	)
}

function ToolResultBlock({ toolUseId, content, prevContent, expanded, hasDiff }: {
	toolUseId: string
	content: string
	prevContent?: string
	expanded: boolean
	hasDiff: boolean
}) {
	const idSuffix = toolUseId.slice(-8)
	const preview = content.slice(0, 120)
	const isLong = content.length > 120

	return (
		<div className="rounded border border-(--border) px-2 py-1">
			<div className="flex items-center gap-2 text-[10px] text-(--text-dim) mb-0.5">
				<span className="font-mono opacity-60">{idSuffix}</span>
				<span>{content.length.toLocaleString('en-US')} chars</span>
				{hasDiff && prevContent && (
					<span className="text-(--accent)">{prevContent.length > content.length
						? `−${(prevContent.length - content.length).toLocaleString('en-US')}`
						: `+${(content.length - prevContent.length).toLocaleString('en-US')}`
					} chars</span>
				)}
			</div>
			{expanded ? (
				hasDiff && prevContent ? (
					<DiffView prev={prevContent} curr={content} />
				) : (
					<pre className="text-xs whitespace-pre-wrap wrap-break-word font-mono text-(--text-dim) max-h-40 overflow-y-auto">
						{content.slice(0, 6000)}{content.length > 6000 ? '\n…(truncated)' : ''}
					</pre>
				)
			) : (
				<pre className="text-xs whitespace-pre-wrap wrap-break-word font-mono text-(--text-dim) line-clamp-2">
					{preview}{isLong ? '…' : ''}
				</pre>
			)}
		</div>
	)
}

function SummarizerAnnotation({ info }: { info: SummarizerInfo }) {
	const [expanded, setExpanded] = useState(false)

	return (
		<div className={`rounded overflow-hidden ${
			info.result === 'summarized'
				? 'bg-pink-950/30'
				: info.result === 'kept'
					? 'bg-emerald-950/30'
					: 'bg-yellow-950/30'
		}`}>
			<button
				onClick={() => setExpanded(!expanded)}
				className={`flex items-center gap-2 text-[10px] px-2 py-1 w-full text-left hover:brightness-125 transition-all ${
					info.result === 'summarized'
						? 'text-pink-300'
						: info.result === 'kept'
							? 'text-emerald-400'
							: 'text-yellow-400'
				}`}
			>
				<span>{info.result === 'summarized' ? '📦' : info.result === 'kept' ? '✓' : '⚠'}</span>
				<span className="font-mono font-medium">{info.toolName}</span>
				{info.inputHint && <span className="opacity-70 truncate">{info.inputHint}</span>}
				<span className="opacity-70">{info.originalChars.toLocaleString('en-US')} chars</span>
				{info.result === 'summarized' && info.keepLines && (
					<span className="opacity-70">→ lines {info.keepLines}</span>
				)}
				<span className="ml-auto opacity-40">{expanded ? '▾' : '▸'}</span>
			</button>

			{expanded && (
				<div className="px-2 pb-2 space-y-1.5">
					{info.reasoning && (
						<div className="border border-(--border) rounded p-2">
							<div className="text-[9px] font-semibold text-pink-400 mb-0.5">Reasoning</div>
							<pre className="text-[10px] whitespace-pre-wrap wrap-break-word font-mono text-(--text-dim) max-h-40 overflow-y-auto">
								{info.reasoning}
							</pre>
						</div>
					)}
					{info.toolCall && (
						<div className="border border-pink-900/50 rounded p-2">
							<div className="text-[9px] font-semibold text-pink-300 mb-0.5">🔧 {info.toolCall.name}</div>
							<pre className="text-[10px] whitespace-pre-wrap wrap-break-word font-mono text-(--text-dim) max-h-40 overflow-y-auto">
								{typeof info.toolCall.input === 'object' ? JSON.stringify(info.toolCall.input, null, 2) : String(info.toolCall.input)}
							</pre>
						</div>
					)}
				</div>
			)}
		</div>
	)
}

/* ── Response blocks ────────────────────────────────────────────── */

function ResponseBlock({ block }: { block: MessageBlock }) {
	if (block.type === 'text') {
		return (
			<div className="border border-(--border) rounded-lg p-3 mb-1">
				<pre className="text-xs whitespace-pre-wrap wrap-break-word font-mono max-h-80 overflow-y-auto">{block.text}</pre>
			</div>
		)
	}
	if (block.type === 'tool_use') {
		return (
			<div className="border border-[#2d3a20] rounded-lg p-3 mb-1">
				<div className="text-xs font-semibold text-(--accent) mb-1">🔧 {block.name}</div>
				<pre className="text-xs whitespace-pre-wrap wrap-break-word font-mono text-(--text-dim) max-h-80 overflow-y-auto">
					{JSON.stringify(block.input, null, 2)}
				</pre>
			</div>
		)
	}
	return (
		<div className="border border-(--border) rounded-lg p-3 mb-1">
			<pre className="text-xs whitespace-pre-wrap wrap-break-word font-mono text-(--text-dim) max-h-80 overflow-y-auto">
				{JSON.stringify(block, null, 2)}
			</pre>
		</div>
	)
}

/* ── Utilities ──────────────────────────────────────────────────── */

function systemToString(blocks: MessageBlock[]): string {
	return blocks.map(b => (typeof b === 'string' ? b : b.text ?? JSON.stringify(b, null, 2))).join('\n')
}

function extractContent(message: MessageBlock): string {
	if (typeof message.content === 'string') return message.content

	if (Array.isArray(message.content)) {
		return message.content.map((block: MessageBlock) => {
			if (block.type === 'text') return block.text
			if (block.type === 'tool_result') {
				const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
				return `[tool_result ${block.tool_use_id?.slice(-8) ?? ''}] ${text}`
			}
			if (block.type === 'tool_use') return `[tool_use: ${block.name}]${block.input ? ' ' + JSON.stringify(block.input) : ''}`
			return JSON.stringify(block)
		}).join('\n')
	}

	return JSON.stringify(message)
}

function classifyMessages(prev: MessageBlock[], curr: MessageBlock[], isFirst: boolean): ClassifiedMsg[] {
	return curr.map((msg, i) => {
		if (isFirst) return { msg, prevMsg: null, status: 'initial' as const }
		if (i >= prev.length) return { msg, prevMsg: null, status: 'new' as const }
		if (JSON.stringify(msg) === JSON.stringify(prev[i])) return { msg, prevMsg: prev[i], status: 'unchanged' as const }
		return { msg, prevMsg: prev[i], status: 'changed' as const }
	})
}
