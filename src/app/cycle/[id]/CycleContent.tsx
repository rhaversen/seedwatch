'use client'

import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { CycleStats } from './CycleStats'
import { TurnViewer } from './TurnViewer'

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

interface PhaseGroup {
	phase: string
	turns: Turn[]
	overallStartIndex: number
}

const phaseColors: Record<string, string> = {
	planner: '#3b82f6',
	builder: '#22c55e',
	reflect: '#f59e0b',
	memory: '#a855f7',
}

const phaseIcons: Record<string, string> = {
	planner: '🧭',
	builder: '🔧',
	reflect: '🪞',
	memory: '🧠',
}

export function CycleContent({ turns }: { turns: Turn[] }) {
	const [selectedTurn, setSelectedTurn] = useState<number | undefined>(undefined)
	const [selectionKey, setSelectionKey] = useState(0)
	const sectionRefs = useRef<Map<number, HTMLElement>>(new Map())

	const phaseGroups = useMemo(() => {
		const groups: PhaseGroup[] = []
		let offset = 0
		for (const turn of turns) {
			const last = groups[groups.length - 1]
			if (last && last.phase === turn.phase) {
				last.turns.push(turn)
			} else {
				groups.push({ phase: turn.phase, turns: [turn], overallStartIndex: offset })
			}
			offset++
		}
		return groups
	}, [turns])

	const handleTurnClick = useCallback((overallIndex: number) => {
		setSelectedTurn(overallIndex)
		setSelectionKey(k => k + 1)
		const group = phaseGroups.find(g =>
			overallIndex >= g.overallStartIndex &&
			overallIndex < g.overallStartIndex + g.turns.length,
		)
		if (group) {
			const el = sectionRefs.current.get(group.overallStartIndex)
			el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
							<span className="text-sm font-normal text-(--text-dim)">
								({group.turns.length} turn{group.turns.length !== 1 ? 's' : ''})
							</span>
						</h2>
						<TurnViewer
							turns={group.turns}
							overallStartIndex={group.overallStartIndex}
							selectedTurn={selectedTurn}
							selectionKey={selectionKey}
						/>
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
