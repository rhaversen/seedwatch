'use client'

import { useMemo, useState, useRef } from 'react'

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
type Msg = Record<string, any>

interface TurnStat {
	index: number
	phase: string
	inputTokens: number
	outputTokens: number
	cost: number
	userChars: number
	assistantChars: number
	systemChars: number
	totalChars: number
	charDelta: number
}

function charLen(msg: Msg): number {
	if (typeof msg.content === 'string') return msg.content.length
	if (Array.isArray(msg.content)) {
		return msg.content.reduce((s: number, b: Msg) => {
			if (b.type === 'text') return s + (b.text?.length ?? 0)
			if (b.type === 'tool_result') {
				const t = typeof b.content === 'string' ? b.content : JSON.stringify(b.content)
				return s + t.length
			}
			if (b.type === 'tool_use') return s + JSON.stringify(b.input ?? '').length
			return s + JSON.stringify(b).length
		}, 0)
	}
	return JSON.stringify(msg).length
}

function systemLen(blocks: unknown[]): number {
	return blocks.reduce((s: number, b) => {
		if (typeof b === 'string') return s + b.length
		return s + ((b as Msg).text?.length ?? JSON.stringify(b).length)
	}, 0)
}

function computeStats(turns: Turn[]): TurnStat[] {
	return turns.map((t, i) => {
		const msgs = t.messages as Msg[]
		let userChars = 0, assistantChars = 0
		for (const m of msgs) {
			const len = charLen(m)
			if (m.role === 'user') userChars += len
			else if (m.role === 'assistant') assistantChars += len
		}
		const systemChars = systemLen(t.system)
		const totalChars = userChars + assistantChars + systemChars

		const samePhaseAsPrev = i > 0 && turns[i - 1].phase === t.phase

		const prevTotal = (i > 0 && samePhaseAsPrev) ? (() => {
			const pm = turns[i - 1].messages as Msg[]
			let pt = 0
			for (const m of pm) pt += charLen(m)
			return pt + systemLen(turns[i - 1].system)
		})() : 0

		return {
			index: i,
			phase: t.phase,
			inputTokens: t.inputTokens,
			outputTokens: t.outputTokens,
			cost: t.cost,
			userChars,
			assistantChars,
			systemChars,
			totalChars,
			charDelta: samePhaseAsPrev ? totalChars - prevTotal : 0,
		}
	})
}

const phaseColors: Record<string, string> = {
	planner: '#3b82f6',
	builder: '#22c55e',
	reflect: '#f59e0b',
	memory: '#a855f7',
}

const LINE_H = 180
const BAR_H = 100
const GAP = 24
const PAD_L = 56
const PAD_R = 16
const PAD_T = 12
const PAD_B = 22
const TOTAL_H = LINE_H + GAP + BAR_H + PAD_T + PAD_B

function fmt(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
	return String(n)
}

function fmtCost(n: number): string {
	return `$${n.toFixed(4)}`
}

export function CycleStats({ turns }: { turns: Turn[] }) {
	const stats = useMemo(() => computeStats(turns), [turns])
	const [hover, setHover] = useState<number | null>(null)
	const svgRef = useRef<SVGSVGElement>(null)

	if (turns.length < 2) return null

	const n = stats.length
	const totalIn = stats.reduce((s, t) => s + t.inputTokens, 0)
	const totalOut = stats.reduce((s, t) => s + t.outputTokens, 0)
	const totalCost = stats.reduce((s, t) => s + t.cost, 0)

	const maxTokens = Math.max(...stats.map(s => Math.max(s.inputTokens, s.outputTokens)), 1)
	const maxRoleChars = Math.max(...stats.map(s => s.userChars + s.assistantChars + s.systemChars), 1)
	const maxCost = Math.max(...stats.map(s => s.cost), 0.0001)

	const deltas = stats.slice(1)
	const maxDelta = Math.max(...deltas.map(s => Math.abs(s.charDelta)), 1)

	const chartW = 700
	const plotW = chartW - PAD_L - PAD_R

	function x(i: number) { return PAD_L + (i / (n - 1)) * plotW }
	function yToken(v: number) { return PAD_T + LINE_H - (v / maxTokens) * LINE_H }
	function yCost(v: number) { return PAD_T + LINE_H - (v / maxCost) * LINE_H }

	const barTop = PAD_T + LINE_H + GAP
	const barMid = barTop + BAR_H / 2
	function polyline(vals: number[], yFn: (v: number) => number): string {
		return vals.map((v, i) => `${x(i).toFixed(1)},${yFn(v).toFixed(1)}`).join(' ')
	}

	const outputLine = polyline(stats.map(s => s.outputTokens), yToken)
	const costLine = polyline(stats.map(s => s.cost), yCost)

	function yRole(v: number) { return PAD_T + LINE_H - (v / maxRoleChars) * LINE_H }
	function roleAreaPath(topVals: number[], botVals: number[]): string {
		const pts: string[] = []
		for (let i = 0; i < n; i++) pts.push(`${x(i).toFixed(1)},${yRole(topVals[i]).toFixed(1)}`)
		for (let i = n - 1; i >= 0; i--) pts.push(`${x(i).toFixed(1)},${yRole(botVals[i]).toFixed(1)}`)
		return `M${pts.join('L')}Z`
	}
	const sysTop = stats.map(s => s.systemChars)
	const usrTop = stats.map(s => s.systemChars + s.userChars)
	const allTop = stats.map(s => s.systemChars + s.userChars + s.assistantChars)
	const zero = stats.map(() => 0)
	const systemArea = roleAreaPath(sysTop, zero)
	const userArea = roleAreaPath(usrTop, sysTop)
	const assistantArea = roleAreaPath(allTop, usrTop)

	const barW = Math.max(4, Math.min(24, plotW / n * 0.6))

	const yTicks = 4
	const tokenTicks = Array.from({ length: yTicks + 1 }, (_, i) => (maxTokens / yTicks) * i)
	const costTicks = Array.from({ length: yTicks + 1 }, (_, i) => (maxCost / yTicks) * i)

	function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
		const svg = svgRef.current
		if (!svg) return
		const rect = svg.getBoundingClientRect()
		const mx = ((e.clientX - rect.left) / rect.width) * chartW
		const closest = stats.reduce((best, s, i) => {
			const dist = Math.abs(x(i) - mx)
			return dist < best.dist ? { dist, i } : best
		}, { dist: Infinity, i: -1 })
		setHover(closest.i >= 0 ? closest.i : null)
	}

	return (
		<div className="border border-(--border) rounded-lg p-5 mb-6">
			<div className="flex items-center justify-between mb-3">
				<h2 className="text-sm font-semibold">Statistics</h2>
				<div className="flex gap-5 text-xs text-(--text-dim)">
					<span>{n} calls</span>
					<span><span className="font-mono text-(--text)">{fmt(totalIn)}</span> in / <span className="font-mono text-(--text)">{fmt(totalOut)}</span> out tokens</span>
					<span><span className="font-mono text-(--text)">${totalCost.toFixed(4)}</span></span>
				</div>
			</div>

			<svg
				ref={svgRef}
				viewBox={`0 0 ${chartW} ${TOTAL_H}`}
				className="w-full"
				onMouseMove={onMouseMove}
				onMouseLeave={() => setHover(null)}
			>
				{/* Y-axis gridlines + labels (tokens left, cost right) */}
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

				{/* Stacked area: role char breakdown */}
				<path d={systemArea} fill="#c084fc" opacity={0.25} />
				<path d={userArea} fill="#60a5fa" opacity={0.25} />
				<path d={assistantArea} fill="#fbbf24" opacity={0.25} />

				{/* Lines */}
				<polyline points={outputLine} fill="none" stroke="#f59e0b" strokeWidth={2} strokeLinejoin="round" />
				<polyline points={costLine} fill="none" stroke="#a855f7" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" />

				{/* Data points */}
				{stats.map((s, i) => (
					<g key={`pts-${i}`}>
						<circle cx={x(i)} cy={yToken(s.outputTokens)} r={hover === i ? 4 : 2.5} fill="#f59e0b" />
						<circle cx={x(i)} cy={yCost(s.cost)} r={hover === i ? 3.5 : 2} fill="#a855f7" />
					</g>
				))}

				{/* X-axis labels + phase dots (shared between both charts) */}
				{stats.map((s, i) => (
					<g key={`xl-${i}`}>
						<circle cx={x(i)} cy={PAD_T + LINE_H + 10} r={3} fill={phaseColors[s.phase] ?? '#737373'} />
						{(n <= 20 || i % Math.ceil(n / 20) === 0) && (
							<text x={x(i)} y={PAD_T + LINE_H + 20} textAnchor="middle" fill="#737373" fontSize={8} fontFamily="monospace">
								{i + 1}
							</text>
						)}
					</g>
				))}

				{/* Bar chart: char delta */}
				<line x1={PAD_L} x2={chartW - PAD_R} y1={barMid} y2={barMid} stroke="#404040" strokeWidth={0.5} />
				{deltas.map(s => {
					const bx = x(s.index) - barW / 2
					const isNeg = s.charDelta < 0
					const h = (Math.abs(s.charDelta) / maxDelta) * (BAR_H / 2)
					const by = isNeg ? barMid : barMid - h

					return (
						<rect
							key={`bar-${s.index}`}
							x={bx}
							y={by}
							width={barW}
							height={h}
							rx={2}
							fill={isNeg ? '#ef4444' : '#22c55e'}
							opacity={hover === s.index ? 1 : 0.7}
						/>
					)
				})}

				{/* Bar axis labels */}
				<text x={PAD_L - 6} y={barTop + 4} textAnchor="end" fill="#737373" fontSize={8} fontFamily="monospace">+{fmt(maxDelta)}</text>
				<text x={PAD_L - 6} y={barMid + 3} textAnchor="end" fill="#737373" fontSize={8} fontFamily="monospace">0</text>
				<text x={PAD_L - 6} y={barTop + BAR_H + 2} textAnchor="end" fill="#737373" fontSize={8} fontFamily="monospace">−{fmt(maxDelta)}</text>

				{/* Hover crosshair + tooltip */}
				{hover !== null && (
					<g>
						<line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={barTop + BAR_H} stroke="#555" strokeWidth={0.5} strokeDasharray="2 2" />
						<rect
							x={Math.min(x(hover) + 8, chartW - 185)}
							y={PAD_T}
							width={175}
							height={98}
							rx={4}
							fill="#1a1a1a"
							stroke="#333"
							strokeWidth={0.5}
						/>
						<text x={Math.min(x(hover) + 14, chartW - 179)} y={PAD_T + 14} fill="#e5e5e5" fontSize={10} fontWeight="600">
							Turn {hover + 1} — {stats[hover].phase}
						</text>
						<text x={Math.min(x(hover) + 14, chartW - 179)} y={PAD_T + 28} fill="#f59e0b" fontSize={9} fontFamily="monospace">
							Out: {fmt(stats[hover].outputTokens)}
						</text>
						<text x={Math.min(x(hover) + 14, chartW - 179)} y={PAD_T + 40} fill="#a855f7" fontSize={9} fontFamily="monospace">
							Cost: {fmtCost(stats[hover].cost)}
						</text>
						<text x={Math.min(x(hover) + 14, chartW - 179)} y={PAD_T + 52} fill="#60a5fa" fontSize={9} fontFamily="monospace">
							User: {fmt(stats[hover].userChars)}
						</text>
						<text x={Math.min(x(hover) + 14, chartW - 179)} y={PAD_T + 64} fill="#fbbf24" fontSize={9} fontFamily="monospace">
							Asst: {fmt(stats[hover].assistantChars)}
						</text>
						<text x={Math.min(x(hover) + 14, chartW - 179)} y={PAD_T + 76} fill="#c084fc" fontSize={9} fontFamily="monospace">
							Sys: {fmt(stats[hover].systemChars)}
						</text>
						{hover > 0 && stats[hover].charDelta !== 0 && (
							<text
								x={Math.min(x(hover) + 14, chartW - 179)}
								y={PAD_T + 88}
								fill={stats[hover].charDelta <= 0 ? '#22c55e' : '#ef4444'}
								fontSize={9}
								fontFamily="monospace"
							>
								Δ: {stats[hover].charDelta > 0 ? '+' : ''}{fmt(stats[hover].charDelta)} chars
							</text>
						)}
					</g>
				)}
			</svg>

			{/* Legend */}
			<div className="flex items-center justify-between mt-2">
				<div className="flex gap-4 text-[10px] text-(--text-dim) flex-wrap">
					<span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#60a5fa', opacity: 0.45 }} /> User</span>
					<span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#fbbf24', opacity: 0.45 }} /> Assistant</span>
					<span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#c084fc', opacity: 0.45 }} /> System</span>
					<span className="flex items-center gap-1"><span className="inline-block w-5 h-0.5" style={{ backgroundColor: '#f59e0b' }} /> Output tokens</span>
					<span className="flex items-center gap-1"><span className="inline-block w-5 h-0.5 border-t border-dashed" style={{ borderColor: '#a855f7' }} /> Cost</span>
					<span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#22c55e' }} /> Chars grew</span>
					<span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#ef4444' }} /> Chars reduced</span>
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
