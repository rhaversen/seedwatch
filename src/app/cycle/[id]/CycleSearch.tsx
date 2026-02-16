'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { GeneratedTurn as Turn } from '@/lib/data'
import { OVERHEAD_PHASES } from '@/lib/phases'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = Record<string, any>

interface SearchMatch {
	turnIndex: number
	phase: string
	context: string
	offset: number
}

function extractTurnText(turn: Turn): string {
	const parts: string[] = []

	for (const msg of turn.messages as AnyBlock[]) {
		if (typeof msg.content === 'string') {
			parts.push(msg.content)
		} else if (Array.isArray(msg.content)) {
			for (const b of msg.content as AnyBlock[]) {
				if (b.type === 'text' && b.text) parts.push(b.text)
				else if (b.type === 'tool_result' && typeof b.content === 'string') parts.push(b.content)
				else if (b.type === 'tool_use' && b.input) parts.push(JSON.stringify(b.input))
			}
		}
	}

	for (const block of turn.response as AnyBlock[]) {
		if (block.type === 'text' && block.text) parts.push(block.text)
		else if (block.type === 'tool_use' && block.input) parts.push(JSON.stringify(block.input))
	}

	return parts.join('\n')
}

function getContext(text: string, idx: number, query: string, radius = 40): string {
	const start = Math.max(0, idx - radius)
	const end = Math.min(text.length, idx + query.length + radius)
	const before = (start > 0 ? '…' : '') + text.slice(start, idx)
	const match = text.slice(idx, idx + query.length)
	const after = text.slice(idx + query.length, end) + (end < text.length ? '…' : '')
	return `${before}<<${match}>>${after}`
}

function highlightInPage(query: string) {
	clearDomHighlights()

	if (typeof CSS !== 'undefined' && 'highlights' in CSS) {
		const css = CSS as typeof CSS & { highlights: Map<string, Highlight> }
		css.highlights.delete('cycle-search')
	}

	if (!query || query.length < 2) return

	const q = query.toLowerCase()

	if (typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined') {
		const css = CSS as typeof CSS & { highlights: Map<string, Highlight> }
		const ranges: Range[] = []
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
		let node: Text | null
		while ((node = walker.nextNode() as Text | null)) {
			const text = node.textContent?.toLowerCase()
			if (!text) continue
			let pos = 0
			while ((pos = text.indexOf(q, pos)) !== -1) {
				const range = new Range()
				range.setStart(node, pos)
				range.setEnd(node, pos + query.length)
				ranges.push(range)
				pos += 1
			}
		}
		if (ranges.length > 0) {
			const hl = new Highlight(...ranges)
			css.highlights.set('cycle-search', hl)
		}
	} else {
		applyDomHighlights(q)
	}
}

function applyDomHighlights(query: string) {
	const container = document.querySelector('[data-cycle-content]')
	if (!container) return
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
	const matches: { node: Text; start: number; len: number }[] = []
	let node: Text | null
	while ((node = walker.nextNode() as Text | null)) {
		const text = node.textContent?.toLowerCase()
		if (!text) continue
		let pos = 0
		while ((pos = text.indexOf(query, pos)) !== -1) {
			matches.push({ node, start: pos, len: query.length })
			pos += 1
		}
	}
	for (let i = matches.length - 1; i >= 0; i--) {
		const { node: textNode, start, len } = matches[i]
		const range = document.createRange()
		range.setStart(textNode, start)
		range.setEnd(textNode, start + len)
		const mark = document.createElement('mark')
		mark.className = 'cycle-search-mark'
		mark.style.backgroundColor = 'rgba(250, 204, 21, 0.35)'
		mark.style.color = 'inherit'
		mark.dataset.cycleSearchMark = '1'
		range.surroundContents(mark)
	}
}

function clearDomHighlights() {
	document.querySelectorAll('[data-cycle-search-mark]').forEach(mark => {
		const parent = mark.parentNode
		if (!parent) return
		const text = document.createTextNode(mark.textContent ?? '')
		parent.replaceChild(text, mark)
		parent.normalize()
	})
}

function ensureHighlightStyle() {
	if (document.getElementById('cycle-search-highlight-style')) return
	const style = document.createElement('style')
	style.id = 'cycle-search-highlight-style'
	style.textContent = '::highlight(cycle-search) { background-color: rgba(250, 204, 21, 0.35); color: inherit; }'
	document.head.appendChild(style)
}

export function CycleSearch({ turns, onNavigate }: { turns: Turn[]; onNavigate: (overallIndex: number) => void }) {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)
	const [activeIdx, setActiveIdx] = useState(0)

	const searchableTurns = useMemo(() =>
		turns.map((t, i) => ({ turn: t, originalIndex: i })).filter(({ turn }) => !OVERHEAD_PHASES.has(turn.phase)),
		[turns]
	)

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
				e.preventDefault()
				setOpen(true)
				setTimeout(() => inputRef.current?.focus(), 50)
			}
			if (e.key === 'Escape' && open) {
				setOpen(false)
				setQuery('')
			}
		}
		window.addEventListener('keydown', handler)
		return () => window.removeEventListener('keydown', handler)
	}, [open])

	useEffect(() => {
		if (open) ensureHighlightStyle()
		highlightInPage(open ? query : '')
		return () => highlightInPage('')
	}, [query, open])

	const turnTexts = useMemo(() => searchableTurns.map(({ turn }) => extractTurnText(turn)), [searchableTurns])

	const matches = useMemo(() => {
		if (!query || query.length < 2) return []
		const q = query.toLowerCase()
		const results: SearchMatch[] = []

		for (let ti = 0; ti < searchableTurns.length; ti++) {
			const text = turnTexts[ti]
			const lower = text.toLowerCase()
			let lastIdx = -1
			let pos = 0
			while ((pos = lower.indexOf(q, pos)) !== -1) {
				lastIdx = pos
				pos += 1
			}
			if (lastIdx !== -1) {
				results.push({
					turnIndex: searchableTurns[ti].originalIndex,
					phase: searchableTurns[ti].turn.phase,
					context: getContext(text, lastIdx, query),
					offset: lastIdx,
				})
			}
		}

		return results
	}, [query, searchableTurns, turnTexts])

	const navigateTo = useCallback((match: SearchMatch) => {
		onNavigate(match.turnIndex)
	}, [onNavigate])

	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && matches.length > 0) {
			const idx = e.shiftKey
				? (activeIdx - 1 + matches.length) % matches.length
				: (activeIdx + 1) % matches.length
			setActiveIdx(idx)
			navigateTo(matches[idx])
		}
	}, [matches, activeIdx, navigateTo])

	useEffect(() => {
		setActiveIdx(0)
	}, [query])

	if (!open) return null

	return (
		<div className="fixed top-0 left-0 right-0 z-[100] flex justify-center pointer-events-none">
			<div className="mt-2 bg-(--bg-card) border border-(--border) rounded-lg shadow-2xl px-3 py-2 w-full max-w-xl pointer-events-auto">
				<div className="flex items-center gap-2">
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={e => setQuery(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Search in cycle…"
						className="flex-1 bg-transparent border border-(--border) rounded px-2 py-1 text-xs outline-none focus:border-(--accent) text-(--text) placeholder:text-(--text-dim)"
						autoFocus
					/>
					<span className="text-[10px] text-(--text-dim) shrink-0">
						{matches.length > 0
							? `${activeIdx + 1}/${matches.length}`
							: query.length >= 2 ? 'none' : ''
						}
					</span>
					<button
						onClick={() => { setOpen(false); setQuery('') }}
						className="text-(--text-dim) hover:text-(--text) text-xs px-0.5"
					>
						✕
					</button>
				</div>

				{matches.length > 0 && (
					<div className="mt-1.5 max-h-48 overflow-y-auto space-y-px">
						{matches.map((m, i) => (
							<button
								key={i}
								onClick={() => { setActiveIdx(i); navigateTo(m) }}
								className={`w-full text-left px-1.5 py-0.5 rounded text-[10px] font-mono leading-tight transition-colors ${i === activeIdx ? 'bg-(--accent-dim) text-(--text)' : 'text-(--text-dim) hover:bg-(--bg-hover)'}`}
							>
								<span className="font-semibold capitalize opacity-60 mr-1">{m.phase}#{m.turnIndex + 1}</span>
								<HighlightedContext context={m.context} />
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	)
}

function HighlightedContext({ context }: { context: string }) {
	const parts = context.split(/<<|>>/)
	return (
		<span className="break-all">
			{parts.map((part, i) =>
				i % 2 === 1
					? <span key={i} className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">{part}</span>
					: <span key={i} className="opacity-60">{part}</span>
			)}
		</span>
	)
}
