'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface SearchMatch {
	element: Element
	context: string
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

function searchDomForMatches(query: string): SearchMatch[] {
	const container = document.querySelector('[data-cycle-content]')
	if (!container || query.length < 2) return []

	const q = query.toLowerCase()
	const matches: SearchMatch[] = []
	const seen = new Set<Element>()

	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
	let node: Text | null
	while ((node = walker.nextNode() as Text | null)) {
		const text = node.textContent
		if (!text) continue
		const lower = text.toLowerCase()
		const idx = lower.indexOf(q)
		if (idx === -1) continue

		let el: Element | null = node.parentElement
		while (el && !seen.has(el)) {
			if (el.matches('[data-message-block], [data-tool-block], [data-thinking-block]')) {
				seen.add(el)
				matches.push({
					element: el,
					context: getContext(text, idx, query),
				})
				break
			}
			el = el.parentElement
		}
	}

	return matches
}

export function CycleSearch() {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)
	const [activeIdx, setActiveIdx] = useState(0)
	const [matches, setMatches] = useState<SearchMatch[]>([])

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
				e.preventDefault()
				const selection = window.getSelection()?.toString().trim() || ''
				if (selection && selection.length < 100) {
					setQuery(selection)
				}
				setOpen(true)
				setTimeout(() => {
					inputRef.current?.focus()
					inputRef.current?.select()
				}, 50)
			}
			if (e.key === 'Escape' && open) {
				e.preventDefault()
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

		const newMatches = open ? searchDomForMatches(query) : []
		setMatches(newMatches)
		setActiveIdx(0)

		return () => highlightInPage('')
	}, [query, open])

	const navigateTo = useCallback((match: SearchMatch) => {
		const yOffset = -80
		const y = match.element.getBoundingClientRect().top + window.scrollY + yOffset
		window.scrollTo({ top: y, behavior: 'smooth' })
	}, [])

	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && matches.length > 0) {
			const idx = e.shiftKey
				? (activeIdx - 1 + matches.length) % matches.length
				: (activeIdx + 1) % matches.length
			setActiveIdx(idx)
			navigateTo(matches[idx])
		}
	}, [matches, activeIdx, navigateTo])

	if (!open) return null

	return (
		<div className="fixed top-2 right-4 z-[100]">
			<div className="bg-(--bg-card) border border-(--border) rounded-lg shadow-2xl px-2 py-1.5 w-72">
				<div className="flex items-center gap-1.5">
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={e => setQuery(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Search…"
						className="flex-1 bg-transparent border border-(--border) rounded px-1.5 py-0.5 text-[11px] outline-none focus:border-(--accent) text-(--text) placeholder:text-(--text-dim)"
						autoFocus
					/>
					<span className="text-[9px] text-(--text-dim) shrink-0 tabular-nums">
						{matches.length > 0
							? `${activeIdx + 1}/${matches.length}`
							: query.length >= 2 ? '0' : ''
						}
					</span>
					<button
						onClick={() => { setOpen(false); setQuery('') }}
						className="text-(--text-dim) hover:text-(--text) text-[10px] px-0.5"
					>
						✕
					</button>
				</div>

				{matches.length > 0 && (
					<div className="mt-1 max-h-40 overflow-y-auto space-y-px">
						{matches.map((m, i) => (
							<button
								key={i}
								onClick={() => { setActiveIdx(i); navigateTo(m) }}
								className={`w-full text-left px-1 py-0.5 rounded text-[9px] font-mono leading-tight transition-colors ${i === activeIdx ? 'bg-(--accent-dim) text-(--text)' : 'text-(--text-dim) hover:bg-(--bg-hover)'}`}
							>
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
