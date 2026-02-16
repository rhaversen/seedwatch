'use client'

import { useMemo, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { TurnStatRow } from '@/lib/data'
import { OVERHEAD_PHASES, phaseColors } from '@/lib/phases'

interface CoreEntry {
	row: TurnStatRow
	batchSize: number
	systemChars: number
	userChars: number
	assistantChars: number
	userMsgChars: number[]
	assistantMsgChars: number[]
	outputTokens: number
	cost: number
	overheadBefore: { phase: string; count: number; cost: number }[]
}

function buildCoreEntries(turns: TurnStatRow[]): CoreEntry[] {
	const entries: CoreEntry[] = []
	const pendingOverhead: { phase: string; count: number; cost: number }[] = []

	let i = 0
	while (i < turns.length) {
		const t = turns[i]

		if (OVERHEAD_PHASES.has(t.phase)) {
			if (t.phase === 'summarizer') {
				let j = i + 1
				while (j < turns.length && turns[j].phase === 'summarizer') j++
				const batchCost = turns.slice(i, j).reduce((s, b) => s + b.cost, 0)
				pendingOverhead.push({ phase: t.phase, count: j - i, cost: batchCost })
				i = j
			} else {
				const last = pendingOverhead[pendingOverhead.length - 1]
				if (last && last.phase === t.phase) { last.count++; last.cost += t.cost }
				else pendingOverhead.push({ phase: t.phase, count: 1, cost: t.cost })
				i++
			}
			continue
		}

		{
			entries.push({
				row: t,
				batchSize: 1,
				systemChars: t.systemChars,
				userChars: t.userChars,
				assistantChars: t.assistantChars,
				userMsgChars: [...t.userMsgChars],
				assistantMsgChars: [...t.assistantMsgChars],
				outputTokens: t.outputTokens,
				cost: t.cost,
				overheadBefore: pendingOverhead.splice(0),
			})
			i++
		}
	}
	return entries
}

const LINE_H = 180
const BAR_H = 100
const GAP = 36
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

	const entries = useMemo(() => buildCoreEntries(turns), [turns])

	const { cycleBoundaries, cumCosts } = useMemo(() => {
		const boundaries: { index: number }[] = []
		let lastCorePhase = ''
		let cycleNum = 0
		for (let i = 0; i < entries.length; i++) {
			if (entries[i].row.phase === 'planner' && (lastCorePhase === '' || lastCorePhase === 'reflect')) {
				cycleNum++
				boundaries.push({ index: i })
			}
			lastCorePhase = entries[i].row.phase
		}

		const cum: number[] = []
		let acc = 0
		for (const e of entries) {
			const ohCost = e.overheadBefore.reduce((s, o) => s + o.cost, 0)
			acc += ohCost + e.cost
			cum.push(acc)
		}
		return { cycleBoundaries: boundaries, cumCosts: cum }
	}, [entries])

	if (entries.length < 2) return null

	const n = entries.length
	const totalOut = entries.reduce((s, e) => s + e.outputTokens, 0)
	const totalCost = cumCosts[cumCosts.length - 1] || 0

	const maxRoleChars = Math.max(...entries.map(e => e.systemChars + e.userChars + e.assistantChars), 1)
	const maxOutputTokens = Math.max(...entries.map(e => e.outputTokens), 1)
	const maxCost = Math.max(...entries.map(e => e.cost), 0.0001)

	const charDeltas = entries.map((e, i) => {
		if (i === 0) return 0
		const prev = entries[i - 1]
		const curTotal = e.systemChars + e.userChars + e.assistantChars
		const prevTotal = prev.systemChars + prev.userChars + prev.assistantChars
		const samePhase = e.row.phase === prev.row.phase
		return samePhase ? curTotal - prevTotal : 0
	})
	const maxDelta = Math.max(...charDeltas.map(d => Math.abs(d)), 1)

	const chartW = 700
	const plotW = chartW - PAD_L - PAD_R

	function x(i: number) { return PAD_L + (i / (n - 1)) * plotW }
	function yRole(v: number) { return PAD_T + LINE_H - (v / maxRoleChars) * LINE_H }
	function yCost(v: number) { return PAD_T + LINE_H - (v / maxCost) * LINE_H }
	function yOut(v: number) { return PAD_T + LINE_H - (v / maxOutputTokens) * LINE_H }

	const barTop = PAD_T + LINE_H + GAP
	const barMid = barTop + BAR_H / 2

	function polyline(vals: number[], yFn: (v: number) => number): string {
		return vals.map((v, i) => `${x(i).toFixed(1)},${yFn(v).toFixed(1)}`).join(' ')
	}

	function roleAreaPath(topVals: number[], botVals: number[]): string {
		const pts: string[] = []
		for (let i = 0; i < n; i++) pts.push(`${x(i).toFixed(1)},${yRole(topVals[i]).toFixed(1)}`)
		for (let i = n - 1; i >= 0; i--) pts.push(`${x(i).toFixed(1)},${yRole(botVals[i]).toFixed(1)}`)
		return `M${pts.join('L')}Z`
	}

	const maxUserMsgs = Math.max(...entries.map(e => e.userMsgChars.length), 1)
	const maxAsstMsgs = Math.max(...entries.map(e => e.assistantMsgChars.length), 1)

	const logLum = (m: number, max: number, lo: number, hi: number) => {
		if (max <= 1) return lo
		const t = Math.log(1 + m) / Math.log(1 + max - 1)
		return lo + t * (hi - lo)
	}

	type SubArea = { path: string; color: string; opacity: number }
	const subAreas: SubArea[] = []

	const sysTop = entries.map(e => e.systemChars)
	const zero = entries.map(() => 0)
	subAreas.push({ path: roleAreaPath(sysTop, zero), color: '#c084fc', opacity: 0.25 })

	for (let m = 0; m < maxUserMsgs; m++) {
		const bot = entries.map((e, i) => {
			let acc = sysTop[i]
			for (let j = 0; j < m && j < e.userMsgChars.length; j++) acc += e.userMsgChars[j]
			return acc
		})
		const top = entries.map((e, i) => bot[i] + (m < e.userMsgChars.length ? e.userMsgChars[m] : 0))
		const lum = logLum(m, maxUserMsgs, 30, 65)
		subAreas.push({ path: roleAreaPath(top, bot), color: `hsl(217, 91%, ${lum.toFixed(1)}%)`, opacity: 0.35 })
	}

	const usrTop = entries.map(e => e.systemChars + e.userChars)
	for (let m = 0; m < maxAsstMsgs; m++) {
		const bot = entries.map((e, i) => {
			let acc = usrTop[i]
			for (let j = 0; j < m && j < e.assistantMsgChars.length; j++) acc += e.assistantMsgChars[j]
			return acc
		})
		const top = entries.map((e, i) => bot[i] + (m < e.assistantMsgChars.length ? e.assistantMsgChars[m] : 0))
		const lum = logLum(m, maxAsstMsgs, 30, 60)
		subAreas.push({ path: roleAreaPath(top, bot), color: `hsl(43, 96%, ${lum.toFixed(1)}%)`, opacity: 0.35 })
	}

	const outputLine = polyline(entries.map(e => e.outputTokens), yOut)
	const costLine = polyline(entries.map(e => e.cost), yCost)

	const barW = Math.max(4, Math.min(24, plotW / n * 0.6))

	const yTicks = 4
	const charTicks = Array.from({ length: yTicks + 1 }, (_, i) => (maxRoleChars / yTicks) * i)
	const costTicks = Array.from({ length: yTicks + 1 }, (_, i) => (maxCost / yTicks) * i)

	function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
		const svg = svgRef.current
		if (!svg) return
		const rect = svg.getBoundingClientRect()
		const mx = ((e.clientX - rect.left) / rect.width) * chartW
		const closest = entries.reduce((best, _, i) => {
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

	const overheadIcons: Record<string, string> = { memory: '🧠', summarizer: '🗜️' }

	return (
		<div className="border border-(--border) rounded-lg p-5 mb-6">
			<div className="flex items-center justify-between mb-3">
				<h2 className="text-sm font-semibold">All Cycles</h2>
				<div className="flex gap-5 text-xs text-(--text-dim)">
					<span>{cycleBoundaries.length} cycles</span>
					<span>{n} turns</span>
					<span><span className="font-mono text-(--text)">{fmt(totalOut)}</span> out</span>
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
						const e = entries[hover]
						router.push(`/cycle/${e.row.cycleId}?turn=${e.row.turnInCycle}`)
					}
				}}
			>
				{charTicks.map((v, i) => {
					const y = yRole(v)
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

				<line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={PAD_T + LINE_H} stroke="#404040" strokeWidth={1} />
				<line x1={PAD_L} x2={chartW - PAD_R} y1={PAD_T + LINE_H} y2={PAD_T + LINE_H} stroke="#404040" strokeWidth={1} />

				{cycleBoundaries.map((b, i) => (
					<g key={`cb-${i}`}>
						<line x1={x(b.index)} x2={x(b.index)} y1={PAD_T} y2={barTop + BAR_H} stroke="#333" strokeWidth={0.5} strokeDasharray="3 3" />
					</g>
				))}

				{subAreas.map((a, i) => (
					<path key={`area-${i}`} d={a.path} fill={a.color} opacity={a.opacity} />
				))}

				<polyline points={outputLine} fill="none" stroke="#f59e0b" strokeWidth={2} strokeLinejoin="round" />
				<polyline points={costLine} fill="none" stroke="#a855f7" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" />

				{entries.map((e, i) => (
					<g key={`pts-${i}`}>
						<circle cx={x(i)} cy={yOut(e.outputTokens)} r={hover === i ? 4 : 1.5} fill="#f59e0b" />
						<circle cx={x(i)} cy={yCost(e.cost)} r={hover === i ? 3 : 1} fill="#a855f7" />
					</g>
				))}

				{entries.map((e, i) => (
					<circle key={`pd-${i}`} cx={x(i)} cy={PAD_T + LINE_H + 10} r={3} fill={phaseColors[e.row.phase] ?? '#737373'} />
				))}

				{entries.map((e, i) => {
					if (e.overheadBefore.length === 0 || i === 0) return null
					const mx = (x(i - 1) + x(i)) / 2
					return e.overheadBefore.map((oh, j) => (
						<g key={`oh-${i}-${j}`}>
							<line x1={mx + j * 12} x2={mx + j * 12} y1={PAD_T + LINE_H + 16} y2={PAD_T + LINE_H + 24} stroke={phaseColors[oh.phase] ?? '#737373'} strokeWidth={1.5} />
							<text x={mx + j * 12} y={PAD_T + LINE_H + 33} textAnchor="middle" fontSize={6} fill="#737373">{overheadIcons[oh.phase] ?? '⚙️'}</text>
						</g>
					))
				})}

				<line x1={PAD_L} x2={chartW - PAD_R} y1={barMid} y2={barMid} stroke="#404040" strokeWidth={0.5} />
				{charDeltas.map((d, i) => {
					if (i === 0 || d === 0) return null
					const bx = x(i) - barW / 2
					const isNeg = d < 0
					const h = (Math.abs(d) / maxDelta) * (BAR_H / 2)
					const by = isNeg ? barMid : barMid - h
					return (
						<rect key={`bar-${i}`} x={bx} y={by} width={barW} height={h} rx={2}
							fill={isNeg ? '#22c55e' : '#ef4444'} opacity={hover === i ? 1 : 0.7} />
					)
				})}

				<text x={PAD_L - 6} y={barTop + 4} textAnchor="end" fill="#737373" fontSize={8} fontFamily="monospace">+{fmt(maxDelta)}</text>
				<text x={PAD_L - 6} y={barMid + 3} textAnchor="end" fill="#737373" fontSize={8} fontFamily="monospace">0</text>
				<text x={PAD_L - 6} y={barTop + BAR_H + 2} textAnchor="end" fill="#737373" fontSize={8} fontFamily="monospace">−{fmt(maxDelta)}</text>

				{hover !== null && (() => {
					const e = entries[hover]
					const tx = Math.min(x(hover) + 8, chartW - 190)
					const ohLabel = e.overheadBefore.length > 0
						? ` (${e.overheadBefore.map(o => `${o.phase}×${o.count}`).join(', ')} before)`
						: ''
					return (
						<g>
							<line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={barTop + BAR_H} stroke="#555" strokeWidth={0.5} strokeDasharray="2 2" />
							<rect x={tx} y={PAD_T} width={180} height={100} rx={4} fill="#1a1a1a" stroke="#333" strokeWidth={0.5} />
							<text x={tx + 6} y={PAD_T + 14} fill="#e5e5e5" fontSize={10} fontWeight="600">
								{e.batchSize > 1
									? `Batch ×${e.batchSize} · cycle ${cycleForTurn(hover)} · ${e.row.phase}`
									: `Turn ${hover + 1} · cycle ${cycleForTurn(hover)} · ${e.row.phase}`}
							</text>
							{ohLabel && <text x={tx + 6} y={PAD_T + 25} fill="#737373" fontSize={8}>{ohLabel}</text>}
							<text x={tx + 6} y={PAD_T + 38} fill="#fbbf24" fontSize={9} fontFamily="monospace">Asst: {fmt(e.assistantChars)} ch</text>
							<text x={tx + 6} y={PAD_T + 50} fill="#60a5fa" fontSize={9} fontFamily="monospace">User: {fmt(e.userChars)} ch</text>
							<text x={tx + 6} y={PAD_T + 62} fill="#c084fc" fontSize={9} fontFamily="monospace">Sys: {fmt(e.systemChars)} ch</text>
							<text x={tx + 6} y={PAD_T + 74} fill="#f59e0b" fontSize={9} fontFamily="monospace">Out: {fmt(e.outputTokens)} tok</text>
							<text x={tx + 6} y={PAD_T + 86} fill="#a855f7" fontSize={9} fontFamily="monospace">
								Cost: {fmtCost(e.cost)} · Total: {fmtCost(cumCosts[hover])}
							</text>
						</g>
					)
				})()}
			</svg>

			<div className="flex items-center justify-between mt-2">
				<div className="flex gap-4 text-[10px] text-(--text-dim) flex-wrap">
					<span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#fbbf24', opacity: 0.45 }} /> Assistant</span>
					<span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#60a5fa', opacity: 0.45 }} /> User</span>
					<span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#c084fc', opacity: 0.45 }} /> System</span>
					<span className="flex items-center gap-1"><span className="inline-block w-5 h-0.5" style={{ backgroundColor: '#f59e0b' }} /> Output tokens</span>
					<span className="flex items-center gap-1"><span className="inline-block w-5 h-0.5 border-t border-dashed" style={{ borderColor: '#a855f7' }} /> Cost</span>
					<span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#ef4444' }} /> Chars grew</span>
					<span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#22c55e' }} /> Chars reduced</span>
				</div>
				<div className="flex gap-3 text-[10px] text-(--text-dim)">
					{Object.entries(phaseColors).filter(([p]) => !OVERHEAD_PHASES.has(p)).map(([p, c]) => (
						<span key={p} className="flex items-center gap-1">
							<span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: c }} />
							{p}
						</span>
					))}
					{['memory', 'summarizer'].map(p => (
						<span key={p} className="flex items-center gap-1">
							<span className="inline-block w-3 h-0.5" style={{ backgroundColor: phaseColors[p] }} />
							{p}
						</span>
					))}
				</div>
			</div>
		</div>
	)
}
