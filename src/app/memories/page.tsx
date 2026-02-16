import { getMemories } from '@/lib/data'
import type { MemoryCategory } from '@/lib/models'

export const dynamic = 'force-dynamic'

export default async function MemoriesPage() {
	let memories
	try {
		memories = await getMemories()
	} catch {
		return (
			<div className="text-center py-20 text-(--text-dim)">
				<p className="text-lg">Could not connect to database</p>
				<p className="text-sm mt-2">Set MONGODB_URI in seedwatch/.env.local</p>
			</div>
		)
	}

	const notes = memories.filter(m => m.category === 'note' && m.active)
	const dismissed = memories.filter(m => m.category === 'note' && !m.active)
	const reflections = memories.filter(m => m.category === 'reflection')

	return (
		<div>
			<h1 className="text-2xl font-semibold mb-6">Memories</h1>

			{notes.length > 0 && (
				<section className="mb-8">
					<h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
						<span>📌</span> Notes to Self
						<span className="text-sm font-normal text-(--text-dim)">({notes.length})</span>
					</h2>
					<div className="space-y-2">
						{notes.map(m => (
							<MemoryCard key={m._id} memory={m} />
						))}
					</div>
				</section>
			)}

			<section className="mb-8">
				<h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
					<span>🪞</span> Reflections
					<span className="text-sm font-normal text-(--text-dim)">({reflections.length})</span>
				</h2>
				{reflections.length === 0 ? (
					<p className="text-(--text-dim)">No reflections yet</p>
				) : (
					<div className="space-y-2">
						{reflections.map(m => (
							<MemoryCard key={m._id} memory={m} />
						))}
					</div>
				)}
			</section>

			{dismissed.length > 0 && (
				<section>
					<h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
						<span>🗑️</span> Dismissed
						<span className="text-sm font-normal text-(--text-dim)">({dismissed.length})</span>
					</h2>
					<div className="space-y-2">
						{dismissed.map(m => (
							<MemoryCard key={m._id} memory={m} />
						))}
					</div>
				</section>
			)}
		</div>
	)
}

function MemoryCard({ memory }: { memory: { _id: string; summary: string; content: string; category: MemoryCategory; active: boolean; createdAt: string | Date } }) {
	return (
		<details className="border border-(--border) rounded-lg group">
			<summary className="p-3 cursor-pointer hover:bg-(--bg-hover) transition-colors flex items-center justify-between">
				<div className="flex items-center gap-3">
					<span className="text-xs px-2 py-0.5 rounded-full bg-(--accent-dim) text-(--accent)">{memory.category}</span>
					{!memory.active && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">dismissed</span>}
					<span className="text-sm">{memory.summary}</span>
				</div>
				<span className="text-xs text-(--text-dim)">
					{new Date(memory.createdAt).toLocaleDateString('en-US', {
						month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
					})}
				</span>
			</summary>
			<div className="border-t border-(--border) p-4">
				<pre className="text-xs whitespace-pre-wrap break-words font-mono text-(--text-dim)">
					{memory.content}
				</pre>
				<div className="mt-2 text-xs text-(--text-dim)">
					ID: {memory._id}
				</div>
			</div>
		</details>
	)
}
