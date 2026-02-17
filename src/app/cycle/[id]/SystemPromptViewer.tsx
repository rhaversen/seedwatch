'use client'

import { useState, useRef, useCallback, useEffect, Fragment } from 'react'
import type { GeneratedTurn as Turn } from '@/lib/data'
import { OVERHEAD_PHASES, phaseColors, phaseIcons } from '@/lib/phases'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Block = Record<string, any>

function blockToString(blocks: Block[]): string {
	return blocks.map(b => (typeof b === 'string' ? b : b.text ?? JSON.stringify(b, null, 2))).join('\n')
}

interface PromptSnapshot {
	turnIndex: number
	phase: string
	text: string
	chars: number
	delta: number
	changed: boolean
	phaseStart: boolean
}

function buildSnapshots(turns: Turn[]): PromptSnapshot[] {
	const snapshots: PromptSnapshot[] = []
	let prevText = ''
	let prevPhase = ''
	for (let i = 0; i < turns.length; i++) {
		if (OVERHEAD_PHASES.has(turns[i].phase)) continue
		const text = blockToString(turns[i].system as Block[])
		const phase = turns[i].phase
		const phaseStart = phase !== prevPhase
		const changed = text !== prevText && !phaseStart && snapshots.length > 0
		snapshots.push({
			turnIndex: i,
			phase,
			text,
			chars: text.length,
			delta: phaseStart ? 0 : text.length - prevText.length,
			changed,
			phaseStart: phaseStart && snapshots.length > 0,
		})
		prevText = text
		prevPhase = phase
	}
	return snapshots
}

type DiffRow =
	| { type: 'same'; left: string; right: string }
	| { type: 'changed'; left: string; right: string }
	| { type: 'removed'; left: string }
	| { type: 'added'; right: string }
	| { type: 'collapse'; count: number }

function computeDiffRows(prev: string[], curr: string[]): DiffRow[] {
	const MAX = 800
	const pClamped = prev.length > MAX ? prev.slice(0, MAX) : prev
	const cClamped = curr.length > MAX ? curr.slice(0, MAX) : curr
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
		if (sameRun.length <= 6) {
			display.push(...sameRun)
		} else {
			display.push(sameRun[0], sameRun[1], sameRun[2])
			display.push({ type: 'collapse', count: sameRun.length - 6 })
			display.push(sameRun[sameRun.length - 3], sameRun[sameRun.length - 2], sameRun[sameRun.length - 1])
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

function RawView({ text }: { text: string }) {
	const [showAll, setShowAll] = useState(false)
	const LIMIT = 8000
	const truncated = !showAll && text.length > LIMIT

	return (
		<div className="relative">
			<pre className="text-xs text-(--text-dim) whitespace-pre-wrap wrap-break-word font-mono max-h-[32rem] overflow-y-auto">
				{truncated ? text.slice(0, LIMIT) : text}
			</pre>
			{truncated && (
				<div className="sticky bottom-0 bg-gradient-to-t from-(--bg-card) to-transparent pt-6 pb-1 text-center">
					<button
						onClick={() => setShowAll(true)}
						className="text-xs text-(--accent) hover:underline"
					>
						Show remaining {(text.length - LIMIT).toLocaleString()} chars
					</button>
				</div>
			)}
		</div>
	)
}

function fmt(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
	return String(n)
}

export function SystemPromptViewer({ turns }: { turns: Turn[] }) {
	const [current, setCurrent] = useState(0)
	const [mode, setMode] = useState<'diff' | 'raw'>('diff')
	const containerRef = useRef<HTMLDivElement>(null)
	const scrollAccum = useRef(0)
	const lastTrigger = useRef(0)
	const consecutive = useRef(0)

	const snapshots = buildSnapshots(turns)
	const changedIndices = snapshots.reduce<number[]>((a, s, i) => { if (s.changed) a.push(i); return a }, [])

	const navigate = useCallback((dir: 'forward' | 'backward') => {
		setCurrent(prev => {
			return dir === 'forward'
				? Math.min(prev + 1, snapshots.length - 1)
				: Math.max(prev - 1, 0)
		})
	}, [snapshots.length])

	const jumpToChange = useCallback((dir: 'next' | 'prev') => {
		setCurrent(prev => {
			if (dir === 'next') {
				const next = changedIndices.find(i => i > prev)
				return next ?? prev
			}
			const prevIdx = [...changedIndices].reverse().find(i => i < prev)
			return prevIdx ?? prev
		})
	}, [changedIndices])

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
			if (elapsed < debounce) { scrollAccum.current = 0; return }

			const d: 'forward' | 'backward' = scrollAccum.current > 0 ? 'forward' : 'backward'
			scrollAccum.current = 0
			lastTrigger.current = now
			navigate(d)
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

	if (snapshots.length === 0) return null

	const snap = snapshots[current]
	const prevSnap = current > 0 ? snapshots[current - 1] : null
	const totalChanges = changedIndices.length

	return (
		<div ref={containerRef} className="border border-(--border) rounded-lg overflow-hidden" tabIndex={0}>
			<div className="p-3 bg-(--bg-card) border-b border-(--border)">
				<div className="flex items-center justify-between mb-2">
					<div className="flex items-center gap-2 text-xs">
						<span className="text-purple-400 font-semibold">System Prompt</span>
						<span className="text-(--text-dim)">·</span>
						<span style={{ color: phaseColors[snap.phase] }}>
							{phaseIcons[snap.phase] ?? '⚙️'} {snap.phase}
						</span>
						<span className="font-mono text-(--text)">#{snap.turnIndex + 1}</span>
						<span className="text-(--text-dim)">({current + 1}/{snapshots.length})</span>
					</div>
					<div className="flex items-center gap-3 text-xs text-(--text-dim)">
						<span className="font-mono">{fmt(snap.chars)} chars</span>
						{snap.phaseStart && (
							<span className="px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300">
								phase start
							</span>
						)}
						{snap.changed && (
							<span className={`px-2 py-0.5 rounded-full ${snap.delta < 0 ? 'bg-green-900/40 text-green-300' : snap.delta > 0 ? 'bg-red-900/30 text-red-300' : 'bg-purple-900/40 text-purple-300'}`}>
								{snap.delta > 0 ? '+' : ''}{fmt(snap.delta)}
							</span>
						)}
						{!snap.changed && !snap.phaseStart && current > 0 && (
							<span className="text-(--text-dim)">unchanged</span>
						)}
					</div>
				</div>

				<div className="flex items-center gap-2">
					<button onClick={() => navigate('backward')} disabled={current === 0}
						className="px-2 py-0.5 text-xs rounded border border-(--border) hover:bg-(--bg-hover) disabled:opacity-30 transition-colors">
						←
					</button>

					<div className="flex-1 h-2 bg-(--bg-hover) rounded-full overflow-hidden relative">
						{snapshots.map((s, i) => {
							const left = (i / snapshots.length) * 100
							const w = Math.max(0.5, 100 / snapshots.length)
							const color = s.phaseStart ? '#60a5fa' : s.changed ? '#c084fc' : i === current ? '#e5e5e5' : 'transparent'
							return (
								<div
									key={i}
									className="absolute top-0 bottom-0 cursor-pointer hover:opacity-100 transition-opacity"
									style={{
										left: `${left}%`,
										width: `${w}%`,
										backgroundColor: color,
										opacity: i === current ? 1 : (s.changed || s.phaseStart) ? 0.5 : 0.15,
									}}
									onClick={() => setCurrent(i)}
									title={`Turn ${s.turnIndex + 1} · ${s.phase}${s.phaseStart ? ' (phase start)' : s.changed ? ' (changed)' : ''}`}
								/>
							)
						})}
						<div
							className="absolute top-0 bottom-0 w-0.5 bg-white rounded-full shadow-[0_0_4px_rgba(255,255,255,0.6)]"
							style={{ left: `${(current / snapshots.length) * 100}%` }}
						/>
					</div>

					<button onClick={() => navigate('forward')} disabled={current === snapshots.length - 1}
						className="px-2 py-0.5 text-xs rounded border border-(--border) hover:bg-(--bg-hover) disabled:opacity-30 transition-colors">
						→
					</button>

					<div className="flex items-center border border-(--border) rounded overflow-hidden text-[10px]">
						<button onClick={() => jumpToChange('prev')} disabled={!changedIndices.some(i => i < current)}
							className="px-1.5 py-0.5 hover:bg-(--bg-hover) disabled:opacity-30 text-purple-400"
							title="Previous change">
							◀
						</button>
						<span className="px-1.5 py-0.5 text-(--text-dim) border-l border-r border-(--border)">
							{totalChanges} Δ
						</span>
						<button onClick={() => jumpToChange('next')} disabled={!changedIndices.some(i => i > current)}
							className="px-1.5 py-0.5 hover:bg-(--bg-hover) disabled:opacity-30 text-purple-400"
							title="Next change">
							▶
						</button>
					</div>

					<div className="flex items-center border border-(--border) rounded overflow-hidden text-[10px]">
						<button onClick={() => setMode('diff')}
							className={`px-2 py-0.5 ${mode === 'diff' ? 'bg-(--accent-dim) text-(--accent)' : 'text-(--text-dim) hover:bg-(--bg-hover)'}`}>
							Diff
						</button>
						<button onClick={() => setMode('raw')}
							className={`px-2 py-0.5 border-l border-(--border) ${mode === 'raw' ? 'bg-(--accent-dim) text-(--accent)' : 'text-(--text-dim) hover:bg-(--bg-hover)'}`}>
							Raw
						</button>
					</div>
				</div>

				<div className="text-[10px] text-(--text-dim) mt-1 text-center">
					scroll ← → or arrow keys · click purple marks to jump to changes
				</div>
			</div>

			<div className="p-3">
				{mode === 'diff' && snap.changed && prevSnap && !snap.phaseStart ? (
					<DiffView prev={prevSnap.text} curr={snap.text} />
				) : (
					<RawView text={snap.text} />
				)}
			</div>
		</div>
	)
}
