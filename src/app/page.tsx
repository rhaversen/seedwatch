import Link from 'next/link'
import { getCycles, getAllTurnStats } from '@/lib/data'
import { OverallStats } from './OverallStats'

export const dynamic = 'force-dynamic'

export default async function CyclesPage() {
  let cycles
  let turnStats
  try {
    ;[cycles, turnStats] = await Promise.all([getCycles(), getAllTurnStats()])
  } catch {
    return (
      <div className="text-center py-20 text-(--text-dim)">
        <p className="text-lg">Could not connect to database</p>
        <p className="text-sm mt-2">Set MONGODB_URI in seedwatch/.env.local</p>
        <p className="text-xs mt-1 font-mono">mongodb+srv://USER:PASS@HOST/DB?retryWrites=true&w=majority</p>
      </div>
    )
  }

  if (cycles.length === 0) {
    return (
      <div className="text-center py-20 text-(--text-dim)">
        <p className="text-lg">No cycles found</p>
        <p className="text-sm mt-2">Make sure MONGODB_URI is set in .env.local</p>
      </div>
    )
  }

  const totalCost = cycles.reduce((s, c) => s + c.totalCost, 0)

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-semibold">Cycles</h1>
        <span className="text-sm text-(--text-dim)">
          {cycles.length} cycles &middot; ${totalCost.toFixed(4)} total
        </span>
      </div>

      <OverallStats turns={turnStats} />

      <div className="space-y-2">
        {cycles.map((cycle, i) => (
          <Link
            key={cycle.id}
            href={`/cycle/${cycle.id}`}
            className="block border border-(--border) rounded-lg p-4 hover:bg-(--bg-hover) transition-colors"
          >
            <div className="flex items-baseline justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs text-(--text-dim) font-mono w-6">
                  #{cycles.length - i}
                </span>
                <span className="font-medium">{cycle.planTitle}</span>
              </div>
              <div className="flex items-center gap-4 text-sm text-(--text-dim)">
                <span>${cycle.totalCost.toFixed(4)}</span>
                <span>{cycle.totalCalls} calls</span>
                <span>
                  {new Date(cycle.createdAt).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
            </div>
            <div className="flex gap-2 mt-2 ml-9">
              {cycle.phases.map(p => (
                <span
                  key={p.phase}
                  className="text-xs px-2 py-0.5 rounded-full bg-(--bg-hover) text-(--text-dim)"
                >
                  {p.phase} ×{p.count}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
