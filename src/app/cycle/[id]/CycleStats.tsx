'use client'

import { useMemo, useState, useRef, useEffect } from 'react'
import type { GeneratedTurn as Turn } from '@/lib/data'
import { OVERHEAD_PHASES, phaseColors } from '@/lib/phases'
import { useCurrency } from '@/lib/CurrencyProvider'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = Record<string, any>

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

interface CoreEntry {
	turn: Turn
	originalIndex: number
	batchSize: number
	outputTokens: number
	cost: number
	userChars: number
	assistantChars: number
	systemChars: number
	totalChars: number
	charDelta: number
	userMsgs: number[]
	assistantMsgs: number[]
	phaseTurn: number
	phaseTotal: number
	overheadBefore: { phase: string; count: number; cost: number }[]
	thinkingChars: number
	textChars: number
}

function computeTurnChars(t: Turn) {
	const msgs = t.messages as Msg[]
	let userChars = 0, assistantChars = 0
	const userMsgs: number[] = []
	const assistantMsgs: number[] = []
	for (const m of msgs) {
		const len = charLen(m)
		if (m.role === 'user') { userChars += len; userMsgs.push(len) }
		else if (m.role === 'assistant') { assistantChars += len; assistantMsgs.push(len) }
	}
	const sysChars = systemLen(t.system)
	return { userChars, assistantChars, systemChars: sysChars, userMsgs, assistantMsgs, totalChars: userChars + assistantChars + sysChars }
}

function computeResponseChars(t: Turn) {
	const response = t.response as Msg[]
	let thinkingChars = 0, textChars = 0
	for (const b of response) {
		if (b.type === 'thinking') {
			thinkingChars += (b.thinking?.length ?? b.text?.length ?? 0)
		} else if (b.type === 'text') {
			textChars += (b.text?.length ?? 0)
		} else if (b.type === 'tool_use') {
			textChars += JSON.stringify(b.input ?? '').length
		}
	}
	return { thinkingChars, textChars }
}

function buildCoreEntries(turns: Turn[]): CoreEntry[] {
	const entries: CoreEntry[] = []
	const pendingOverhead: { phase: string; count: number; cost: number }[] = []

	let i = 0
	while (i < turns.length) {
		const t = turns[i]

		if (OVERHEAD_PHASES.has(t.phase)) {
			const last = pendingOverhead[pendingOverhead.length - 1]
			if (last && last.phase === t.phase) { last.count++; last.cost += t.cost }
			else pendingOverhead.push({ phase: t.phase, count: 1, cost: t.cost })
			i++
			continue
		}

		{
			const chars = computeTurnChars(t)
			const respChars = computeResponseChars(t)
			const overhead = pendingOverhead.splice(0)
			entries.push({
				turn: t,
				originalIndex: i,
				batchSize: 1,
				outputTokens: t.outputTokens,
				cost: t.cost,
				...chars,
				...respChars,
				charDelta: 0,
				phaseTurn: 0,
				phaseTotal: 0,
				overheadBefore: overhead,
			})
			i++
		}
	}

	let runStart = 0
	for (let k = 0; k <= entries.length; k++) {
		if (k === entries.length || (k > 0 && entries[k].turn.phase !== entries[k - 1].turn.phase)) {
			const len = k - runStart
			for (let j = runStart; j < k; j++) {
				entries[j].phaseTurn = j - runStart + 1
				entries[j].phaseTotal = len
			}
			runStart = k
		}
	}

	for (let k = 1; k < entries.length; k++) {
		if (entries[k].turn.phase === entries[k - 1].turn.phase) {
			entries[k].charDelta = entries[k].totalChars - entries[k - 1].totalChars
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

function fmt(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
	return String(n)
}

const TOOL_COLORS = ['#f59e0b', '#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16']
const MIN_PX_PER_TURN = 8
const FIT_WIDTH = 700

export function CycleStats({ turns, onTurnClick }: { turns: Turn[]; onTurnClick?: (overallIndex: number) => void }) {
	const entries = useMemo(() => buildCoreEntries(turns), [turns])
	const { formatCost: fmtCost } = useCurrency()
	const [hover, setHover] = useState<number | null>(null)
	const [zoomedOut, setZoomedOut] = useState(false)
	const svgRef = useRef<SVGSVGElement>(null)
	const scrollRef = useRef<HTMLDivElement>(null)
	const didAutoScroll = useRef(false)

	const toolIndex = useMemo(() => {
		const counts = new Map<string, number>()
		for (const e of entries) {
			for (const block of e.turn.response as Msg[]) {
				if (block.type === 'tool_use' && block.name) counts.set(block.name, (counts.get(block.name) ?? 0) + 1)
			}
		}
		return [...counts.entries()].sort((a, b) => b[1] - a[1])
	}, [entries])

	const entryTools = useMemo(() =>
		entries.map(e => {
			const names: string[] = []
			for (const block of e.turn.response as Msg[]) {
				if (block.type === 'tool_use' && block.name && !names.includes(block.name)) names.push(block.name)
			}
			return names
		}),
		[entries]
	)

	const toolColorMap = useMemo(() => {
		const map = new Map<string, string>()
		toolIndex.forEach(([name], i) => map.set(name, TOOL_COLORS[i % TOOL_COLORS.length]))
		return map
	}, [toolIndex])

	const n = entries.length
	const needsScroll = n > 100 && !zoomedOut

	useEffect(() => {
		if (needsScroll && scrollRef.current && !didAutoScroll.current) {
			scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
			didAutoScroll.current = true
		}
	}, [needsScroll])

	if (n < 2) return null

	const totalOut = entries.reduce((s, e) => s + e.outputTokens, 0)
	const totalCost = entries.reduce((s, e) => s + e.cost + e.overheadBefore.reduce((a, o) => a + o.cost, 0), 0)

	const maxRoleChars = Math.max(...entries.map(e => e.systemChars + e.userChars + e.assistantChars), 1)
	const maxResponseChars = Math.max(...entries.map(e => e.thinkingChars + e.textChars), 1)
	const maxCost = Math.max(...entries.map(e => e.cost), 0.0001)
	const maxDelta = Math.max(...entries.map(e => Math.abs(e.charDelta)), 1)

	const chartW = needsScroll ? PAD_L + PAD_R + n * MIN_PX_PER_TURN : FIT_WIDTH
	const compact = zoomedOut && n > 100
	const lineH = compact ? 100 : LINE_H
	const barH = compact ? 50 : BAR_H
	const gap = compact ? 20 : GAP
	const toolH = compact ? 0 : 70
	const totalH = lineH + gap + barH + toolH + PAD_T + PAD_B
	const plotW = chartW - PAD_L - PAD_R

	function x(i: number) { return PAD_L + (i / (n - 1)) * plotW }
	function yRole(v: number) { return PAD_T + lineH - (v / maxRoleChars) * lineH }
	function yCost(v: number) { return PAD_T + lineH - (v / maxCost) * lineH }
	function yResp(v: number) { return PAD_T + lineH - (v / maxResponseChars) * lineH }

	const barTop = PAD_T + lineH + gap
	const barMid = barTop + barH / 2
	const toolTop = barTop + barH + 6

	function polyline(vals: number[], yFn: (v: number) => number): string {
		return vals.map((v, i) => `${x(i).toFixed(1)},${yFn(v).toFixed(1)}`).join(' ')
	}

	function roleAreaPath(topVals: number[], botVals: number[]): string {
		const pts: string[] = []
		for (let i = 0; i < n; i++) pts.push(`${x(i).toFixed(1)},${yRole(topVals[i]).toFixed(1)}`)
		for (let i = n - 1; i >= 0; i--) pts.push(`${x(i).toFixed(1)},${yRole(botVals[i]).toFixed(1)}`)
		return `M${pts.join('L')}Z`
	}

	const maxUserMsgs = Math.max(...entries.map(e => e.userMsgs.length), 1)
	const maxAsstMsgs = Math.max(...entries.map(e => e.assistantMsgs.length), 1)

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
			for (let j = 0; j < m && j < e.userMsgs.length; j++) acc += e.userMsgs[j]
			return acc
		})
		const top = entries.map((e, i) => bot[i] + (m < e.userMsgs.length ? e.userMsgs[m] : 0))
		const lum = logLum(m, maxUserMsgs, 30, 65)
		subAreas.push({ path: roleAreaPath(top, bot), color: `hsl(217, 91%, ${lum.toFixed(1)}%)`, opacity: 0.35 })
	}

	const usrTop = entries.map(e => e.systemChars + e.userChars)
	for (let m = 0; m < maxAsstMsgs; m++) {
		const bot = entries.map((e, i) => {
			let acc = usrTop[i]
			for (let j = 0; j < m && j < e.assistantMsgs.length; j++) acc += e.assistantMsgs[j]
			return acc
		})
		const top = entries.map((e, i) => bot[i] + (m < e.assistantMsgs.length ? e.assistantMsgs[m] : 0))
		const lum = logLum(m, maxAsstMsgs, 30, 60)
		subAreas.push({ path: roleAreaPath(top, bot), color: `hsl(43, 96%, ${lum.toFixed(1)}%)`, opacity: 0.35 })
	}

	const textLine = polyline(entries.map(e => e.textChars), yResp)
	const totalRespLine = polyline(entries.map(e => e.thinkingChars + e.textChars), yResp)
	const costLine = polyline(entries.map(e => e.cost), yCost)

	const barW = Math.max(4, Math.min(24, plotW / n * 0.6))

	const yTicks = 4
	const charTicks = Array.from({ length: yTicks + 1 }, (_, i) => (maxRoleChars / yTicks) * i)
	const costTicks = Array.from({ length: yTicks + 1 }, (_, i) => (maxCost / yTicks) * i)

	function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
		const svg = svgRef.current
		if (!svg) return
		const rect = svg.getBoundingClientRect()
		const svgDisplayW = rect.width
		const scaleX = chartW / svgDisplayW
		const mx = (e.clientX - rect.left) * scaleX
		const closest = entries.reduce((best, _, i) => {
			const dist = Math.abs(x(i) - mx)
			return dist < best.dist ? { dist, i } : best
		}, { dist: Infinity, i: -1 })
		setHover(closest.i >= 0 ? closest.i : null)
	}

	const overheadIcons: Record<string, string> = { memory: '🧠' }

	return (
		<div className="border border-(--border) rounded-lg p-5 mb-6">
			<div className="flex items-center justify-between mb-3">
				<h2 className="text-sm font-semibold">Statistics</h2>
				<div className="flex gap-5 text-xs text-(--text-dim) items-center">
					{n > 100 && (
						<button
							onClick={() => { setZoomedOut(z => !z); didAutoScroll.current = false }}
							className="px-2 py-0.5 rounded border border-(--border) hover:bg-(--bg-hover) transition-colors text-[10px]"
						>
							{zoomedOut ? '🔍 Scroll view' : '🔭 Zoom out'}
						</button>
					)}
					<span>{n} calls</span>
					<span><span className="font-mono text-(--text)">{fmt(totalOut)}</span> out tokens</span>
					<span><span className="font-mono text-(--text)">${totalCost.toFixed(4)}</span></span>
				</div>
			</div>

			<div
				ref={scrollRef}
				className={needsScroll ? 'overflow-x-auto seedwatch-scrollbar' : ''}
			>
			<svg
				ref={svgRef}
				viewBox={`0 0 ${chartW} ${totalH}`}
				className="cursor-pointer"
				style={needsScroll ? { width: chartW, minWidth: chartW } : { width: '100%' }}
				onMouseMove={onMouseMove}
				onMouseLeave={() => setHover(null)}
				onClick={() => { if (hover !== null && onTurnClick) onTurnClick(entries[hover].originalIndex) }}
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

				<line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={PAD_T + lineH} stroke="#404040" strokeWidth={1} />
				<line x1={PAD_L} x2={chartW - PAD_R} y1={PAD_T + lineH} y2={PAD_T + lineH} stroke="#404040" strokeWidth={1} />

				{subAreas.map((a, i) => (
					<path key={`area-${i}`} d={a.path} fill={a.color} opacity={a.opacity} />
				))}

				<polyline points={totalRespLine} fill="none" stroke="#f59e0b" strokeWidth={compact ? 1.2 : 2} strokeLinejoin="round" />
				<polyline points={textLine} fill="none" stroke="#22c55e" strokeWidth={compact ? 1 : 1.5} strokeLinejoin="round" />
				<polyline points={costLine} fill="none" stroke="#a855f7" strokeWidth={compact ? 1 : 1.5} strokeDasharray="4 3" strokeLinejoin="round" />

				{entries.map((e, i) => (
					<g key={`pts-${i}`}>
						<circle cx={x(i)} cy={yResp(e.thinkingChars + e.textChars)} r={hover === i ? (compact ? 3 : 4) : (compact ? 1.5 : 2.5)} fill="#f59e0b" />
						<circle cx={x(i)} cy={yResp(e.textChars)} r={hover === i ? (compact ? 2.5 : 3.5) : (compact ? 1 : 1.5)} fill="#22c55e" />
						<circle cx={x(i)} cy={yCost(e.cost)} r={hover === i ? (compact ? 2.5 : 3.5) : (compact ? 1 : 2)} fill="#a855f7" />
					</g>
				))}

				{entries.map((e, i) => (
					<g key={`xl-${i}`}>
						<circle cx={x(i)} cy={PAD_T + lineH + 10} r={compact ? 2 : 3} fill={phaseColors[e.turn.phase] ?? '#737373'} />
						{!compact && (n <= 20 || i % Math.ceil(n / 20) === 0) && (
							<text x={x(i)} y={PAD_T + lineH + 20} textAnchor="middle" fill="#737373" fontSize={8} fontFamily="monospace">
								{i + 1}
							</text>
						)}
					</g>
				))}

				{!compact && entries.map((e, i) => {
					if (e.overheadBefore.length === 0 || i === 0) return null
					const mx = (x(i - 1) + x(i)) / 2
					return e.overheadBefore.map((oh, j) => (
						<g key={`oh-${i}-${j}`}>
							<line x1={mx + j * 12} x2={mx + j * 12} y1={PAD_T + lineH + 16} y2={PAD_T + lineH + 24} stroke={phaseColors[oh.phase] ?? '#737373'} strokeWidth={1.5} />
							<text x={mx + j * 12} y={PAD_T + lineH + 33} textAnchor="middle" fontSize={6} fill="#737373">{overheadIcons[oh.phase] ?? '⚙️'}</text>
						</g>
					))
				})}

				<line x1={PAD_L} x2={chartW - PAD_R} y1={barMid} y2={barMid} stroke="#404040" strokeWidth={0.5} />
				{entries.map((e, i) => {
					if (i === 0 || e.charDelta === 0) return null
					const bx = x(i) - barW / 2
					const isNeg = e.charDelta < 0
					const h = (Math.abs(e.charDelta) / maxDelta) * (barH / 2)
					const by = isNeg ? barMid : barMid - h
					return (
						<rect key={`bar-${i}`} x={bx} y={by} width={barW} height={h} rx={compact ? 1 : 2}
							fill={isNeg ? '#22c55e' : '#ef4444'} opacity={hover === i ? 1 : 0.7} />
					)
				})}

				<text x={PAD_L - 6} y={barTop + 4} textAnchor="end" fill="#737373" fontSize={8} fontFamily="monospace">+{fmt(maxDelta)}</text>
				<text x={PAD_L - 6} y={barMid + 3} textAnchor="end" fill="#737373" fontSize={8} fontFamily="monospace">0</text>
				<text x={PAD_L - 6} y={barTop + barH + 2} textAnchor="end" fill="#737373" fontSize={8} fontFamily="monospace">−{fmt(maxDelta)}</text>

				{/* Tool labels per turn */}
				{!compact && entries.map((_, i) => {
					const tools = entryTools[i]
					if (tools.length === 0) return null
					return tools.map((name, j) => {
						const color = toolColorMap.get(name) ?? '#737373'
						const tx = x(i) + (j - (tools.length - 1) / 2) * 5
						return (
							<text key={`tool-${i}-${j}`} x={0} y={0} fontSize={6} fill={color} fontFamily="monospace"
								transform={`translate(${tx.toFixed(1)}, ${toolTop}) rotate(90)`}
								dominantBaseline="central"
							>
								{name}
							</text>
						)
					})
				})}

				{hover !== null && (() => {
					const e = entries[hover]
					const tools = entryTools[hover]
					const hasDelta = hover > 0 && e.charDelta !== 0
					const hasOh = e.overheadBefore.length > 0
					const hasCache = e.turn.cacheReadTokens > 0 || e.turn.cacheWrite5mTokens > 0 || e.turn.cacheWrite1hTokens > 0

					const rows: { label: string; value: string; color: string; x2?: { value: string; color: string } }[] = []

					rows.push({ label: 'In', value: `${fmt(e.turn.inputTokens)} tok`, color: '#e5e5e5' })
					if (hasCache) {
						if (e.turn.cacheReadTokens > 0) rows.push({ label: '  cached', value: fmt(e.turn.cacheReadTokens), color: '#c084fc' })
						if (e.turn.cacheWrite5mTokens > 0) rows.push({ label: '  write-5m', value: fmt(e.turn.cacheWrite5mTokens), color: '#c084fc' })
						if (e.turn.cacheWrite1hTokens > 0) rows.push({ label: '  write-1h', value: fmt(e.turn.cacheWrite1hTokens), color: '#c084fc' })
					}
					rows.push({ label: 'Out', value: `${fmt(e.outputTokens)} tok`, color: '#e5e5e5' })
					rows.push({ label: '  text', value: `${fmt(e.textChars)} ch`, color: '#22c55e' })
					if (e.thinkingChars > 0) {
						rows.push({ label: '  thinking', value: `${fmt(e.thinkingChars)} ch`, color: '#f59e0b' })
					}

					rows.push({ label: '', value: '', color: 'transparent' })

					rows.push({ label: 'Asst', value: `${fmt(e.assistantChars)} ch`, color: '#fbbf24' })
					rows.push({ label: 'User', value: `${fmt(e.userChars)} ch`, color: '#60a5fa' })
					rows.push({ label: 'Sys', value: `${fmt(e.systemChars)} ch`, color: '#c084fc' })

					rows.push({ label: '', value: '', color: 'transparent' })

					rows.push({ label: 'Cost', value: fmtCost(e.cost), color: '#a855f7' })
					if (hasDelta) {
						rows.push({
							label: 'Δ ctx',
							value: `${e.charDelta > 0 ? '+' : ''}${fmt(e.charDelta)}`,
							color: e.charDelta < 0 ? '#22c55e' : '#ef4444',
						})
					}

					const tooltipW = 200
					const lineSpacing = 12
					const headerH = hasOh ? 32 : 18
					const toolH = tools.length > 0 ? 14 : 0
					const tooltipH = headerH + rows.length * lineSpacing + toolH + 8
					const tx = Math.min(x(hover) + 8, chartW - tooltipW - 4)

					return (
						<g>
							<line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={barTop + barH} stroke="#555" strokeWidth={0.5} strokeDasharray="2 2" />
							<rect x={tx} y={PAD_T} width={tooltipW} height={tooltipH} rx={4} fill="#1a1a1a" stroke="#333" strokeWidth={0.5} />
							<text x={tx + 6} y={PAD_T + 13} fill="#e5e5e5" fontSize={10} fontWeight="600">
								{e.batchSize > 1
									? `Batch ×${e.batchSize} · ${e.turn.phase}`
									: `Turn ${hover + 1} · ${e.turn.phase} ${e.phaseTurn}/${e.phaseTotal}`}
							</text>
							{hasOh && (
								<text x={tx + 6} y={PAD_T + 25} fill="#737373" fontSize={8}>
									{e.overheadBefore.map(o => `${o.phase}×${o.count}`).join(', ')} before
								</text>
							)}

							{rows.map((r, ri) => (
								<g key={`tr-${ri}`}>
									{r.label && (
										<>
											<text x={tx + 6} y={PAD_T + headerH + ri * lineSpacing} fill="#737373" fontSize={8} fontFamily="monospace">{r.label}</text>
											<text x={tx + 58} y={PAD_T + headerH + ri * lineSpacing} fill={r.color} fontSize={9} fontFamily="monospace">{r.value}</text>
										</>
									)}
									{r.x2 && (
										<text x={tx + 120} y={PAD_T + headerH + ri * lineSpacing} fill={r.x2.color} fontSize={8} fontFamily="monospace">{r.x2.value}</text>
									)}
								</g>
							))}

							{tools.length > 0 && (
								<text x={tx + 6} y={PAD_T + headerH + rows.length * lineSpacing + 4} fontSize={7} fontFamily="monospace">
									{tools.map((t, ti) => (
										<tspan key={ti} fill={toolColorMap.get(t) ?? '#737373'}>
											{ti > 0 ? ' · ' : ''}{t}
										</tspan>
									))}
								</text>
							)}
						</g>
					)
				})()}
			</svg>
			</div>

			<div className="flex items-center justify-between mt-2">
				<div className="flex gap-4 text-[10px] text-(--text-dim) flex-wrap">
					<span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#fbbf24', opacity: 0.45 }} /> Assistant</span>
					<span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#60a5fa', opacity: 0.45 }} /> User</span>
					<span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#c084fc', opacity: 0.45 }} /> System</span>
					<span className="flex items-center gap-1"><span className="inline-block w-5 h-0.5" style={{ backgroundColor: '#f59e0b' }} /> Total output</span>
					<span className="flex items-center gap-1"><span className="inline-block w-5 h-0.5" style={{ backgroundColor: '#22c55e' }} /> Text output</span>
					<span className="flex items-center gap-1"><span className="inline-block w-5 h-0.5 border-t border-dashed" style={{ borderColor: '#a855f7' }} /> Cost</span>
					<span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#ef4444' }} /> Chars grew</span>
					<span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#22c55e', opacity: 0.5 }} /> Chars reduced</span>
				</div>
				<div className="flex gap-3 text-[10px] text-(--text-dim)">
					{Object.entries(phaseColors).filter(([p]) => !OVERHEAD_PHASES.has(p)).map(([p, c]) => (
						<span key={p} className="flex items-center gap-1">
							<span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: c }} />
							{p}
						</span>
					))}
					<span className="flex items-center gap-1">
						<span className="inline-block w-3 h-0.5" style={{ backgroundColor: phaseColors.memory }} />
						memory
					</span>
				</div>
			</div>

			{toolIndex.length > 0 && (
				<div className="mt-1 flex items-center gap-2 flex-wrap">
					<span className="text-[10px] text-(--text-dim) font-semibold mr-1">Tools</span>
					{toolIndex.map(([name, count]) => (
						<span key={name} className="flex items-center gap-1 text-[9px] font-mono text-(--text-dim)">
							<span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: toolColorMap.get(name) }} />
							{name} <span className="opacity-50">×{count}</span>
						</span>
					))}
				</div>
			)}
		</div>
	)
}
