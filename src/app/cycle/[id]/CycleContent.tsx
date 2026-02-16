'use client'

import { useMemo, useState, useRef, useCallback, useEffect, Fragment } from 'react'
import { CycleStats } from './CycleStats'
import { TurnViewer } from './TurnViewer'
import { BatchViewer } from './BatchViewer'
import { CycleSearch } from './CycleSearch'
import { SmartContent } from './SmartContent'
import type { GeneratedTurn as Turn } from '@/lib/data'
import { OVERHEAD_PHASES, phaseColors, phaseIcons } from '@/lib/phases'

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
	prevOverallIndex: number
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
	let prevCoreIdx = -1
	let prevPhase: string | null = null
	let pendingOverhead: OverheadGroup[] = []

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
				prevOverallIndex: prevCoreIdx,
				overheadBefore: pendingOverhead.splice(0),
				phaseStart,
				isFixStart: isFix,
			})
			prevCore = turn
			prevCoreIdx = idx
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

function fmtCost(n: number): string {
	if (n >= 0.01) return `$${n.toFixed(2)}`
	if (n >= 0.001) return `$${n.toFixed(3)}`
	return `$${n.toFixed(4)}`
}

function extractBlockText(block: MessageBlock): string {
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

function buildConversationMd(flow: FlowEntry[], turns: Turn[]): string {
	const lines: string[] = []
	const totalCost = turns.reduce((s, t) => s + t.cost, 0)
	lines.push(`# Conversation Export`)
	lines.push('')
	lines.push(`> ${turns.length} turns · ${fmtCost(totalCost)} total cost`)
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
			lines.push(`> ${phaseIcons[oh.phase] ?? '⚙️'} **${oh.phase}** ×${oh.turns.length} · ${fmtCost(cost)}`)
			lines.push('')
		}

		lines.push(`### Turn #${overallIndex + 1} — ${turn.phase} · ${turn.modelId} · ${turn.inputTokens.toLocaleString()} in / ${turn.outputTokens.toLocaleString()} out · ${fmtCost(turn.cost)}`)
		lines.push('')

		const newMsgs = prevCoreTurn === null
			? msgs
			: msgs.slice(prevMsgs.length)

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
				<span className="opacity-60 font-mono">{fmtCost(totalCost)}</span>
				<span className="ml-auto opacity-40">{expanded ? '▼' : '▶'}</span>
			</button>
			{expanded && (
				<div className="mt-2">
					{group.phase === 'summarizer' ? (
						<BatchViewer turns={group.turns} />
					) : (
						<TurnViewer turns={group.turns} overallStartIndex={group.overallStartIndex} />
					)}
				</div>
			)}
		</div>
	)
}

function UserMsgCompact({ msg }: { msg: MessageBlock }) {
	const content = msg.content
	if (typeof content === 'string') {
		return (
			<div className="rounded border border-[#1e3a5f] px-3 py-2 mb-1">
				<div className="text-[10px] font-semibold text-(--blue) mb-0.5">{msg.role ?? 'user'}</div>
				<pre className="text-xs whitespace-pre-wrap wrap-break-word font-mono text-(--text-dim) max-h-40 overflow-y-auto">
					{content.slice(0, 500)}{content.length > 500 ? '…' : ''}
				</pre>
			</div>
		)
	}
	if (Array.isArray(content)) {
		return (
			<div className="rounded border border-[#1e3a5f] px-3 py-2 mb-1 space-y-1">
				<div className="text-[10px] font-semibold text-(--blue) mb-0.5">{msg.role ?? 'user'}</div>
				{(content as MessageBlock[]).map((block, i) => {
					if (block.type === 'tool_result') {
						const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
						return (
							<div key={i} className="text-xs font-mono text-(--text-dim)">
								<span className="text-[10px] text-(--blue) opacity-60">result</span>
								<span className="opacity-30 ml-1">{block.tool_use_id?.slice(-8)}</span>
								<pre className="whitespace-pre-wrap wrap-break-word mt-0.5 max-h-32 overflow-y-auto">
									{text.slice(0, 400)}{text.length > 400 ? '…' : ''}
								</pre>
							</div>
						)
					}
					if (block.type === 'text' && block.text) {
						return (
							<pre key={i} className="text-xs whitespace-pre-wrap wrap-break-word font-mono text-(--text-dim)">
								{(block.text as string).slice(0, 400)}{(block.text as string).length > 400 ? '…' : ''}
							</pre>
						)
					}
					return null
				})}
			</div>
		)
	}
	return null
}

function ResponseCompact({ block }: { block: MessageBlock }) {
	if (block.type === 'text') {
		return (
			<div className="rounded border border-(--border) px-3 py-2 mb-1">
				<SmartContent text={block.text ?? ''} maxHeight="20rem" />
			</div>
		)
	}
	if (block.type === 'tool_use') {
		const inputStr = typeof block.input === 'object' ? JSON.stringify(block.input) : String(block.input ?? '')
		return (
			<div className="rounded border border-[#2d3a20] px-3 py-2 mb-1">
				<div className="flex items-center gap-2 text-xs">
					<span className="font-semibold text-(--accent)">🔧 {block.name}</span>
					<span className="text-(--text-dim) font-mono truncate text-[10px]">{inputStr.slice(0, 120)}{inputStr.length > 120 ? '…' : ''}</span>
				</div>
			</div>
		)
	}
	return null
}

function TurnCard({ entry, expanded, onToggle, innerRef }: {
	entry: FlowEntry
	expanded: boolean
	onToggle: () => void
	innerRef: (el: HTMLElement | null) => void
}) {
	const { turn, prevCoreTurn, overallIndex } = entry
	const msgs = turn.messages as MessageBlock[]
	const prevMsgs = prevCoreTurn ? prevCoreTurn.messages as MessageBlock[] : []
	const response = turn.response as MessageBlock[]

	const newMsgs = prevCoreTurn === null
		? msgs
		: msgs.slice(prevMsgs.length).filter(m => m.role === 'user')

	let compressedCount = 0
	if (prevCoreTurn) {
		for (let i = 0; i < Math.min(msgs.length, prevMsgs.length); i++) {
			if (JSON.stringify(msgs[i]) !== JSON.stringify(prevMsgs[i])) compressedCount++
		}
	}

	const overheadMarkers = entry.overheadBefore.map(oh => ({
		phase: oh.phase,
		turns: oh.turns,
		overallStartIndex: oh.overallStartIndex,
		isBatch: oh.phase === 'summarizer',
		afterLocalIndex: 0,
	}))

	return (
		<div ref={innerRef}>
			<div className="flex items-center gap-2 my-4">
				<div className="h-px flex-1" style={{ backgroundColor: phaseColors[turn.phase] ?? '#444', opacity: 0.3 }} />
				<div className="flex items-center gap-2 text-xs shrink-0">
					<span style={{ color: phaseColors[turn.phase] }}>{phaseIcons[turn.phase] ?? '⚙️'}</span>
					<span className="font-mono font-semibold text-(--text)">#{overallIndex + 1}</span>
					<span className="text-(--text-dim)">{turn.modelId}</span>
					<span className="text-(--text-dim)">{turn.inputTokens.toLocaleString('en-US')} in / {turn.outputTokens.toLocaleString('en-US')} out</span>
					<span className="text-(--text-dim) font-mono">{fmtCost(turn.cost)}</span>
					{compressedCount > 0 && (
						<span className="text-[10px] px-1.5 py-0.5 rounded bg-(--accent-dim) text-(--accent)">
							{compressedCount} compressed
						</span>
					)}
				</div>
				<div className="h-px flex-1" style={{ backgroundColor: phaseColors[turn.phase] ?? '#444', opacity: 0.3 }} />
			</div>

			{newMsgs.length > 0 && (
				<div className="mb-2">
					{newMsgs.map((msg, i) => <UserMsgCompact key={i} msg={msg} />)}
				</div>
			)}

			<div className="ml-4 border-l-2 pl-3 space-y-1" style={{ borderColor: phaseColors[turn.phase] ?? '#fbbf24' }}>
				{response.map((block, i) => <ResponseCompact key={i} block={block} />)}
			</div>

			<div className="mt-2 flex justify-end">
				<button
					onClick={onToggle}
					className="text-[10px] text-(--text-dim) hover:text-(--text) transition-colors px-2 py-0.5 rounded hover:bg-(--bg-hover)"
				>
					{expanded ? '▲ Hide full context' : '▼ View full context'}
				</button>
			</div>

			{expanded && (
				<div className="mt-2 border border-(--border) rounded-lg p-4 bg-(--bg-card)">
					<TurnViewer
						turns={prevCoreTurn ? [prevCoreTurn, turn] : [turn]}
						overallStartIndex={prevCoreTurn ? entry.prevOverallIndex : overallIndex}
						overallIndices={prevCoreTurn ? [entry.prevOverallIndex, overallIndex] : [overallIndex]}
						selectedTurn={overallIndex}
						selectionKey={1}
						overheadMarkers={overheadMarkers}
					/>
				</div>
			)}
		</div>
	)
}

export function CycleContent({ turns, initialTurn }: { turns: Turn[]; initialTurn?: number }) {
	const [expandedTurn, setExpandedTurn] = useState<number | null>(null)
	const turnRefs = useRef<Map<number, HTMLElement>>(new Map())

	const flow = useMemo(() => buildFlow(turns), [turns])
	const phaseRuns = useMemo(() => computePhaseRuns(flow), [flow])

	useEffect(() => {
		if (initialTurn === undefined) return
		requestAnimationFrame(() => {
			const el = turnRefs.current.get(initialTurn)
			el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
		})
	}, []) // eslint-disable-line react-hooks/exhaustive-deps

	const handleTurnClick = useCallback((overallIndex: number) => {
		const el = turnRefs.current.get(overallIndex)
		el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
	}, [])

	const handleMinimapClick = useCallback((runIndex: number) => {
		const run = phaseRuns[runIndex]
		if (run) {
			const el = turnRefs.current.get(run.startIndex)
			el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
		}
	}, [phaseRuns])

	const handleDownload = useCallback(() => {
		const md = buildConversationMd(flow, turns)
		const id = turns[0]?.iterationId?.slice(-8) ?? 'cycle'
		downloadMd(md, `conversation-${id}.md`)
	}, [flow, turns])

	return (
		<>
			<CycleSearch turns={turns} onNavigate={handleTurnClick} />
			<CycleStats turns={turns} onTurnClick={handleTurnClick} />

			<div className="flex justify-end mb-3">
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
							expanded={expandedTurn === entry.overallIndex}
							onToggle={() => setExpandedTurn(expandedTurn === entry.overallIndex ? null : entry.overallIndex)}
							innerRef={el => {
								if (el) turnRefs.current.set(entry.overallIndex, el)
								else turnRefs.current.delete(entry.overallIndex)
							}}
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

	useEffect(() => {
		let raf = 0
		const update = () => {
			cancelAnimationFrame(raf)
			raf = requestAnimationFrame(() => {
				const refs = turnRefs.current
				if (!refs || !trackRef.current || !markerRef.current) return

				const heights: number[] = []
				for (const run of phaseRuns) {
					const el = refs.get(run.startIndex)
					heights.push(el?.offsetHeight ?? 100)
				}
				const totalH = heights.reduce((a, b) => a + b, 0) || 1

				for (let i = 0; i < heights.length; i++) {
					const pct = `${(heights[i] / totalH) * 100}%`
					if (segmentRefs.current[i]) segmentRefs.current[i].style.height = pct
					if (labelRefs.current[i]) labelRefs.current[i].style.height = pct
				}

				const firstEl = refs.get(phaseRuns[0]?.startIndex ?? 0)
				const contentTop = firstEl ? firstEl.getBoundingClientRect().top + window.scrollY : 0
				const contentBottom = contentTop + totalH
				const progress = Math.max(0, Math.min(1, (window.scrollY - contentTop) / (contentBottom - contentTop)))

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

	return (
		<div className="fixed right-3 top-4 bottom-4 z-50 flex items-start gap-1">
			<div
				ref={trackRef}
				className="relative rounded-full overflow-hidden bg-(--bg-card) border border-(--border) h-full"
				style={{ width: 10 }}
			>
				{phaseRuns.map((run, i) => (
					<div
						key={i}
						ref={el => { if (el) segmentRefs.current[i] = el }}
						className="w-full cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
						style={{
							height: `${(1 / phaseRuns.length) * 100}%`,
							minHeight: 6,
							backgroundColor: phaseColors[run.phase] ?? '#737373',
						}}
						onClick={() => onSegmentClick(i)}
					/>
				))}
				<div
					ref={markerRef}
					className="absolute left-0 w-full h-[3px] rounded-full bg-white shadow-[0_0_4px_rgba(255,255,255,0.6)]"
					style={{ top: 0 }}
				/>
			</div>

			<div className="flex flex-col h-full">
				{phaseRuns.map((run, i) => (
					<div
						key={i}
						ref={el => { if (el) labelRefs.current[i] = el }}
						className="flex items-center cursor-pointer group"
						style={{ height: `${(1 / phaseRuns.length) * 100}%`, minHeight: 6 }}
						onClick={() => onSegmentClick(i)}
					>
						<span
							className="text-[9px] leading-none group-hover:text-(--text) transition-colors capitalize whitespace-nowrap"
							style={{ color: phaseColors[run.phase] ?? '#737373' }}
						>
							{run.phase[0]?.toUpperCase()}{run.count > 1 ? ` ×${run.count}` : ''}
						</span>
					</div>
				))}
			</div>
		</div>
	)
}
