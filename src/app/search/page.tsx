import Link from 'next/link'
import { searchTurns } from '@/lib/data'
import { phaseColors } from '@/lib/phases'

export const dynamic = 'force-dynamic'

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
	const { q } = await searchParams
	const query = q?.trim() ?? ''
	const results = query.length >= 2 ? await searchTurns(query) : []
	const totalHits = results.reduce((s, r) => s + r.hits.length, 0)

	return (
		<div>
			<h1 className="text-2xl font-semibold mb-6">Search</h1>

			<form className="mb-6">
				<input
					name="q"
					type="text"
					defaultValue={query}
					placeholder="Search all messages and responses…"
					className="w-full px-4 py-2.5 rounded-lg border border-(--border) bg-(--bg-card) text-(--text) placeholder:text-(--text-dim) focus:outline-none focus:ring-2 focus:ring-(--accent)/40 text-sm"
					autoFocus
				/>
			</form>

			{query && query.length < 2 && (
				<p className="text-sm text-(--text-dim)">Query must be at least 2 characters.</p>
			)}

			{query.length >= 2 && results.length === 0 && (
				<p className="text-sm text-(--text-dim)">No results found for &ldquo;{query}&rdquo;</p>
			)}

			{results.length > 0 && (
				<div className="space-y-3">
					<p className="text-xs text-(--text-dim) mb-3">
						{totalHits} match{totalHits !== 1 ? 'es' : ''} across {results.length} phase group{results.length !== 1 ? 's' : ''}
					</p>
					{results.map((r, i) => (
						<div
							key={`${r.cycleId}-${r.phase}-${i}`}
							className="border border-(--border) rounded-lg overflow-hidden"
						>
							<Link
								href={`/cycle/${r.cycleId}?turn=${r.hits[0].turnIndex}`}
								className="flex items-center gap-2 p-3 hover:bg-(--bg-hover) transition-colors border-b border-(--border)"
							>
								<span
									className="w-2 h-2 rounded-full inline-block shrink-0"
									style={{ backgroundColor: phaseColors[r.phase] ?? '#737373' }}
								/>
								<span className="text-xs font-medium capitalize">{r.phase}</span>
								<span className="text-xs text-(--text-dim)">·</span>
								<span className="text-xs text-(--text-dim)">{r.hits.length} turn{r.hits.length !== 1 ? 's' : ''}</span>
								<span className="text-xs text-(--text-dim) ml-auto">{r.cycleTitle}</span>
							</Link>
							<div className="divide-y divide-(--border)">
								{r.hits.map((hit, hi) => (
									<Link
										key={`${hit.turnId}-${hi}`}
										href={`/cycle/${r.cycleId}?turn=${hit.turnIndex}`}
										className="block px-3 py-2 hover:bg-(--bg-hover) transition-colors"
									>
										<div className="flex items-center gap-2 mb-0.5">
											<span className="text-[10px] text-(--text-dim) font-mono">turn {hit.turnIndex + 1}</span>
											<span className="text-[10px] text-(--text-dim)">{hit.role}</span>
										</div>
										<p className="text-xs font-mono text-(--text-dim) leading-relaxed whitespace-pre-wrap break-all line-clamp-2">
											{highlightSnippet(hit.snippet, query)}
										</p>
									</Link>
								))}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

function highlightSnippet(text: string, query: string) {
	const parts: (string | { match: string })[] = []
	const lower = text.toLowerCase()
	const ql = query.toLowerCase()
	let pos = 0
	while (pos < text.length) {
		const idx = lower.indexOf(ql, pos)
		if (idx === -1) {
			parts.push(text.slice(pos))
			break
		}
		if (idx > pos) parts.push(text.slice(pos, idx))
		parts.push({ match: text.slice(idx, idx + query.length) })
		pos = idx + query.length
	}
	return parts.map((p, i) =>
		typeof p === 'string'
			? <span key={i}>{p}</span>
			: <mark key={i} className="bg-yellow-500/30 text-(--text) rounded px-0.5">{p.match}</mark>
	)
}
