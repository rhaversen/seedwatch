'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

interface Turn {
	id: string
	phase: string
	modelId: string
	system: unknown[]
	messages: unknown[]
	response: unknown[]
	inputTokens: number
	outputTokens: number
	cost: number
	stopReason: string
	createdAt: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MessageBlock = Record<string, any>

type MessageStatus = 'unchanged' | 'changed' | 'new' | 'initial'

interface ClassifiedMsg {
	msg: MessageBlock
	prevMsg: MessageBlock | null
	status: MessageStatus
}

export function TurnViewer({ turns, overallStartIndex = 0, selectedTurn, selectionKey = 0 }: { turns: Turn[]; overallStartIndex?: number; selectedTurn?: number; selectionKey?: number }) {
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
		const localIndex = selectedTurn - overallStartIndex
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

	return (
		<div ref={containerRef} className="relative" tabIndex={0}>
			{/* Header bar */}
			<div className="sticky top-0 z-10 bg-(--bg) border border-(--border) rounded-lg p-3 mb-4">
				<div className="flex items-center justify-between text-sm">
					<div className="flex items-center gap-3">
						<span className="font-mono font-semibold">
							Turn {overallStartIndex + currentTurn + 1}
							<span className="text-(--text-dim) font-normal"> · {turn.phase} {currentTurn + 1}/{turns.length}</span>
						</span>
						<span className="text-xs text-(--text-dim)">{turn.modelId}</span>
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
						<span>{turn.inputTokens.toLocaleString()} in / {turn.outputTokens.toLocaleString()} out</span>
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
								muted={cm.status === 'unchanged'}
								variant={cm.status}
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
					<span>{currLen.toLocaleString()} chars</span>
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

function DiffView({ prev, curr }: { prev: string; curr: string }) {
	const prevLines = prev.split('\n')
	const currLines = curr.split('\n')

	const diffLines: { type: 'same' | 'add' | 'remove'; text: string }[] = []
	let pi = 0, ci = 0

	while (pi < prevLines.length || ci < currLines.length) {
		if (pi < prevLines.length && ci < currLines.length && prevLines[pi] === currLines[ci]) {
			diffLines.push({ type: 'same', text: currLines[ci] })
			pi++; ci++
		} else {
			const lookAhead = 3
			let found = false
			for (let d = 1; d <= lookAhead && !found; d++) {
				if (ci + d < currLines.length && pi < prevLines.length && prevLines[pi] === currLines[ci + d]) {
					for (let k = 0; k < d; k++) diffLines.push({ type: 'add', text: currLines[ci + k] })
					ci += d
					found = true
				}
				if (pi + d < prevLines.length && ci < currLines.length && prevLines[pi + d] === currLines[ci]) {
					for (let k = 0; k < d; k++) diffLines.push({ type: 'remove', text: prevLines[pi + k] })
					pi += d
					found = true
				}
			}
			if (!found) {
				if (pi < prevLines.length) { diffLines.push({ type: 'remove', text: prevLines[pi] }); pi++ }
				if (ci < currLines.length) { diffLines.push({ type: 'add', text: currLines[ci] }); ci++ }
			}
		}
		if (diffLines.length > 500) break
	}

	const collapsed: { type: 'same' | 'add' | 'remove' | 'collapse'; lines: string[]; count?: number }[] = []
	let sameRun: string[] = []

	const flushSame = () => {
		if (sameRun.length === 0) return
		if (sameRun.length <= 4) {
			for (const l of sameRun) collapsed.push({ type: 'same', lines: [l] })
		} else {
			collapsed.push({ type: 'same', lines: [sameRun[0], sameRun[1]] })
			collapsed.push({ type: 'collapse', lines: [], count: sameRun.length - 4 })
			collapsed.push({ type: 'same', lines: [sameRun[sameRun.length - 2], sameRun[sameRun.length - 1]] })
		}
		sameRun = []
	}

	for (const d of diffLines) {
		if (d.type === 'same') {
			sameRun.push(d.text)
		} else {
			flushSame()
			collapsed.push({ type: d.type, lines: [d.text] })
		}
	}
	flushSame()

	return (
		<div className="text-xs font-mono max-h-80 overflow-y-auto space-y-0">
			{collapsed.map((chunk, i) => {
				if (chunk.type === 'collapse') {
					return (
						<div key={i} className="text-(--text-dim) py-0.5 px-2 text-center text-[10px]">
							⋯ {chunk.count} unchanged lines ⋯
						</div>
					)
				}
				return chunk.lines.map((line, j) => (
					<div
						key={`${i}-${j}`}
						className={`px-2 py-px whitespace-pre-wrap wrap-break-word ${
							chunk.type === 'add' ? 'bg-green-900/30 text-green-300' :
							chunk.type === 'remove' ? 'bg-red-900/30 text-red-400 line-through' :
							'text-(--text-dim)'
						}`}
					>
						<span className="inline-block w-4 shrink-0 text-(--text-dim)">
							{chunk.type === 'add' ? '+' : chunk.type === 'remove' ? '−' : ' '}
						</span>
						{line || ' '}
					</div>
				))
			})}
		</div>
	)
}

/* ── Message bubbles ────────────────────────────────────────────── */

function MessageBubble({ message, muted, variant }: {
	message: MessageBlock
	muted?: boolean
	variant?: MessageStatus
}) {
	const [expanded, setExpanded] = useState(false)
	const content = extractContent(message)
	const preview = content.slice(0, 200)
	const isLong = content.length > 200

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
						<span className="text-[10px] px-1.5 py-0.5 rounded bg-(--accent-dim) text-(--accent)">compressed</span>
					)}
					{variant === 'new' && (
						<span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1e3a5f] text-(--blue)">new</span>
					)}
				</div>
				<div className="flex items-center gap-1.5 text-xs text-(--text-dim)">
					{isLong && (
						<>
							<button onClick={() => setExpanded(!expanded)} className="hover:text-(--text)">
								{expanded ? 'collapse' : 'expand'}
							</button>
							<span>·</span>
						</>
					)}
					<span>{content.length.toLocaleString()} chars</span>
				</div>
			</div>
			<pre className={`text-xs whitespace-pre-wrap wrap-break-word font-mono text-(--text-dim) ${expanded ? 'max-h-80 overflow-y-auto' : ''}`}>
				{expanded ? content : preview}{!expanded && isLong ? '…' : ''}
			</pre>
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
