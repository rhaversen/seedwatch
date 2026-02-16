'use client'

import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { CycleStats } from './CycleStats'
import { TurnViewer } from './TurnViewer'
import { BatchViewer } from './BatchViewer'
import type { GeneratedTurn as Turn } from '@/lib/data'
import { OVERHEAD_PHASES, phaseColors, phaseIcons } from '@/lib/phases'

interface OverheadMarker {
	phase: string
	turns: Turn[]
	overallStartIndex: number
	isBatch: boolean
	afterLocalIndex: number
}

interface PhaseGroup {
	phase: string
	turns: Turn[]
	overallStartIndex: number
	overallIndices: number[]
	isBatch: boolean
	overheadMarkers: OverheadMarker[]
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

function SimpleReflectView({ turn }: { turn: Turn }) {
	const [showTranscript, setShowTranscript] = useState(false)
	const response = (turn.response as Record<string, unknown>[])
	const responseText = response.map(b => {
		if (b.type === 'text') return b.text as string
		return JSON.stringify(b, null, 2)
	}).join('\n')
	const messages = turn.messages as Record<string, unknown>[]

	const costStr = turn.cost >= 0.01 ? `$${turn.cost.toFixed(2)}` : turn.cost >= 0.001 ? `$${turn.cost.toFixed(3)}` : `$${turn.cost.toFixed(4)}`

	return (
		<div className="border border-(--border) rounded-lg overflow-hidden">
			<div className="flex items-center justify-between px-3 py-2 border-b border-(--border) bg-(--bg-card)">
				<div className="flex items-center gap-3 text-xs text-(--text-dim)">
					<span>{turn.modelId}</span>
					<span>{turn.inputTokens.toLocaleString('en-US')} in / {turn.outputTokens.toLocaleString('en-US')} out</span>
					<span className="font-mono">{costStr}</span>
				</div>
				<button
					onClick={() => setShowTranscript(!showTranscript)}
					className="text-xs text-(--text-dim) hover:text-(--text) transition-colors"
				>
					{showTranscript ? 'hide transcript' : 'show transcript'}
				</button>
			</div>
			{showTranscript && (
				<div className="border-b border-(--border) p-3 space-y-1 max-h-60 overflow-y-auto">
					{messages.map((msg, i) => (
						<div key={i} className="text-xs">
							<span className={`font-semibold ${msg.role === 'user' ? 'text-(--blue)' : msg.role === 'assistant' ? 'text-(--warn)' : 'text-purple-400'}`}>
								{msg.role as string}
							</span>
							<pre className="text-(--text-dim) whitespace-pre-wrap wrap-break-word font-mono ml-2 mt-0.5 opacity-60">
								{String(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)).slice(0, 500)}
								{String(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)).length > 500 ? '…' : ''}
							</pre>
						</div>
					))}
				</div>
			)}
			<div className="p-3">
				<pre className="text-sm whitespace-pre-wrap wrap-break-word font-mono max-h-96 overflow-y-auto">
					{responseText}
				</pre>
			</div>
		</div>
	)
}

function OverheadSection({ marker }: { marker: OverheadMarker }) {
	const [expanded, setExpanded] = useState(false)
	const totalCost = marker.turns.reduce((s, t) => s + t.cost, 0)
	const costStr = totalCost >= 0.01 ? `$${totalCost.toFixed(2)}` : totalCost >= 0.001 ? `$${totalCost.toFixed(3)}` : `$${totalCost.toFixed(4)}`

	return (
		<div
			className="my-2 border-l-2 pl-3 py-1 rounded-r"
			style={{ borderColor: phaseColors[marker.phase] ?? '#737373', backgroundColor: 'rgba(255,255,255,0.02)' }}
		>
			<button
				onClick={() => setExpanded(!expanded)}
				className="flex items-center gap-2 text-sm text-(--text-dim) hover:text-(--text) transition-colors w-full"
			>
				<span>{phaseIcons[marker.phase] ?? '⚙️'}</span>
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
						<BatchViewer turns={marker.turns} />
					) : (
						<TurnViewer turns={marker.turns} overallStartIndex={marker.overallStartIndex} />
					)}
				</div>
			)}
		</div>
	)
}

export function CycleContent({ turns, initialTurn }: { turns: Turn[]; initialTurn?: number }) {
	const [selectedTurn, setSelectedTurn] = useState<number | undefined>(initialTurn)
	const [selectionKey, setSelectionKey] = useState(initialTurn !== undefined ? 1 : 0)
	const sectionRefs = useRef<Map<number, HTMLElement>>(new Map())

	const phaseGroups = useMemo(() => {
		const groups: PhaseGroup[] = []
		let offset = 0
		let pendingOverhead: OverheadMarker[] = []

		for (const turn of turns) {
			if (OVERHEAD_PHASES.has(turn.phase)) {
				const lastOh = pendingOverhead[pendingOverhead.length - 1]
				if (lastOh && lastOh.phase === turn.phase && turn.phase === 'summarizer') {
					lastOh.turns.push(turn)
				} else {
					pendingOverhead.push({
						phase: turn.phase,
						turns: [turn],
						overallStartIndex: offset,
						isBatch: turn.phase === 'summarizer',
						afterLocalIndex: -1,
					})
				}
			} else {
				const last = groups[groups.length - 1]
				const shouldMerge = last
					&& last.phase === turn.phase
					&& !(turn.phase === 'builder' && last.turns.length > 0 && isFixPhaseStart(turn))
				if (shouldMerge) {
					if (pendingOverhead.length > 0) {
						for (const oh of pendingOverhead) oh.afterLocalIndex = last.turns.length - 1
						last.overheadMarkers.push(...pendingOverhead)
						pendingOverhead = []
					}
					last.turns.push(turn)
					last.overallIndices.push(offset)
				} else {
					const g: PhaseGroup = {
						phase: turn.phase,
						turns: [turn],
						overallStartIndex: offset,
						overallIndices: [offset],
						isBatch: false,
						overheadMarkers: [],
					}
					if (pendingOverhead.length > 0) {
						if (groups.length > 0) {
							const prev = groups[groups.length - 1]
							for (const oh of pendingOverhead) oh.afterLocalIndex = prev.turns.length - 1
							prev.overheadMarkers.push(...pendingOverhead)
						} else {
							g.overheadMarkers.push(...pendingOverhead)
						}
						pendingOverhead = []
					}
					groups.push(g)
				}
			}
			offset++
		}
		if (pendingOverhead.length > 0 && groups.length > 0) {
			const last = groups[groups.length - 1]
			for (const oh of pendingOverhead) oh.afterLocalIndex = last.turns.length - 1
			last.overheadMarkers.push(...pendingOverhead)
		}
		return groups
	}, [turns])

	useEffect(() => {
		if (initialTurn === undefined) return
		const group = phaseGroups.find(g =>
			initialTurn >= g.overallStartIndex &&
			initialTurn < g.overallStartIndex + g.turns.length,
		)
		if (group) {
			requestAnimationFrame(() => {
				const el = sectionRefs.current.get(group.overallStartIndex)
				el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
			})
		}
	}, []) // eslint-disable-line react-hooks/exhaustive-deps

	const handleTurnClick = useCallback((overallIndex: number) => {
		setSelectedTurn(overallIndex)
		setSelectionKey(k => k + 1)
		for (const group of phaseGroups) {
			const groupEnd = group.overallStartIndex + group.turns.length +
				group.overheadMarkers.reduce((s, m) => s + m.turns.length, 0)
			if (overallIndex >= group.overallStartIndex && overallIndex < groupEnd) {
				const el = sectionRefs.current.get(group.overallStartIndex)
				el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
				return
			}
		}
	}, [phaseGroups])

	const handleMinimapClick = useCallback((groupIndex: number) => {
		const group = phaseGroups[groupIndex]
		if (group) {
			const el = sectionRefs.current.get(group.overallStartIndex)
			el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
		}
	}, [phaseGroups])

	return (
		<>
			<CycleStats turns={turns} onTurnClick={handleTurnClick} />

			<div className="relative">
				{phaseGroups.map((group, gi) => (
					<section
						key={gi}
						ref={el => { if (el) sectionRefs.current.set(group.overallStartIndex, el) }}
						className="mb-8"
					>
						<h2 className="text-lg font-semibold mb-3 capitalize flex items-center gap-2">
							<span className="text-(--text-dim)">{phaseIcons[group.phase] ?? '⚙️'}</span>
							{group.phase}
							{group.phase === 'builder' && group.turns.length > 0 && isFixPhaseStart(group.turns[0]) && (
								<span className="text-sm font-normal text-(--error)">(fix)</span>
							)}
							{(group.phase !== 'reflect' || group.turns.length > 1) && (
								<span className="text-sm font-normal text-(--text-dim)">
									{group.isBatch
										? `(batch of ${group.turns.length})`
										: `(${group.turns.length} turn${group.turns.length !== 1 ? 's' : ''})`
									}
								</span>
							)}
						</h2>
						{group.isBatch ? (
							<>
								<BatchViewer turns={group.turns} />
								{group.overheadMarkers.map((marker, mi) => (
									<OverheadSection key={`oh-${mi}`} marker={marker} />
								))}
							</>
						) : group.phase === 'reflect' && group.turns.length === 1 ? (
							<>
								<SimpleReflectView turn={group.turns[0]} />
								{group.overheadMarkers.map((marker, mi) => (
									<OverheadSection key={`oh-${mi}`} marker={marker} />
								))}
							</>
						) : (
							<TurnViewer
								turns={group.turns}
								overallStartIndex={group.overallStartIndex}
								overallIndices={group.overallIndices}
								selectedTurn={selectedTurn}
								selectionKey={selectionKey}
								overheadMarkers={group.overheadMarkers}
							/>
						)}
					</section>
				))}
			</div>

			<Minimap
				phaseGroups={phaseGroups}
				sectionRefs={sectionRefs}
				onSegmentClick={handleMinimapClick}
			/>
		</>
	)
}

function Minimap({ phaseGroups, sectionRefs, onSegmentClick }: {
	phaseGroups: PhaseGroup[]
	sectionRefs: React.RefObject<Map<number, HTMLElement>>
	onSegmentClick: (groupIndex: number) => void
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
				const refs = sectionRefs.current
				if (!refs || !trackRef.current || !markerRef.current) return

				const heights: number[] = []
				for (const g of phaseGroups) {
					const el = refs.get(g.overallStartIndex)
					heights.push(el?.offsetHeight ?? 100)
				}
				const totalH = heights.reduce((a, b) => a + b, 0) || 1

				for (let i = 0; i < heights.length; i++) {
					const pct = `${(heights[i] / totalH) * 100}%`
					if (segmentRefs.current[i]) segmentRefs.current[i].style.height = pct
					if (labelRefs.current[i]) labelRefs.current[i].style.height = pct
				}

				const firstEl = refs.get(phaseGroups[0]?.overallStartIndex ?? 0)
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
	}, [phaseGroups, sectionRefs])

	return (
		<div className="fixed right-3 top-4 bottom-4 z-50 flex items-start gap-1">
			<div
				ref={trackRef}
				className="relative rounded-full overflow-hidden bg-(--bg-card) border border-(--border) h-full"
				style={{ width: 10 }}
			>
				{phaseGroups.map((g, i) => (
					<div
						key={i}
						ref={el => { if (el) segmentRefs.current[i] = el }}
						className="w-full cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
						style={{
							height: `${(1 / phaseGroups.length) * 100}%`,
							minHeight: 6,
							backgroundColor: phaseColors[g.phase] ?? '#737373',
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
				{phaseGroups.map((g, i) => (
					<div
						key={i}
						ref={el => { if (el) labelRefs.current[i] = el }}
						className="flex items-center cursor-pointer group"
						style={{ height: `${(1 / phaseGroups.length) * 100}%`, minHeight: 6 }}
						onClick={() => onSegmentClick(i)}
					>
						<span
							className="text-[9px] leading-none group-hover:text-(--text) transition-colors capitalize whitespace-nowrap"
							style={{ color: phaseColors[g.phase] ?? '#737373' }}
						>
							{g.phase[0]?.toUpperCase()}{g.turns.length > 1 ? ` ×${g.turns.length}` : ''}
						</span>
					</div>
				))}
			</div>
		</div>
	)
}
