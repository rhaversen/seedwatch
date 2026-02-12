import Link from 'next/link'
import { getCycleDetail } from '@/lib/data'
import { notFound } from 'next/navigation'
import { CycleContent } from './CycleContent'

export const dynamic = 'force-dynamic'

interface Props {
	params: Promise<{ id: string }>
}

export default async function CyclePage({ params }: Props) {
	const { id } = await params
	let data
	try {
		data = await getCycleDetail(id)
	} catch {
		notFound()
	}
	if (!data) notFound()

	const { usage, turns, log } = data

	return (
		<div>
			<div className="mb-6">
				<Link href="/" className="text-sm text-(--text-dim) hover:text-(--text)">
					← Back to cycles
				</Link>
			</div>

			<div className="border border-(--border) rounded-lg p-5 mb-6">
				<h1 className="text-xl font-semibold mb-3">{usage.planTitle}</h1>
				<div className="flex gap-6 text-sm text-(--text-dim)">
					<span>${usage.totalCost.toFixed(4)}</span>
					<span>{usage.totalCalls} API calls</span>
					<span>{(usage.totalInputTokens / 1000).toFixed(1)}k in / {(usage.totalOutputTokens / 1000).toFixed(1)}k out</span>
					<span>{new Date(usage.createdAt).toLocaleString()}</span>
				</div>
			</div>

			<CycleContent turns={turns} />

			{log && log.entries.length > 0 && (
				<section className="mb-8">
					<h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
						<span className="text-(--text-dim)">📋</span>
						Iteration Log
					</h2>
					<div className="border border-(--border) rounded-lg p-4 font-mono text-xs space-y-1 max-h-96 overflow-y-auto">
						{log.entries.map((entry, i) => (
							<div key={i} className="flex gap-2">
								<span className="text-(--text-dim) shrink-0">
									{entry.timestamp.split('T')[1]?.slice(0, 12) ?? entry.timestamp}
								</span>
								<span className={
									entry.level === 'ERROR' ? 'text-(--error)' :
									entry.level === 'WARN' ? 'text-(--warn)' :
									'text-(--text-dim)'
								}>
									[{entry.level}]
								</span>
								<span className="break-all">{entry.message}</span>
							</div>
						))}
					</div>
				</section>
			)}
		</div>
	)
}
