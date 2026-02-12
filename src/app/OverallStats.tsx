'use client'

import { useMemo, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface TurnStatRow {
	phase: string
	inputTokens: number
	outputTokens: number
	cost: number
	createdAt: string
	cycleId: string
	turnInCycle: number
}

interface CycleBoundary {
	index: number
	label: string
}

const phaseColors: Record<string, string> = {
	planner: '#3b82f6',
	builder: '#22c55e',
	reflect: '#f59e0b',
	memory: '#a855f7',
}

const LINE_H = 160
const BAR_H = 80
const GAP = 20
const PAD_L = 56
const PAD_R = 52
const PAD_T = 12
const PAD_B = 22
const TOTAL_H = LINE_H + GAP + BAR_H + PAD_T + PAD_B

function fmt(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
	return String(n)
}

function fmtCost(n: number): string {
	if (n >= 0.01) return `$${n.toFixed(2)}`
	if (n >= 0.001) return `$${n.toFixed(3)}`
	return `$${n.toFixed(4)}`
}

export function OverallStats({ turns }: { turns: TurnStatRow[] }) {
	const [hover, setHover] = useState<number | null>(null)
	const svgRef = useRef<SVGSVGElement>(null)
	const router = useRouter()

	const { cycleBoundaries, cumCosts } = useMemo(() => {
		const boundaries: CycleBoundary[] = []
		let prevPhase = ''
		let cycleNum = 0
		for (let i = 0; i < turns.length; i++) {
			if (turns[i].phase === 'planner' && prevPhase !== 'planner') {
				cycleNum++
				boundaries.push({ index: i, label: `#${cycleNum}` })
			}
			prevPhase = turns[i].phase
		}

		const cum: number[] = []
		let acc = 0
		for (const t of turns) { acc += t.cost; cum.push(acc) }

		return { cycleBoundaries: boundaries, cumCosts: cum }
	}, [turns])

	if (turns.length < 2) return null

	const n = turns.length
	const totalIn = turns.reduce((s, t) => s + t.inputTokens, 0)
	const totalOut = turns.reduce((s, t) => s + t.outputTokens, 0)
	const totalCost = turns.reduce((s, t) => s + t.cost, 0)

	const maxTokens = Math.max(...turns.map(t => Math.max(t.inputTokens, t.outputTokens)), 1)
	const maxCost = Math.max(...turns.map(t => t.cost), 0.0001)
	const maxCum = cumCosts[cumCosts.length - 1] || 1

	const chartW = 700
	const plotW = chartW - PAD_L - PAD_R

	function x(i: number) { return PAD_L + (i / (n - 1)) * plotW }
	function yToken(v: number) { return PAD_T + LINE_H - (v / maxTokens) * LINE_H }
	function yCost(v: number) { return PAD_T + LINE_H - (v / maxCost) * LINE_H }

	const barTop = PAD_T + LINE_H + GAP
	function yCum(v: number) { return barTop + BAR_H - (v / maxCum) * BAR_H }

	function polyline(vals: number[], yFn: (v: number) => number): string {
		return vals.map((v, i) => `${x(i).toFixed(1)},${yFn(v).toFixed(1)}`).join(' ')
	}

	const inputLine = polyline(turns.map(t => t.inputTokens), yToken)
	const outputLine = polyline(turns.map(t => t.outputTokens), yToken)
	const costLine = polyline(turns.map(t => t.cost), yCost)
	const cumLine = polyline(cumCosts, yCum)

	const cumAreaPts = cumCosts.map((v, i) => `${x(i).toFixed(1)},${yCum(v).toFixed(1)}`).join(' ')
	const cumArea = `M${PAD_L.toFixed(1)},${(barTop + BAR_H).toFixed(1)} L${cumAreaPts} L${x(n - 1).toFixed(1)},${(barTop + BAR_H).toFixed(1)} Z`

	const yTicks = 4
	const tokenTicks = Array.from({ length: yTicks + 1 }, (_, i) => (maxTokens / yTicks) * i)
	const costTicks = Array.from({ length: yTicks + 1 }, (_, i) => (maxCost / yTicks) * i)

	function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
		const svg = svgRef.current
		if (!svg) return
		const rect = svg.getBoundingClientRect()
		const mx = ((e.clientX - rect.left) / rect.width) * chartW
		const closest = turns.reduce((best, _, i) => {
			const dist = Math.abs(x(i) - mx)
			return dist < best.dist ? { dist, i } : best
		}, { dist: Infinity, i: -1 })
		setHover(closest.i >= 0 ? closest.i : null)
	}

	const cycleForTurn = (idx: number) => {
		let num = 0
		for (const b of cycleBoundaries) {
			if (b.index <= idx) num++
			else break
		}
		return num
	}

	return (
		<div className="border border-(--border) rounded-lg p-5 mb-6">
			<div className="flex items-center justify-between mb-3">
				<h2 className="text-sm font-semibold">All Cycles</h2>
				<div className="flex gap-5 text-xs text-(--text-dim)">
					<span>{cycleBoundaries.length} cycles</span>
					<span>{n} turns</span>
					<span><span className="font-mono text-(--text)">{fmt(totalIn)}</span> in / <span className="font-mono text-(--text)">{fmt(totalOut)}</span> out</span>
					<span><span className="font-mono text-(--text)">{fmtCost(totalCost)}</span></span>
				</div>
			</div>

			<svg
				ref={svgRef}
				viewBox={`0 0 ${chartW} ${TOTAL_H}`}
				className="w-full cursor-pointer"
				onMouseMove={onMouseMove}
				onMouseLeave={() => setHover(null)}
				onClick={() => {
					if (hover !== null) {
						const t = turns[hover]
						router.push(`/cycle/${t.cycleId}?turn=${t.turnInCycle}`)
					}
				}}
			>
				{/* Y-axis gridlines + labels */}
				{tokenTicks.map((v, i) => {
					const y = yToken(v)
					return (
						<g key={`tg-${i}`}>
							{i > 0 && <line x1={PAD_L} x2={chartW - PAD_R} y1={y} y2={y} stroke="#262626" strokeWidth={0.5} />}
							<text x={PAD_L - 6} y={y + 3} textAnchor="end" fill="#737373" fontSize={9} fontFamily="monospace">{fmt(v)}</text>
						</g>
					)
				})}
				{costTicks.map((v, i) => {
					const y = yCost(v)
					return (
						<text key={`cg-${i}`} x={chartW - PAD_R + 4} y={y + 3} textAnchor="start" fill="#737373" fontSize={8} fontFamily="monospace">
							{i > 0 ? fmtCost(v) : ''}
						</text>
					)
				})}

				{/* Axes */}
				<line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={PAD_T + LINE_H} stroke="#404040" strokeWidth={1} />
				<line x1={PAD_L} x2={chartW - PAD_R} y1={PAD_T + LINE_H} y2={PAD_T + LINE_H} stroke="#404040" strokeWidth={1} />

				{/* Cycle boundary lines */}
				{cycleBoundaries.map((b, i) => (
					<g key={`cb-${i}`}>
						<line x1={x(b.index)} x2={x(b.index)} y1={PAD_T} y2={barTop + BAR_H} stroke="#333" strokeWidth={0.5} strokeDasharray="3 3" />
					</g>
				))}

				{/* Lines */}
				<polyline points={inputLine} fill="none" stroke="#60a5fa" strokeWidth={1.5} strokeLinejoin="round" opacity={0.6} />
				<polyline points={outputLine} fill="none" stroke="#f59e0b" strokeWidth={2} strokeLinejoin="round" />
				<polyline points={costLine} fill="none" stroke="#a855f7" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" />

				{/* Data points */}
				{turns.map((t, i) => (
					<g key={`pts-${i}`}>
						<circle cx={x(i)} cy={yToken(t.outputTokens)} r={hover === i ? 4 : 1.5} fill="#f59e0b" />
						<circle cx={x(i)} cy={yCost(t.cost)} r={hover === i ? 3 : 1} fill="#a855f7" />
					</g>
				))}

				{/* X-axis phase dots */}
				{turns.map((t, i) => (
					<circle key={`pd-${i}`} cx={x(i)} cy={PAD_T + LINE_H + 8} r={2} fill={phaseColors[t.phase] ?? '#737373'} />
				))}

				{/* Cumulative cost chart */}
				<path d={cumArea} fill="#a855f7" opacity={0.1} />
				<polyline points={cumLine} fill="none" stroke="#a855f7" strokeWidth={1.5} strokeLinejoin="round" />

				{/* Cumulative axis labels */}
				<text x={PAD_L - 6} y={barTop + 4} textAnchor="end" fill="#737373" fontSize={8} fontFamily="monospace">{fmtCost(maxCum)}</text>
				<text x={PAD_L - 6} y={barTop + BAR_H + 2} textAnchor="end" fill="#737373" fontSize={8} fontFamily="monospace">$0.00</text>
				<text x={PAD_L + 2} y={barTop + 10} fill="#737373" fontSize={8}>cumulative cost</text>

				{/* Hover tooltip */}
				{hover !== null && (
					<g>
						<line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={barTop + BAR_H} stroke="#555" strokeWidth={0.5} strokeDasharray="2 2" />
						<rect
							x={Math.min(x(hover) + 8, chartW - 170)}
							y={PAD_T}
							width={160}
							height={76}
							rx={4}
							fill="#1a1a1a"
							stroke="#333"
							strokeWidth={0.5}
						/>
						<text x={Math.min(x(hover) + 14, chartW - 164)} y={PAD_T + 14} fill="#e5e5e5" fontSize={10} fontWeight="600">
							Turn {hover + 1} · cycle {cycleForTurn(hover)} · {turns[hover].phase}
						</text>
						<text x={Math.min(x(hover) + 14, chartW - 164)} y={PAD_T + 28} fill="#60a5fa" fontSize={9} fontFamily="monospace">
							In: {fmt(turns[hover].inputTokens)}
						</text>
						<text x={Math.min(x(hover) + 14, chartW - 164)} y={PAD_T + 40} fill="#f59e0b" fontSize={9} fontFamily="monospace">
							Out: {fmt(turns[hover].outputTokens)}
						</text>
						<text x={Math.min(x(hover) + 14, chartW - 164)} y={PAD_T + 52} fill="#a855f7" fontSize={9} fontFamily="monospace">
							Cost: {fmtCost(turns[hover].cost)}
						</text>
						<text x={Math.min(x(hover) + 14, chartW - 164)} y={PAD_T + 64} fill="#c084fc" fontSize={9} fontFamily="monospace">
							Total: {fmtCost(cumCosts[hover])}
						</text>
					</g>
				)}
			</svg>

			{/* Legend */}
			<div className="flex items-center justify-between mt-2">
				<div className="flex gap-4 text-[10px] text-(--text-dim) flex-wrap">
					<span className="flex items-center gap-1"><span className="inline-block w-5 h-0.5 opacity-60" style={{ backgroundColor: '#60a5fa' }} /> Input tokens</span>
					<span className="flex items-center gap-1"><span className="inline-block w-5 h-0.5" style={{ backgroundColor: '#f59e0b' }} /> Output tokens</span>
					<span className="flex items-center gap-1"><span className="inline-block w-5 h-0.5 border-t border-dashed" style={{ borderColor: '#a855f7' }} /> Cost/turn</span>
					<span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#a855f7', opacity: 0.3 }} /> Cumulative cost</span>
				</div>
				<div className="flex gap-3 text-[10px] text-(--text-dim)">
					{Object.entries(phaseColors).map(([p, c]) => (
						<span key={p} className="flex items-center gap-1">
							<span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: c }} />
							{p}
						</span>
					))}
				</div>
			</div>
		</div>
	)
}
