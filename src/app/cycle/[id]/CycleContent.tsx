'use client'

import { useMemo, useState, useRef, useCallback } from 'react'
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

	return (
		<>
			<CycleStats turns={turns} onTurnClick={handleTurnClick} />

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
		</>
	)
}
