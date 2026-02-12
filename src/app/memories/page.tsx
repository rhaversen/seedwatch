import { getMemories } from '@/lib/data'

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

	const pinned = memories.filter(m => m.pinned)
	const past = memories.filter(m => !m.pinned)

	return (
		<div>
			<h1 className="text-2xl font-semibold mb-6">Memories</h1>

			{pinned.length > 0 && (
				<section className="mb-8">
					<h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
						<span>📌</span> Notes to Self
						<span className="text-sm font-normal text-(--text-dim)">({pinned.length})</span>
					</h2>
					<div className="space-y-2">
						{pinned.map(m => (
							<MemoryCard key={m._id} memory={m} />
						))}
					</div>
				</section>
			)}

			<section>
				<h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
					<span>🕐</span> Past
					<span className="text-sm font-normal text-(--text-dim)">({past.length})</span>
				</h2>
				{past.length === 0 ? (
					<p className="text-(--text-dim)">No memories yet</p>
				) : (
					<div className="space-y-2">
						{past.map(m => (
							<MemoryCard key={m._id} memory={m} />
						))}
					</div>
				)}
			</section>
		</div>
	)
}

function MemoryCard({ memory }: { memory: { _id: string; summary: string; content: string; pinned: boolean; createdAt: string | Date } }) {
	return (
		<details className="border border-(--border) rounded-lg group">
			<summary className="p-3 cursor-pointer hover:bg-(--bg-hover) transition-colors flex items-center justify-between">
				<div className="flex items-center gap-3">
					{memory.pinned && <span className="text-xs px-2 py-0.5 rounded-full bg-(--accent-dim) text-(--accent)">pinned</span>}
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
