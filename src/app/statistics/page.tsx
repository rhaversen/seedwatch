import { getStatistics } from '@/lib/data'
import type { Statistics, BuilderTurnPoint, SystemPromptBreakdown, MemoryCallDetail, SummarizerBatchDetail, CycleOverview, PhaseStats, FixPhaseSegment, TokenBucket, ToolUsageStat, PhaseProductivity, RepeatedFileRead, CostEfficiencyBand } from '@/lib/data'
import DownloadButton from './DownloadButton'
import { phaseColors } from '@/lib/phases'

export const dynamic = 'force-dynamic'

function fmt(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
	return String(Math.round(n))
}

function fmtCost(n: number): string {
	if (n >= 0.01) return `$${n.toFixed(4)}`
	return `$${n.toFixed(6)}`
}

function pct(part: number, total: number): string {
	if (total === 0) return '0%'
	return `${((part / total) * 100).toFixed(1)}%`
}

export default async function StatisticsPage() {
	let stats: Statistics
	try {
		stats = await getStatistics()
	} catch {
		return (
			<div className="text-center py-20 text-(--text-dim)">
				<p className="text-lg">Could not connect to database</p>
				<p className="text-sm mt-2">Set MONGODB_URI in seedwatch/.env.local</p>
			</div>
		)
	}

	if (stats.cycleCount === 0) {
		return (
			<div className="text-center py-20 text-(--text-dim)">
				<p className="text-lg">No data found</p>
			</div>
		)
	}

	return (
		<div className="space-y-8">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Token Usage Statistics</h1>
				<DownloadButton />
			</div>

			<ExecutiveSummary stats={stats} />
			<ToplineStats stats={stats} />
			<PhaseBreakdown phaseStats={stats.phaseStats} totalCost={stats.totalCost} totalInput={stats.totalInputTokens} />
			<CycleComparison overviews={stats.cycleOverviews} />
			<CycleScorecard stats={stats} />
			<BuilderEscalation points={stats.builderTurnPoints} />
			<FixPhaseAnalysis segments={stats.fixPhaseSegments} points={stats.builderTurnPoints} totalCost={stats.totalCost} effectiveRate={stats.effectiveInputRate} />
			<InputTokenSpikes points={stats.builderTurnPoints} effectiveRate={stats.effectiveInputRate} />
			<SystemUserSplit points={stats.builderTurnPoints} />
			<TokenThresholdAnalysis buckets={stats.tokenBuckets} totalBuilderCost={stats.phaseStats.find(p => p.phase === 'builder')?.cost ?? 0} />
			<SystemPromptAnalysis breakdowns={stats.systemPromptBreakdowns} avgBuilderTurns={Math.round((stats.phaseStats.find(p => p.phase === 'builder')?.calls ?? 0) / Math.max(stats.cycleCount, 1))} effectiveRate={stats.effectiveInputRate} />
			<CompressionAnalysis points={stats.builderTurnPoints} />
			<RepeatedFileReads reads={stats.repeatedFileReads} />
			<ToolUsageAnalysis tools={stats.toolUsageStats} />
			<BuildVsFixProductivity productivity={stats.phaseProductivity} />
			<CostEfficiencyCurve bands={stats.costEfficiencyBands} />
			<MemoryOverhead details={stats.memoryCallDetails} totalCost={stats.totalCost} />
			<SummarizerOverhead details={stats.summarizerBatchDetails} totalCost={stats.totalCost} />
			<OptimizationOpportunities stats={stats} />
		</div>
	)
}

function ExecutiveSummary({ stats }: { stats: Statistics }) {
	const fixProd = stats.phaseProductivity.find(p => p.label === 'Fix phases')
	const buildProd = stats.phaseProductivity.find(p => p.label === 'Build (no fix)')
	const fixCostPct = fixProd ? (fixProd.totalCost / stats.totalCost) * 100 : 0
	const fixCostMultiplier = fixProd && buildProd && buildProd.costPerOutputToken > 0
		? fixProd.costPerOutputToken / buildProd.costPerOutputToken : 0
	const totalReReads = stats.repeatedFileReads.reduce((s, r) => s + r.readCount - 1, 0)
	const uncachedBuilder = stats.systemPromptBreakdowns.find(b => b.phase === 'builder')
	const uncachedChars = uncachedBuilder?.blocks.filter(b => !b.cached).reduce((s, b) => s + b.chars, 0) ?? 0
	const uncachedTokens = Math.round(uncachedChars / 4)
	const avgBuilderTurns = Math.round((stats.phaseStats.find(p => p.phase === 'builder')?.calls ?? 0) / Math.max(stats.cycleCount, 1))
	const cacheSavingsPerCycle = (uncachedTokens * avgBuilderTurns * 0.9 * stats.effectiveInputRate) / 1_000_000

	const findings: { icon: string; label: string; detail: string; color: string }[] = []

	if (fixProd && fixCostPct > 0) {
		findings.push({
			icon: String(findings.length + 1),
			label: 'Fix phases dominate cost',
			detail: `${fixCostPct.toFixed(0)}% of total spend is in fix phases${fixCostMultiplier > 0 ? `, costing ${fixCostMultiplier.toFixed(1)}x more per output token than build phases` : ''}.`,
			color: 'var(--error)',
		})
	}

	if (uncachedTokens > 0) {
		findings.push({
			icon: String(findings.length + 1),
			label: 'Uncached system prompt',
			detail: `${fmt(uncachedTokens)} tokens of builder system prompt are sent uncached every turn. Caching saves ~${fmtCost(cacheSavingsPerCycle)}/cycle.`,
			color: 'var(--warn)',
		})
	}

	if (totalReReads > 0) {
		findings.push({
			icon: String(findings.length + 1),
			label: 'Aggressive compression causes re-reads',
			detail: `${totalReReads} redundant file reads across cycles because earlier results were fully redacted instead of summarized.`,
			color: 'var(--warn)',
		})
	}

	if (findings.length === 0) return null

	return (
		<section className="border-2 border-(--accent)/30 rounded-lg p-5 bg-(--accent)/5">
			<h2 className="text-lg font-semibold mb-3">Key Findings</h2>
			<div className={`grid gap-4 ${findings.length >= 3 ? 'md:grid-cols-3' : findings.length === 2 ? 'md:grid-cols-2' : ''}`}>
				{findings.map(f => (
					<div key={f.icon} className="flex gap-3">
						<div
							className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
							style={{ backgroundColor: f.color, color: '#0c0c0c' }}
						>
							{f.icon}
						</div>
						<div>
							<div className="font-medium text-sm">{f.label}</div>
							<div className="text-xs text-(--text-dim) mt-0.5">{f.detail}</div>
						</div>
					</div>
				))}
			</div>
		</section>
	)
}

function ToplineStats({ stats }: { stats: Statistics }) {
	return (
		<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
			{[
				{ label: 'Total Cost', value: fmtCost(stats.totalCost) },
				{ label: 'Total API Calls', value: String(stats.totalCalls) },
				{ label: 'Avg Cost / Cycle', value: fmtCost(stats.avgCostPerCycle) },
				{ label: 'Cycles Analyzed', value: String(stats.cycleCount) },
				{ label: 'Total Input Tokens', value: fmt(stats.totalInputTokens) },
				{ label: 'Total Output Tokens', value: fmt(stats.totalOutputTokens) },
				{ label: 'Avg Input / Cycle', value: fmt(stats.avgInputTokensPerCycle) },
				{ label: 'Input/Output Ratio', value: `${(stats.totalInputTokens / Math.max(stats.totalOutputTokens, 1)).toFixed(1)}x` },
				{ label: 'Cost / Output Token', value: `$${(stats.totalCost / Math.max(stats.totalOutputTokens, 1) * 1000).toFixed(2)}/1k` },
				{ label: 'Cache Read Tokens', value: fmt(stats.totalCacheReadTokens) },
				{ label: 'Cache Write 5m', value: fmt(stats.totalCacheWrite5mTokens) },
				{ label: 'Cache Write 1h', value: fmt(stats.totalCacheWrite1hTokens) },
			].map(s => (
				<div key={s.label} className="border border-(--border) rounded-lg p-4">
					<div className="text-xs text-(--text-dim)">{s.label}</div>
					<div className="text-xl font-mono font-semibold mt-1">{s.value}</div>
				</div>
			))}
		</div>
	)
}

function PhaseBreakdown({ phaseStats, totalCost, totalInput }: { phaseStats: PhaseStats[]; totalCost: number; totalInput: number }) {
	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-4">Phase Breakdown</h2>

			{/* Cost bar */}
			<div className="mb-4">
				<div className="text-xs text-(--text-dim) mb-1">Cost Distribution</div>
				<div className="flex rounded-full overflow-hidden h-6">
					{phaseStats.map(p => {
						const w = (p.cost / totalCost) * 100
						if (w < 0.5) return null
						return (
							<div
								key={p.phase}
								className="flex items-center justify-center text-[10px] font-mono text-white/90"
								style={{ width: `${w}%`, backgroundColor: phaseColors[p.phase] ?? '#555', minWidth: w > 3 ? undefined : 0 }}
								title={`${p.phase}: ${fmtCost(p.cost)} (${pct(p.cost, totalCost)})`}
							>
								{w > 8 ? `${p.phase} ${pct(p.cost, totalCost)}` : ''}
							</div>
						)
					})}
				</div>
			</div>

			{/* Input token bar */}
			<div className="mb-6">
				<div className="text-xs text-(--text-dim) mb-1">Input Token Distribution</div>
				<div className="flex rounded-full overflow-hidden h-6">
					{phaseStats.map(p => {
						const w = (p.inputTokens / totalInput) * 100
						if (w < 0.5) return null
						return (
							<div
								key={p.phase}
								className="flex items-center justify-center text-[10px] font-mono text-white/90"
								style={{ width: `${w}%`, backgroundColor: phaseColors[p.phase] ?? '#555' }}
								title={`${p.phase}: ${fmt(p.inputTokens)} (${pct(p.inputTokens, totalInput)})`}
							>
								{w > 8 ? `${p.phase} ${pct(p.inputTokens, totalInput)}` : ''}
							</div>
						)
					})}
				</div>
			</div>

			<table className="w-full text-sm">
				<thead>
					<tr className="text-left text-(--text-dim) text-xs border-b border-(--border)">
						<th className="pb-2">Phase</th>
						<th className="pb-2 text-right">Calls</th>
						<th className="pb-2 text-right">Input Tokens</th>
						<th className="pb-2 text-right">Output Tokens</th>
						<th className="pb-2 text-right">Cost</th>
						<th className="pb-2 text-right">% of Cost</th>
						<th className="pb-2 text-right">Avg Input/Call</th>
						<th className="pb-2 text-right">Avg Cost/Call</th>
					</tr>
				</thead>
				<tbody>
					{phaseStats.map(p => (
						<tr key={p.phase} className="border-b border-(--border)/30">
							<td className="py-2 flex items-center gap-2">
								<span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: phaseColors[p.phase] }} />
								<span className="capitalize font-medium">{p.phase}</span>
							</td>
							<td className="py-2 text-right font-mono">{p.calls}</td>
							<td className="py-2 text-right font-mono">{fmt(p.inputTokens)}</td>
							<td className="py-2 text-right font-mono">{fmt(p.outputTokens)}</td>
							<td className="py-2 text-right font-mono">{fmtCost(p.cost)}</td>
							<td className="py-2 text-right font-mono">{pct(p.cost, totalCost)}</td>
							<td className="py-2 text-right font-mono">{fmt(p.avgInputTokens)}</td>
							<td className="py-2 text-right font-mono">{fmtCost(p.avgCost)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	)
}

function CycleComparison({ overviews }: { overviews: CycleOverview[] }) {
	const maxCost = Math.max(...overviews.map(c => c.totalCost), 0.001)

	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-4">Per-Cycle Comparison</h2>
			<div className="space-y-3">
				{overviews.map(c => {
					return (
						<div key={c.index}>
							<div className="flex items-baseline justify-between text-sm mb-1">
								<span className="font-medium">
									<span className="text-(--text-dim) font-mono mr-2">#{c.index + 1}</span>
									{c.title}
								</span>
								<span className="font-mono text-xs">{fmtCost(c.totalCost)}</span>
							</div>
							<div className="relative h-5 rounded-full overflow-hidden bg-(--bg-hover)">
								{(['planner', 'builder', 'memory', 'reflect', 'summarizer'] as const).reduce<{ elements: React.ReactNode[]; offset: number }>((acc, phase) => {
									const phaseCost = c.phaseCosts[phase] ?? 0
									const w = (phaseCost / maxCost) * 100
									if (w > 0.2) {
										acc.elements.push(
											<div
												key={phase}
												className="absolute top-0 bottom-0"
												style={{
													left: `${acc.offset}%`,
													width: `${w}%`,
													backgroundColor: phaseColors[phase] ?? '#555',
													opacity: 0.7,
												}}
												title={`${phase}: ${fmtCost(phaseCost)}`}
											/>
										)
									}
									acc.offset += w
									return acc
								}, { elements: [], offset: 0 }).elements}
							</div>
							<div className="flex gap-4 text-xs text-(--text-dim) mt-1">
								<span>{c.totalCalls} calls</span>
								<span>{fmt(c.totalInputTokens)} in</span>
								<span>{c.builderTurns} builder turns</span>
								<span>{c.plannerTurns} planner turns</span>
								<span>{c.memoryTurns} memory calls</span>
								{c.summarizerBatches > 0 && <span>{c.summarizerBatches} summarizer batches</span>}
							</div>
						</div>
					)
				})}
			</div>
		</section>
	)
}

function CycleScorecard({ stats }: { stats: Statistics }) {
	const rows = stats.cycleOverviews.map(c => {
		const fixSegs = stats.fixPhaseSegments.filter(f => f.cycleIndex === c.index)
		const fixTurns = fixSegs.reduce((s, f) => s + f.turnCount, 0)
		const fixCost = fixSegs.reduce((s, f) => s + f.totalCost, 0)
		const reReads = stats.repeatedFileReads.filter(r => r.cycleIndex === c.index)
		const reReadCount = reReads.reduce((s, r) => s + r.readCount - 1, 0)
		const costPerOutput = c.totalOutputTokens > 0 ? (c.totalCost / c.totalOutputTokens) * 1000 : 0
		const fixPct = c.totalCost > 0 ? (fixCost / c.totalCost) * 100 : 0

		return {
			title: c.title,
			turns: c.builderTurns,
			fixPhases: fixSegs.length,
			fixTurns,
			fixPct,
			reReads: reReadCount,
			costPerOutput,
			totalCost: c.totalCost,
		}
	})

	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-2">Cycle Efficiency Scorecard</h2>
			<p className="text-xs text-(--text-dim) mb-4">
				Consolidated view of efficiency metrics per cycle. Cycles with high fix %, many re-reads,
				or high cost/output are the least efficient.
			</p>

			<table className="w-full text-xs font-mono">
				<thead>
					<tr className="text-(--text-dim) border-b border-(--border)">
						<th className="text-left pb-1 pr-3">Cycle</th>
						<th className="text-right pb-1 pr-3">Turns</th>
						<th className="text-right pb-1 pr-3">Fix Phases</th>
						<th className="text-right pb-1 pr-3" title="Fix cost as % of total cycle cost">Fix Cost %</th>
						<th className="text-right pb-1 pr-3">Re-reads</th>
						<th className="text-right pb-1 pr-3">Cost/1k Out</th>
						<th className="text-right pb-1">Total Cost</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r, i) => (
						<tr key={i} className="border-b border-(--border)/20">
							<td className="py-1 pr-3 font-sans max-w-40 truncate">{r.title}</td>
							<td className="py-1 pr-3 text-right">{r.turns}</td>
							<td className="py-1 pr-3 text-right">{r.fixPhases > 0 ? <span className="text-(--error)">{r.fixPhases}</span> : '0'}</td>
							<td className="py-1 pr-3 text-right">
								<span className={r.fixPct > 50 ? 'text-(--error)' : r.fixPct > 0 ? 'text-(--warn)' : 'text-(--text-dim)'}>{r.fixPct.toFixed(0)}%</span>
							</td>
							<td className="py-1 pr-3 text-right">
								{r.reReads > 0 ? <span className="text-(--warn)">{r.reReads}</span> : <span className="text-(--text-dim)">0</span>}
							</td>
							<td className="py-1 pr-3 text-right">
								<span className={r.costPerOutput > 0.1 ? 'text-(--error)' : 'text-(--accent)'}>${r.costPerOutput.toFixed(3)}</span>
							</td>
							<td className="py-1 text-right">{fmtCost(r.totalCost)}</td>
						</tr>
					))}
				</tbody>
			</table>

			{(() => {
				const worst = rows.reduce((a, b) => a.costPerOutput > b.costPerOutput ? a : b)
				const best = rows.reduce((a, b) => a.costPerOutput < b.costPerOutput ? a : b)
				return (
					<div className="mt-4 p-3 bg-(--bg-hover) rounded-lg text-xs text-(--text-dim)">
						Least efficient: <strong className="text-(--error)">{worst.title}</strong> ({worst.fixPhases} fix phases,
						${worst.costPerOutput.toFixed(3)}/1k output).{' '}
						Most efficient: <strong className="text-(--accent)">{best.title}</strong> (0 fix phases,
						${best.costPerOutput.toFixed(3)}/1k output).{' '}
						{rows.filter(r => r.fixPct > 50).length > 0 && <>{rows.filter(r => r.fixPct > 50).length} of {rows.length} cycles spent &gt;50% of cost in fix phases &mdash; reducing initial build errors would have the largest impact.</>}
					</div>
				)
			})()}
		</section>
	)
}

function BuilderEscalation({ points }: { points: BuilderTurnPoint[] }) {
	if (points.length === 0) return null

	const byCycle = new Map<number, BuilderTurnPoint[]>()
	for (const p of points) {
		const arr = byCycle.get(p.cycleIndex) ?? []
		arr.push(p)
		byCycle.set(p.cycleIndex, arr)
	}

	const maxInput = Math.max(...points.map(p => p.inputTokens), 1)
	const maxTurn = Math.max(...points.map(p => p.turnInPhase), 1)

	const avgGrowthRates: { cycle: string; rate: number; startTokens: number; endTokens: number; turns: number; medianInput: number; totalCost: number; avgOutput: number }[] = []
	for (const [, cyclePts] of byCycle) {
		if (cyclePts.length < 2) continue
		const first = cyclePts[0].inputTokens
		const last = cyclePts[cyclePts.length - 1].inputTokens
		const rate = (last - first) / (cyclePts.length - 1)
		const sorted = [...cyclePts].sort((a, b) => a.inputTokens - b.inputTokens)
		const medianInput = sorted[Math.floor(sorted.length / 2)].inputTokens
		avgGrowthRates.push({
			cycle: cyclePts[0].cycleTitle,
			rate,
			startTokens: first,
			endTokens: last,
			turns: cyclePts.length,
			medianInput,
			totalCost: cyclePts.reduce((s, p) => s + p.cost, 0),
			avgOutput: Math.round(cyclePts.reduce((s, p) => s + p.outputTokens, 0) / cyclePts.length),
		})
	}

	const overallAvgGrowth = avgGrowthRates.length > 0
		? avgGrowthRates.reduce((s, r) => s + r.rate, 0) / avgGrowthRates.length
		: 0

	const lowOutputTurns = points.filter(p => p.outputTokens < 100)
	const totalOutTok = points.reduce((s, p) => s + p.outputTokens, 0)
	const avgOutputPerTurn = Math.round(totalOutTok / Math.max(points.length, 1))

	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-2">Builder Turn Escalation</h2>
			<p className="text-xs text-(--text-dim) mb-4">
				How input tokens grow with each successive builder turn within a cycle.
				Higher growth = more tokens wasted on conversation history accumulation.
			</p>

			<div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Avg Growth/Turn</div>
					<div className="text-lg font-mono font-semibold">+{fmt(overallAvgGrowth)} tok</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Max Builder Input</div>
					<div className="text-lg font-mono font-semibold">{fmt(maxInput)} tok</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Max Builder Turns</div>
					<div className="text-lg font-mono font-semibold">{maxTurn}</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Avg Output/Turn</div>
					<div className="text-lg font-mono font-semibold">{fmt(avgOutputPerTurn)} tok</div>
				</div>
			</div>

			{/* Per-cycle summary table */}
			<table className="w-full text-xs font-mono mb-4">
				<thead>
					<tr className="text-(--text-dim) border-b border-(--border)">
						<th className="text-left pb-1 pr-3">Cycle</th>
						<th className="text-right pb-1 pr-3">Turns</th>
						<th className="text-right pb-1 pr-3">Start</th>
						<th className="text-right pb-1 pr-3">End</th>
						<th className="text-right pb-1 pr-3">Median</th>
						<th className="text-right pb-1 pr-3">Growth/Turn</th>
						<th className="text-right pb-1 pr-3">Avg Out</th>
						<th className="text-right pb-1">Cost</th>
					</tr>
				</thead>
				<tbody>
					{avgGrowthRates.map((r, i) => (
						<tr key={i} className="border-b border-(--border)/20">
							<td className="py-1 pr-3 font-sans">{r.cycle}</td>
							<td className="py-1 pr-3 text-right">{r.turns}</td>
							<td className="py-1 pr-3 text-right">{fmt(r.startTokens)}</td>
							<td className="py-1 pr-3 text-right">{fmt(r.endTokens)}</td>
							<td className="py-1 pr-3 text-right">{fmt(r.medianInput)}</td>
							<td className="py-1 pr-3 text-right text-(--error)">+{fmt(r.rate)}</td>
							<td className="py-1 pr-3 text-right">{fmt(r.avgOutput)}</td>
							<td className="py-1 text-right">{fmtCost(r.totalCost)}</td>
						</tr>
					))}
				</tbody>
			</table>

			{/* Key turns only per cycle */}
			{[...byCycle.entries()].map(([ci, cyclePts]) => {
			const maxPt = cyclePts.reduce((a, b) => a.inputTokens > b.inputTokens ? a : b)
				const fixStarts = cyclePts.filter(p => p.isFixPhaseStart)
				const keyIndices = new Set([0, cyclePts.indexOf(maxPt), cyclePts.length - 1, ...fixStarts.map(f => cyclePts.indexOf(f))])
				if (cyclePts.length > 6 && keyIndices.size < 4) keyIndices.add(Math.floor(cyclePts.length / 2))
				const keyTurns = [...keyIndices].sort((a, b) => a - b).map(i => ({ ...cyclePts[i], idx: i }))

				return (
					<div key={ci} className="mb-4">
						<h3 className="text-sm font-medium mb-2">
							<span className="text-(--text-dim) font-mono mr-2">#{ci + 1}</span>
							{cyclePts[0].cycleTitle}
							<span className="text-xs text-(--text-dim) ml-2">({cyclePts.length} turns, showing {keyTurns.length} key points)</span>
						</h3>
						<div className="overflow-x-auto">
							<table className="w-full text-xs font-mono">
								<thead>
									<tr className="text-(--text-dim) border-b border-(--border)">
										<th className="text-left pb-1 pr-3">Turn</th>
										<th className="text-left pb-1 pr-3">Why</th>
										<th className="text-right pb-1 pr-3">Input</th>
										<th className="text-right pb-1 pr-3">Output</th>
										<th className="text-right pb-1 pr-3">Cost</th>
										<th className="text-right pb-1 pr-3">Msgs</th>
										<th className="text-right pb-1">Compressed</th>
									</tr>
								</thead>
								<tbody>
									{keyTurns.map((p) => {
										const label = p.idx === 0 ? 'start' : p.isFixPhaseStart ? '⚠ fix' : cyclePts.indexOf(maxPt) === p.idx ? '⬆ peak' : p.idx === cyclePts.length - 1 ? 'final' : 'mid'
										return (
											<tr key={p.turnInPhase} className={`border-b border-(--border)/20 ${p.isFixPhaseStart ? 'bg-red-500/5' : ''}`}>
												<td className="py-1 pr-3">{p.turnInPhase}</td>
												<td className={`py-1 pr-3 text-xs font-sans ${p.isFixPhaseStart ? 'text-(--error)' : 'text-(--text-dim)'}`}>{label}</td>
												<td className="py-1 pr-3 text-right">{fmt(p.inputTokens)}</td>
												<td className="py-1 pr-3 text-right">{fmt(p.outputTokens)}</td>
												<td className="py-1 pr-3 text-right">{fmtCost(p.cost)}</td>
												<td className="py-1 pr-3 text-right">{p.userMsgCount}u/{p.assistantMsgCount}a</td>
												<td className="py-1 text-right">{p.compressedToolResults}/{p.toolResultCount}</td>
											</tr>
										)
									})}
								</tbody>
							</table>
						</div>
					</div>
				)
			})}

			{/* Output productivity analysis */}
			<div className="mt-4 p-3 bg-(--bg-hover) rounded-lg text-xs">
				<div className="font-medium mb-2">Output Productivity</div>
				<div className="grid grid-cols-3 gap-4 mb-2">
					<div>
						<span className="text-(--text-dim)">Low-output turns (&lt;100 tok): </span>
						<span className="font-mono text-(--warn)">{lowOutputTurns.length}/{points.length}</span>
						<span className="text-(--text-dim)"> ({pct(lowOutputTurns.length, points.length)})</span>
					</div>
					<div>
						<span className="text-(--text-dim)">Cost of low-output turns: </span>
						<span className="font-mono text-(--error)">{fmtCost(lowOutputTurns.reduce((s, p) => s + p.cost, 0))}</span>
					</div>
					<div>
						<span className="text-(--text-dim)">Input/Output ratio: </span>
						<span className="font-mono">{(points.reduce((s, p) => s + p.inputTokens, 0) / Math.max(totalOutTok, 1)).toFixed(1)}x</span>
					</div>
				</div>
				<p className="text-(--text-dim)">Low-output turns are typically tool-use-only responses (read/search) where the model generates only a continuation request. These turns are necessary but expensive due to accumulated context.</p>
			</div>
		</section>
	)
}

function FixPhaseAnalysis({ segments, points, totalCost, effectiveRate }: { segments: FixPhaseSegment[]; points: BuilderTurnPoint[]; totalCost: number; effectiveRate: number }) {
	if (segments.length === 0) {
		return (
			<section className="border border-(--border) rounded-lg p-5">
				<h2 className="text-lg font-semibold mb-2">Fix Phase Analysis</h2>
				<p className="text-sm text-(--text-dim)">No fix phases detected — all cycles completed without CI failures.</p>
			</section>
		)
	}

	const totalFixCost = segments.reduce((s, seg) => s + seg.totalCost, 0)
	const totalFixTurns = segments.reduce((s, seg) => s + seg.turnCount, 0)
	const avgFirstMsgChars = Math.round(segments.reduce((s, seg) => s + seg.firstMsgChars, 0) / segments.length)

	const fixStartPoints = points.filter(p => p.isFixPhaseStart)
	const avgFixStartTokens = fixStartPoints.length > 0
		? Math.round(fixStartPoints.reduce((s, p) => s + p.inputTokens, 0) / fixStartPoints.length)
		: 0

	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-2">Fix Phase Analysis</h2>
			<p className="text-xs text-(--text-dim) mb-4">
				When CI fails, <code className="bg-(--bg-hover) px-1 rounded">fixPatch()</code> resets the conversation
				and injects the full git diff + error output as a new first message. This diff is uncached and re-sent
				every turn of the fix phase.
			</p>

			<div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Fix Phases</div>
					<div className="text-lg font-mono font-semibold">{segments.length}</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Total Fix Cost</div>
					<div className="text-lg font-mono font-semibold">{fmtCost(totalFixCost)}</div>
					<div className="text-xs text-(--text-dim)">{pct(totalFixCost, totalCost)} of total</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Fix Turns</div>
					<div className="text-lg font-mono font-semibold">{totalFixTurns}</div>
					<div className="text-xs text-(--text-dim)">{pct(totalFixTurns, points.length)} of builder turns</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Avg First Msg Size</div>
					<div className="text-lg font-mono font-semibold">{fmt(avgFirstMsgChars)} ch</div>
					<div className="text-xs text-(--text-dim)">~{fmt(avgFirstMsgChars / 4)} tokens</div>
				</div>
			</div>

			<table className="w-full text-xs font-mono">
				<thead>
					<tr className="text-(--text-dim) border-b border-(--border)">
						<th className="text-left pb-1 pr-3">Cycle</th>
						<th className="text-right pb-1 pr-3">Starts at Turn</th>
						<th className="text-right pb-1 pr-3">Fix Turns</th>
						<th className="text-right pb-1 pr-3">1st Msg Chars</th>
						<th className="text-right pb-1 pr-3">~Tokens (uncached)</th>
						<th className="text-right pb-1 pr-3">Cost</th>
						<th className="text-right pb-1">Input Tokens</th>
					</tr>
				</thead>
				<tbody>
					{segments.map((seg, i) => (
						<tr key={i} className="border-b border-(--border)/20">
							<td className="py-1 pr-3 font-sans">{seg.cycleTitle}</td>
							<td className="py-1 pr-3 text-right">{seg.startTurn}</td>
							<td className="py-1 pr-3 text-right">{seg.turnCount}</td>
							<td className="py-1 pr-3 text-right">{fmt(seg.firstMsgChars)}</td>
							<td className="py-1 pr-3 text-right">{fmt(seg.firstMsgChars / 4)}</td>
							<td className="py-1 pr-3 text-right">{fmtCost(seg.totalCost)}</td>
							<td className="py-1 text-right">{fmt(seg.totalInputTokens)}</td>
						</tr>
					))}
				</tbody>
			</table>

			<div className="mt-4 p-3 bg-(--bg-hover) rounded-lg text-xs space-y-1">
				<div className="font-medium text-(--warn)">Optimization: Cache fix message + abbreviate diff</div>
				<p className="text-(--text-dim)">
					The fix message averages <span className="font-mono">{fmt(avgFirstMsgChars)}</span> chars (~{fmt(avgFirstMsgChars / 4)} tokens),
					re-sent uncached across {totalFixTurns} fix turns. Adding <code className="bg-(--bg-hover) px-0.5 rounded">cache_control</code> to
					the first user message and abbreviating file creations to filenames-only would save:
				</p>
				<div className="font-mono text-(--accent)">
					~{fmt(avgFixStartTokens * totalFixTurns * 0.9)} tokens at 90% cache discount = ~{fmtCost((avgFixStartTokens * totalFixTurns * 0.9 * effectiveRate) / 1_000_000)}/cycle
				</div>
			</div>
		</section>
	)
}

function InputTokenSpikes({ points, effectiveRate }: { points: BuilderTurnPoint[]; effectiveRate: number }) {
	if (points.length < 2) return null

	const byCycle = new Map<number, BuilderTurnPoint[]>()
	for (const p of points) {
		const arr = byCycle.get(p.cycleIndex) ?? []
		arr.push(p)
		byCycle.set(p.cycleIndex, arr)
	}

	type Spike = BuilderTurnPoint & { delta: number; prevTokens: number; spikeType: 'fix-restart' | 'tool-result' | 'unknown' }
	const spikes: Spike[] = []

	for (const [, pts] of byCycle) {
		for (let i = 1; i < pts.length; i++) {
			const delta = pts[i].inputTokens - pts[i - 1].inputTokens
			if (delta > 2000) {
				const spikeType = pts[i].isFixPhaseStart ? 'fix-restart'
					: pts[i].largestToolResultChars > 2000 ? 'tool-result' : 'unknown'
				spikes.push({ ...pts[i], delta, prevTokens: pts[i - 1].inputTokens, spikeType })
			}
		}
	}

	spikes.sort((a, b) => b.delta - a.delta)
	const top15 = spikes.slice(0, 15)

	const totalSpikeCost = spikes.reduce((s, sp) => s + (sp.delta * effectiveRate) / 1_000_000, 0)
	const fixRestartSpikes = spikes.filter(sp => sp.spikeType === 'fix-restart')

	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-2">Input Token Spikes</h2>
			<p className="text-xs text-(--text-dim) mb-4">
				Turns where input tokens jumped by &gt;2k compared to the previous turn. These spikes
				are caused by large uncompressed tool results (the current tool result is never compressed).
				Immediate compression or summarization of large responses would eliminate these.
			</p>

			<div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Spikes (&gt;2k jump)</div>
					<div className="text-lg font-mono font-semibold">{spikes.length}</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Fix Restart Spikes</div>
					<div className="text-lg font-mono font-semibold text-(--error)">{fixRestartSpikes.length}</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Context Growth Spikes</div>
					<div className="text-lg font-mono font-semibold text-(--warn)">{spikes.length - fixRestartSpikes.length}</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Spike Cost (est.)</div>
					<div className="text-lg font-mono font-semibold text-(--warn)">{fmtCost(totalSpikeCost)}</div>
				</div>
			</div>

			<table className="w-full text-xs font-mono">
				<thead>
					<tr className="text-(--text-dim) border-b border-(--border)">
						<th className="text-left pb-1 pr-3">Cycle</th>
						<th className="text-right pb-1 pr-3">Turn</th>
						<th className="text-right pb-1 pr-3">Prev Tokens</th>
						<th className="text-right pb-1 pr-3">This Turn</th>
						<th className="text-right pb-1 pr-3">Δ Tokens</th>
						<th className="text-left pb-1 pr-3">Type</th>
						<th className="text-right pb-1 pr-3">Largest Result</th>
						<th className="text-left pb-1">Tool</th>
					</tr>
				</thead>
				<tbody>
					{top15.map((sp, i) => (
						<tr key={i} className={`border-b border-(--border)/20 ${sp.isFixPhaseStart ? 'bg-red-500/5' : ''}`}>
							<td className="py-1 pr-3 font-sans truncate max-w-37.5">{sp.cycleTitle}</td>
							<td className="py-1 pr-3 text-right">{sp.turnInPhase}{sp.isFixPhaseStart ? ' ⚠' : ''}</td>
							<td className="py-1 pr-3 text-right">{fmt(sp.prevTokens)}</td>
							<td className="py-1 pr-3 text-right">{fmt(sp.inputTokens)}</td>
							<td className="py-1 pr-3 text-right text-(--error)">+{fmt(sp.delta)}</td>
							<td className={`py-1 pr-3 text-xs font-sans ${sp.spikeType === 'fix-restart' ? 'text-(--error)' : 'text-(--warn)'}`}>{sp.spikeType === 'fix-restart' ? '⚠ fix reset' : sp.spikeType === 'tool-result' ? 'tool result' : 'other'}</td>
							<td className="py-1 pr-3 text-right">{sp.largestToolResultChars > 0 ? `${fmt(sp.largestToolResultChars)} ch` : '—'}</td>
							<td className="py-1 font-sans text-(--text-dim)">{sp.largestToolResultName}</td>
						</tr>
					))}
				</tbody>
			</table>

			{spikes.length > 15 && (
				<div className="mt-2 text-xs text-(--text-dim)">
					Showing top 15 of {spikes.length} spikes.
				</div>
			)}

			<div className="mt-4 p-3 bg-(--bg-hover) rounded-lg text-xs text-(--text-dim)">
				<strong>Immediate compression</strong> — if the current turn{"'"}s tool results were summarized before
				sending the next request (instead of waiting until they become {"\""}old{"\""}), these spikes would be
				eliminated. Estimated savings: <span className="font-mono text-(--accent)">{fmt(Math.round(spikes.reduce((s, sp) => s + sp.delta, 0) / Math.max([...new Set(spikes.map(sp => sp.cycleIndex))].length, 1)))} tokens/cycle</span>.
			</div>
		</section>
	)
}

function SystemUserSplit({ points }: { points: BuilderTurnPoint[] }) {
	if (points.length === 0) return null

	const byCycle = new Map<number, BuilderTurnPoint[]>()
	for (const p of points) {
		const arr = byCycle.get(p.cycleIndex) ?? []
		arr.push(p)
		byCycle.set(p.cycleIndex, arr)
	}

	const earlyTurns = points.filter(p => p.turnInPhase <= 3)
	const midTurns = points.filter(p => p.turnInPhase > 3 && p.turnInPhase <= 10)
	const lateTurns = points.filter(p => p.turnInPhase > 10)

	const avgRatio = (pts: BuilderTurnPoint[]) => {
		if (pts.length === 0) return { sys: 0, msg: 0, ratio: 'N/A' }
		const totalSys = pts.reduce((s, p) => s + p.systemChars, 0)
		const totalMsg = pts.reduce((s, p) => s + p.messageChars, 0)
		const total = totalSys + totalMsg
		return {
			sys: total > 0 ? (totalSys / total) * 100 : 0,
			msg: total > 0 ? (totalMsg / total) * 100 : 0,
			ratio: `${Math.round(total > 0 ? (totalSys / total) * 100 : 0)}/${Math.round(total > 0 ? (totalMsg / total) * 100 : 0)}`,
		}
	}

	const early = avgRatio(earlyTurns)
	const mid = avgRatio(midTurns)
	const late = avgRatio(lateTurns)

	const crossoverTurn = (() => {
		for (const [, pts] of byCycle) {
			for (const p of pts) {
				if (p.messageChars > p.systemChars && p.turnInPhase > 1) return p.turnInPhase
			}
		}
		return null
	})()

	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-2">System vs User Content Split</h2>
			<p className="text-xs text-(--text-dim) mb-4">
				How the balance between system prompt (codebase context, instructions) and
				conversation messages (tool results, assistant responses) shifts over a cycle.
			</p>

			<div className="grid grid-cols-3 gap-4 mb-4">
				{[
					{ label: 'Early (turns 1-3)', color: '#22c55e', ...early },
					{ label: 'Mid (turns 4-10)', color: '#f59e0b', ...mid },
					{ label: 'Late (turns 11+)', color: '#ef4444', ...late },
				].map(phase => (
					<div key={phase.label} className="border border-(--border) rounded-lg p-3">
						<div className="text-xs text-(--text-dim) mb-2">{phase.label}</div>
						<div className="flex rounded-full overflow-hidden h-4 mb-1">
							<div
								className="flex items-center justify-center text-[9px] text-white/80"
								style={{ width: `${phase.sys}%`, backgroundColor: '#3b82f6' }}
							>
								{phase.sys > 15 ? `sys ${phase.ratio.split('/')[0]}%` : ''}
							</div>
							<div
								className="flex items-center justify-center text-[9px] text-white/80"
								style={{ width: `${phase.msg}%`, backgroundColor: phase.color }}
							>
								{phase.msg > 15 ? `msg ${phase.ratio.split('/')[1]}%` : ''}
							</div>
						</div>
						<div className="text-xs font-mono text-center">{phase.ratio}</div>
					</div>
				))}
			</div>

			{crossoverTurn && (
				<div className="text-xs text-(--text-dim) mb-4">
					Message content surpasses system prompt at <span className="font-mono text-(--warn)">turn {crossoverTurn}</span>.
					After this point, conversation history dominates input tokens.
				</div>
			)}

			<table className="w-full text-xs font-mono">
				<thead>
					<tr className="text-(--text-dim) border-b border-(--border)">
						<th className="text-left pb-1 pr-3">Cycle</th>
						<th className="text-right pb-1 pr-3">Avg Sys Chars</th>
						<th className="text-right pb-1 pr-3">Avg Msg Chars</th>
						<th className="text-right pb-1 pr-3">Sys %</th>
						<th className="text-right pb-1 pr-3">Crossover Turn</th>
						<th className="text-right pb-1">Max Msg Chars</th>
					</tr>
				</thead>
				<tbody>
					{[...byCycle.entries()].map(([ci, pts]) => {
						const avgSys = Math.round(pts.reduce((s, p) => s + p.systemChars, 0) / pts.length)
						const avgMsg = Math.round(pts.reduce((s, p) => s + p.messageChars, 0) / pts.length)
						const sysPct = ((avgSys / (avgSys + avgMsg)) * 100).toFixed(0)
						const cross = pts.find(p => p.messageChars > p.systemChars && p.turnInPhase > 1)
						const maxMsg = Math.max(...pts.map(p => p.messageChars))
						return (
							<tr key={ci} className="border-b border-(--border)/20">
								<td className="py-1 pr-3 font-sans">{pts[0].cycleTitle}</td>
								<td className="py-1 pr-3 text-right">{fmt(avgSys)}</td>
								<td className="py-1 pr-3 text-right">{fmt(avgMsg)}</td>
								<td className="py-1 pr-3 text-right">{sysPct}%</td>
								<td className="py-1 pr-3 text-right">{cross ? `Turn ${cross.turnInPhase}` : '—'}</td>
								<td className="py-1 text-right">{fmt(maxMsg)}</td>
							</tr>
						)
					})}
				</tbody>
			</table>

			<div className="mt-4 p-3 bg-(--bg-hover) rounded-lg text-xs text-(--text-dim)">
				<strong>Implication:</strong> After the crossover, reducing system prompt size has diminishing returns.
				For late turns, message compression becomes the primary lever. System prompt optimization
				(caching, removing declarations) is most impactful in early turns where it dominates input.
			</div>
		</section>
	)
}

function TokenThresholdAnalysis({ buckets, totalBuilderCost }: { buckets: TokenBucket[]; totalBuilderCost: number }) {
	if (buckets.length === 0) return null

	const maxCount = Math.max(...buckets.map(b => b.count), 1)
	const totalTurns = buckets.reduce((s, b) => s + b.count, 0)

	const above15k = buckets.filter(b => b.min >= 15000)
	const above15kCost = above15k.reduce((s, b) => s + b.totalCost, 0)
	const above15kTurns = above15k.reduce((s, b) => s + b.count, 0)

	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-2">Token Threshold Analysis</h2>
			<p className="text-xs text-(--text-dim) mb-4">
				Distribution of builder turns by input token count. Helps identify where a compression
				threshold would have the most impact.
			</p>

			<div className="space-y-1 mb-4">
				{buckets.map(b => (
					<div key={b.range} className="flex items-center gap-3">
						<span className="text-xs font-mono w-14 text-right text-(--text-dim)">{b.range}</span>
						<div className="flex-1 h-5 relative">
							<div
								className="absolute inset-y-0 left-0 rounded-sm"
								style={{
									width: `${(b.count / maxCount) * 100}%`,
									backgroundColor: b.min >= 15000 ? '#ef4444' : b.min >= 10000 ? '#f59e0b' : '#22c55e',
									opacity: 0.5,
								}}
							/>
							<span className="relative text-[10px] font-mono leading-5 pl-2">
								{b.count} turns ({pct(b.count, totalTurns)}) — {fmtCost(b.totalCost)}
							</span>
						</div>
					</div>
				))}
			</div>

			<div className="grid grid-cols-2 gap-4 mb-4">
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Turns above 15k tokens</div>
					<div className="text-lg font-mono font-semibold text-(--warn)">{above15kTurns}</div>
					<div className="text-xs text-(--text-dim)">{pct(above15kTurns, totalTurns)} of builder turns</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Cost above 15k threshold</div>
					<div className="text-lg font-mono font-semibold text-(--warn)">{fmtCost(above15kCost)}</div>
					<div className="text-xs text-(--text-dim)">{pct(above15kCost, totalBuilderCost)} of builder cost</div>
				</div>
			</div>

			<div className="p-3 bg-(--bg-hover) rounded-lg text-xs text-(--text-dim)">
				<strong>Threshold compression</strong> — if user messages were more aggressively compressed once input
				tokens exceed 15k, the {above15kTurns} turns above that threshold ({pct(above15kCost, totalBuilderCost)} of
				builder cost) would shrink. This is the point where message content exceeds system prompt size and
				accumulation becomes the dominant cost driver.
			</div>
		</section>
	)
}

function BlockTable({ items, label }: { items: SystemPromptBreakdown[]; label: string }) {
	if (items.length === 0) return null
	const representative = items[0]
	const totalChars = representative.totalSystemChars
	const cachedChars = representative.blocks.filter(b => b.cached).reduce((s, b) => s + b.chars, 0)
	const uncachedChars = totalChars - cachedChars

	return (
		<div className="mb-4">
			<h3 className="text-sm font-medium mb-2 capitalize">{label}</h3>
			<div className="flex gap-4 text-xs text-(--text-dim) mb-2">
				<span>Total: <span className="font-mono text-(--text)">{fmt(totalChars)} chars</span> (~{fmt(totalChars / 4)} tokens)</span>
				<span>Cached: <span className="font-mono text-(--accent)">{fmt(cachedChars)} chars</span> ({pct(cachedChars, totalChars)})</span>
				<span>Uncached: <span className="font-mono text-(--error)">{fmt(uncachedChars)} chars</span> ({pct(uncachedChars, totalChars)})</span>
			</div>

			<div className="flex rounded-full overflow-hidden h-3 mb-3">
				{representative.blocks.map((b, i) => (
					<div
						key={i}
						className="relative"
						style={{
							width: `${(b.chars / totalChars) * 100}%`,
							backgroundColor: b.cached ? '#22c55e' : '#ef4444',
							opacity: 0.6,
						}}
						title={`Block ${i}: ${b.chars} chars (${b.cached ? 'cached' : 'NOT cached'})\n${b.preview}`}
					/>
				))}
			</div>

			<table className="w-full text-xs font-mono">
				<thead>
					<tr className="text-(--text-dim) border-b border-(--border)">
						<th className="text-left pb-1 pr-3">Block</th>
						<th className="text-right pb-1 pr-3">Chars</th>
						<th className="text-right pb-1 pr-3">~Tokens</th>
						<th className="text-right pb-1 pr-3">% of Total</th>
						<th className="text-center pb-1 pr-3">Cached</th>
						<th className="text-left pb-1">Preview</th>
					</tr>
				</thead>
				<tbody>
					{representative.blocks.map((b, i) => (
						<tr key={i} className="border-b border-(--border)/20">
							<td className="py-1 pr-3">{i}</td>
							<td className="py-1 pr-3 text-right">{fmt(b.chars)}</td>
							<td className="py-1 pr-3 text-right">~{fmt(b.chars / 4)}</td>
							<td className="py-1 pr-3 text-right">{pct(b.chars, totalChars)}</td>
							<td className="py-1 pr-3 text-center">
								{b.cached
									? <span className="text-(--accent)">✓</span>
									: <span className="text-(--error)">✗</span>
								}
							</td>
							<td className="py-1 text-(--text-dim) truncate max-w-xs">{b.preview.slice(0, 80)}…</td>
						</tr>
					))}
				</tbody>
			</table>

			{items.length > 1 && (
				<div className="mt-2 text-xs text-(--text-dim)">
					System prompt size across {items.length} cycles:{' '}
					{items.map((it, i) => (
						<span key={i} className="font-mono">
							{i > 0 && ' → '}
							{fmt(it.totalSystemChars)}
						</span>
					))}
					{' '}
					({items.every(it => it.totalSystemChars === items[0].totalSystemChars)
						? <span className="text-(--accent)">stable</span>
						: <span className="text-(--warn)">varying</span>
					})
				</div>
			)}
		</div>
	)
}

function SystemPromptAnalysis({ breakdowns, avgBuilderTurns, effectiveRate }: { breakdowns: SystemPromptBreakdown[]; avgBuilderTurns: number; effectiveRate: number }) {
	if (breakdowns.length === 0) return null

	const plannerBreakdowns = breakdowns.filter(b => b.phase === 'planner')
	const builderBreakdowns = breakdowns.filter(b => b.phase === 'builder')

	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-4">System Prompt Analysis</h2>

			<BlockTable items={plannerBreakdowns} label="Planner System Prompt" />
			<BlockTable items={builderBreakdowns} label="Builder System Prompt" />

			{builderBreakdowns.length > 0 && (() => {
				const b = builderBreakdowns[0]
				const uncachedBlocks = b.blocks.filter(bl => !bl.cached)
				const uncachedChars = uncachedBlocks.reduce((s, bl) => s + bl.chars, 0)
				if (uncachedChars === 0) return null

				const tokensPerTurn = Math.round(uncachedChars / 4)
				const fullPriceTotal = tokensPerTurn * avgBuilderTurns
				const cacheDiscount = 0.1
				const cacheWriteMultiplier = 1.25
				const cachedPriceTotal = Math.round(tokensPerTurn * cacheWriteMultiplier + tokensPerTurn * cacheDiscount * (avgBuilderTurns - 1))
				const savingsPerIter = ((fullPriceTotal - cachedPriceTotal) * effectiveRate) / 1_000_000

				return (
					<div className="mt-4 p-3 bg-(--bg-hover) rounded-lg text-xs">
						<div className="font-medium mb-1 text-(--warn)">Cache Opportunity</div>
						<p className="text-(--text-dim)">
							Builder has <span className="font-mono text-(--error)">{fmt(uncachedChars)} uncached chars</span> (~{fmt(tokensPerTurn)} tokens) in its system prompt.
							Over {avgBuilderTurns} builder turns at ${effectiveRate.toFixed(1)}/MTok effective rate:
						</p>
						<div className="mt-1 font-mono">
							<div>Without cache: {fmt(fullPriceTotal)} × ${effectiveRate.toFixed(1)}/MTok = <span className="text-(--error)">${((fullPriceTotal * effectiveRate) / 1_000_000).toFixed(4)}</span></div>
							<div>With cache (90% discount): <span className="text-(--accent)">${((cachedPriceTotal * effectiveRate) / 1_000_000).toFixed(4)}</span></div>
							<div>Savings per cycle: <span className="text-(--accent)">~${savingsPerIter.toFixed(4)}</span></div>
						</div>
					</div>
				)
			})()}
		</section>
	)
}

function CompressionAnalysis({ points }: { points: BuilderTurnPoint[] }) {
	if (points.length === 0) return null

	const totalToolResults = points.reduce((s, p) => s + p.toolResultCount, 0)
	const totalCompressed = points.reduce((s, p) => s + p.compressedToolResults, 0)
	const totalFull = points.reduce((s, p) => s + p.fullToolResults, 0)

	const byCycle = new Map<number, BuilderTurnPoint[]>()
	for (const p of points) {
		const arr = byCycle.get(p.cycleIndex) ?? []
		arr.push(p)
		byCycle.set(p.cycleIndex, arr)
	}

	const cycleCompressionRates = [...byCycle.entries()].map(([ci, pts]) => {
		const trTotal = pts.reduce((s, p) => s + p.toolResultCount, 0)
		const trComp = pts.reduce((s, p) => s + p.compressedToolResults, 0)
		const lateTurns = pts.filter(p => p.turnInPhase > 3)
		const lateFull = lateTurns.reduce((s, p) => s + p.fullToolResults, 0)
		return {
			cycleIndex: ci,
			title: pts[0].cycleTitle,
			total: trTotal,
			compressed: trComp,
			rate: trTotal > 0 ? trComp / trTotal : 0,
			lateFullResults: lateFull,
		}
	})

	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-2">Compression Analysis</h2>
			<p className="text-xs text-(--text-dim) mb-4">
				Tool results from previous turns are redacted to save context. This shows
				how effectively compression reduces the conversation size, and what information is lost.
			</p>

			<div className="grid grid-cols-3 gap-4 mb-4">
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Total Tool Results</div>
					<div className="text-lg font-mono font-semibold">{totalToolResults}</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Compressed</div>
					<div className="text-lg font-mono font-semibold text-(--accent)">{totalCompressed} <span className="text-sm text-(--text-dim)">({pct(totalCompressed, totalToolResults)})</span></div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Kept Full</div>
					<div className="text-lg font-mono font-semibold text-(--warn)">{totalFull} <span className="text-sm text-(--text-dim)">({pct(totalFull, totalToolResults)})</span></div>
				</div>
			</div>

			<table className="w-full text-xs font-mono">
				<thead>
					<tr className="text-(--text-dim) border-b border-(--border)">
						<th className="text-left pb-1 pr-3">Cycle</th>
						<th className="text-right pb-1 pr-3">Tool Results</th>
						<th className="text-right pb-1 pr-3">Compressed</th>
						<th className="text-right pb-1 pr-3">Rate</th>
						<th className="text-right pb-1">Late Full Results</th>
					</tr>
				</thead>
				<tbody>
					{cycleCompressionRates.map((c, i) => (
						<tr key={i} className="border-b border-(--border)/20">
							<td className="py-1 pr-3 font-sans">{c.title}</td>
							<td className="py-1 pr-3 text-right">{c.total}</td>
							<td className="py-1 pr-3 text-right">{c.compressed}</td>
							<td className="py-1 pr-3 text-right">{(c.rate * 100).toFixed(0)}%</td>
							<td className="py-1 text-right">
								{c.lateFullResults > 0
									? <span className="text-(--warn)">{c.lateFullResults}</span>
									: <span className="text-(--text-dim)">0</span>
								}
							</td>
						</tr>
					))}
				</tbody>
			</table>

			<div className="mt-4 p-3 bg-(--bg-hover) rounded-lg text-xs text-(--text-dim)">
				<strong>Late full results</strong> (turn &gt; 3 with uncompressed tool results) indicate
				the model is likely re-reading files it already read in earlier turns — turns wasted on
				re-fetching information that was redacted too aggressively.
			</div>
		</section>
	)
}

function RepeatedFileReads({ reads }: { reads: RepeatedFileRead[] }) {
	if (reads.length === 0) return null

	const totalWastedReads = reads.reduce((s, r) => s + r.readCount - 1, 0)
	const totalWastedChars = reads.reduce((s, r) => s + (r.totalChars / r.readCount) * (r.readCount - 1), 0)
	const uniqueFiles = new Set(reads.map(r => r.filePath)).size

	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-2">Repeated File Reads</h2>
			<p className="text-xs text-(--text-dim) mb-4">
				Files read more than once within a single cycle. Re-reads happen because earlier tool results
				were compressed away. Better tiered compression (keeping summaries instead of full redaction)
				would eliminate most of these.
			</p>

			<div className="grid grid-cols-3 gap-4 mb-4">
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Files Re-read</div>
					<div className="text-lg font-mono font-semibold text-(--warn)">{uniqueFiles}</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Redundant Reads</div>
					<div className="text-lg font-mono font-semibold text-(--warn)">{totalWastedReads}</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Wasted Context</div>
					<div className="text-lg font-mono font-semibold text-(--warn)">{fmt(totalWastedChars)} ch</div>
				</div>
			</div>

			<table className="w-full text-xs font-mono">
				<thead>
					<tr className="text-(--text-dim) border-b border-(--border)">
						<th className="text-left pb-1 pr-3">File</th>
						<th className="text-left pb-1 pr-3">Cycle</th>
						<th className="text-right pb-1 pr-3">Reads</th>
						<th className="text-right pb-1 pr-3">Total Chars</th>
						<th className="text-left pb-1">Turns</th>
					</tr>
				</thead>
				<tbody>
					{reads.slice(0, 20).map((r, i) => (
						<tr key={i} className="border-b border-(--border)/20">
							<td className="py-1 pr-3 font-sans text-(--warn) max-w-50 truncate">{r.filePath.split('/').pop()}</td>
							<td className="py-1 pr-3 font-sans text-(--text-dim) max-w-40 truncate">{r.cycleTitle}</td>
							<td className="py-1 pr-3 text-right">{r.readCount}</td>
							<td className="py-1 pr-3 text-right">{fmt(r.totalChars)}</td>
							<td className="py-1 text-(--text-dim)">{r.turnNumbers.length <= 8 ? r.turnNumbers.join(', ') : `${r.turnNumbers.slice(0, 5).join(', ')}… +${r.turnNumbers.length - 5}`}</td>
						</tr>
					))}
				</tbody>
			</table>

			<div className="mt-4 p-3 bg-(--bg-hover) rounded-lg text-xs text-(--text-dim)">
				Keeping a one-line summary of each tool result (file path + line count + key exports)
				instead of full redaction would prevent {totalWastedReads} redundant reads, saving
				~{fmt(totalWastedChars * 0.25)} tokens of re-fetched context.
			</div>
		</section>
	)
}

function MemoryOverhead({ details, totalCost }: { details: MemoryCallDetail[]; totalCost: number }) {
	if (details.length === 0) return null

	const totalMemoryCost = details.reduce((s, d) => s + d.cost, 0)
	const totalMemoryInput = details.reduce((s, d) => s + d.inputTokens, 0)
	const avgInputPerCall = Math.round(totalMemoryInput / details.length)
	const avgContentChars = Math.round(details.reduce((s, d) => s + d.contentChars, 0) / details.length)
	const avgSummaryChars = Math.round(details.reduce((s, d) => s + d.summaryChars, 0) / details.length)

	const shortContent = details.filter(d => d.contentChars < 200)
	const shortContentCost = shortContent.reduce((s, d) => s + d.cost, 0)

	const byCycle = new Map<number, MemoryCallDetail[]>()
	for (const d of details) {
		const arr = byCycle.get(d.cycleIndex) ?? []
		arr.push(d)
		byCycle.set(d.cycleIndex, arr)
	}

	const avgSummaryWords = Math.round(avgSummaryChars / 5)

	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-2">Memory Summarization Overhead</h2>
			<p className="text-xs text-(--text-dim) mb-4">
				Every <code className="bg-(--bg-hover) px-1 rounded">storePastMemory()</code> call
				triggers a full LLM API call to generate a ~{avgSummaryWords}-word summary.
			</p>

			<div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Total Memory Calls</div>
					<div className="text-lg font-mono font-semibold">{details.length}</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Total Memory Cost</div>
					<div className="text-lg font-mono font-semibold">{fmtCost(totalMemoryCost)}</div>
					<div className="text-xs text-(--text-dim)">{pct(totalMemoryCost, totalCost)} of total</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Avg Input/Call</div>
					<div className="text-lg font-mono font-semibold">{fmt(avgInputPerCall)} tok</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Avg Content → Summary</div>
					<div className="text-lg font-mono font-semibold">{fmt(avgContentChars)} → {fmt(avgSummaryChars)}</div>
					<div className="text-xs text-(--text-dim)">chars</div>
				</div>
			</div>

			<table className="w-full text-xs font-mono mb-4">
				<thead>
					<tr className="text-(--text-dim) border-b border-(--border)">
						<th className="text-left pb-1 pr-3">Cycle</th>
						<th className="text-right pb-1 pr-3">Calls</th>
						<th className="text-right pb-1 pr-3">Input Tok</th>
						<th className="text-right pb-1 pr-3">Cost</th>
						<th className="text-right pb-1 pr-3">Avg Content</th>
						<th className="text-right pb-1">Short (&lt;200ch)</th>
					</tr>
				</thead>
				<tbody>
					{[...byCycle.entries()].map(([ci, calls]) => {
						const short = calls.filter(c => c.contentChars < 200).length
						return (
							<tr key={ci} className="border-b border-(--border)/20">
								<td className="py-1 pr-3 font-sans">{calls[0].cycleTitle}</td>
								<td className="py-1 pr-3 text-right">{calls.length}</td>
								<td className="py-1 pr-3 text-right">{fmt(calls.reduce((s, c) => s + c.inputTokens, 0))}</td>
								<td className="py-1 pr-3 text-right">{fmtCost(calls.reduce((s, c) => s + c.cost, 0))}</td>
								<td className="py-1 pr-3 text-right">{fmt(calls.reduce((s, c) => s + c.contentChars, 0) / calls.length)} ch</td>
								<td className="py-1 text-right">
									{short > 0
										? <span className="text-(--warn)">{short}/{calls.length}</span>
										: <span className="text-(--text-dim)">0/{calls.length}</span>
									}
								</td>
							</tr>
						)
					})}
				</tbody>
			</table>

			{shortContent.length > 0 && (
				<div className="p-3 bg-(--bg-hover) rounded-lg text-xs text-(--text-dim)">
					<strong className="text-(--warn)">{shortContent.length} {shortContent.length === 1 ? 'call' : 'calls'}</strong> had content under 200 chars —
					short enough to use as-is without LLM summarization.
					Cost of these unnecessary calls: <span className="font-mono text-(--warn)">{fmtCost(shortContentCost)}</span>
				</div>
			)}
		</section>
	)
}

function SummarizerOverhead({ details, totalCost }: { details: SummarizerBatchDetail[]; totalCost: number }) {
	if (details.length === 0) return null

	const totalBatches = details.length
	const totalEntries = details.reduce((s, d) => s + d.entriesInBatch, 0)
	const totalSumCost = details.reduce((s, d) => s + d.totalCost, 0)
	const totalSumInput = details.reduce((s, d) => s + d.totalInputTokens, 0)
	const avgEntriesPerBatch = Math.round(totalEntries / totalBatches)

	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-2">Summarizer Batch Overhead</h2>
			<p className="text-xs text-(--text-dim) mb-4">
				Each summarizer batch sends N candidate tool results through the Batch API (50% cost discount) to compress conversation context.
			</p>

			<div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Total Batches</div>
					<div className="text-lg font-mono font-semibold">{totalBatches}</div>
					<div className="text-xs text-(--text-dim)">{totalEntries} entries</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Total Cost</div>
					<div className="text-lg font-mono font-semibold">{fmtCost(totalSumCost)}</div>
					<div className="text-xs text-(--text-dim)">{pct(totalSumCost, totalCost)} of total</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Avg Entries/Batch</div>
					<div className="text-lg font-mono font-semibold">{avgEntriesPerBatch}</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Total Input</div>
					<div className="text-lg font-mono font-semibold">{fmt(totalSumInput)} tok</div>
				</div>
			</div>

			<table className="w-full text-xs font-mono">
				<thead>
					<tr className="text-(--text-dim) border-b border-(--border)">
						<th className="text-left pb-1 pr-3">Cycle</th>
						<th className="text-right pb-1 pr-3">Batches</th>
						<th className="text-right pb-1 pr-3">Entries</th>
						<th className="text-right pb-1 pr-3">Input Tok</th>
						<th className="text-right pb-1">Cost</th>
					</tr>
				</thead>
				<tbody>
					{[...Map.groupBy(details, d => d.cycleIndex).entries()].map(([ci, batches]) => (
						<tr key={ci} className="border-b border-(--border)/20">
							<td className="py-1 pr-3 font-sans">{batches[0].cycleTitle}</td>
							<td className="py-1 pr-3 text-right">{batches.length}</td>
							<td className="py-1 pr-3 text-right">{batches.reduce((s, b) => s + b.entriesInBatch, 0)}</td>
							<td className="py-1 pr-3 text-right">{fmt(batches.reduce((s, b) => s + b.totalInputTokens, 0))}</td>
							<td className="py-1 text-right">{fmtCost(batches.reduce((s, b) => s + b.totalCost, 0))}</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	)
}

function ToolUsageAnalysis({ tools }: { tools: ToolUsageStat[] }) {
	if (tools.length === 0) return null

	const totalChars = tools.reduce((s, t) => s + t.totalResultChars, 0)
	const totalInvocations = tools.reduce((s, t) => s + t.invocations, 0)

	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-2">Tool Usage Breakdown</h2>
			<p className="text-xs text-(--text-dim) mb-4">
				Which tools generate the most context? Large tool results directly inflate input tokens
				on subsequent turns. Tools causing spikes (&gt;8k chars) are the primary compression targets.
			</p>

			<div className="grid grid-cols-3 gap-4 mb-4">
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Total Invocations</div>
					<div className="text-lg font-mono font-semibold">{totalInvocations}</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Total Result Chars</div>
					<div className="text-lg font-mono font-semibold">{fmt(totalChars)}</div>
				</div>
				<div className="border border-(--border) rounded-lg p-3">
					<div className="text-xs text-(--text-dim)">Avg Result Size</div>
					<div className="text-lg font-mono font-semibold">{fmt(Math.round(totalChars / Math.max(totalInvocations, 1)))} ch</div>
				</div>
			</div>

			<table className="w-full text-xs font-mono">
				<thead>
					<tr className="text-(--text-dim) border-b border-(--border)">
						<th className="text-left pb-1 pr-3">Tool</th>
						<th className="text-right pb-1 pr-3">Calls</th>
						<th className="text-right pb-1 pr-3">Total Chars</th>
						<th className="text-right pb-1 pr-3">Avg Chars</th>
						<th className="text-right pb-1 pr-3">Max Chars</th>
						<th className="text-right pb-1 pr-3">% of All</th>
						<th className="text-right pb-1">Spike Causing</th>
					</tr>
				</thead>
				<tbody>
					{tools.map(t => (
						<tr key={t.tool} className="border-b border-(--border)/20">
							<td className="py-1 pr-3 font-sans font-medium">{t.tool}</td>
							<td className="py-1 pr-3 text-right">{t.invocations}</td>
							<td className="py-1 pr-3 text-right">{fmt(t.totalResultChars)}</td>
							<td className="py-1 pr-3 text-right">{fmt(t.avgResultChars)}</td>
							<td className="py-1 pr-3 text-right">{fmt(t.maxResultChars)}</td>
							<td className="py-1 pr-3 text-right">{pct(t.totalResultChars, totalChars)}</td>
							<td className="py-1 text-right">
								{t.spikeCausing > 0
									? <span className="text-(--error)">{t.spikeCausing}</span>
									: <span className="text-(--text-dim)">0</span>}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	)
}

function BuildVsFixProductivity({ productivity }: { productivity: PhaseProductivity[] }) {
	if (productivity.length === 0) return null

	const maxCost = Math.max(...productivity.map(p => p.totalCost), 0.001)

	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-2">Build vs Fix Productivity</h2>
			<p className="text-xs text-(--text-dim) mb-4">
				Comparing cost efficiency between normal build turns and fix-phase turns.
				Higher cost-per-output-token means the model spends more reading context and less writing code.
			</p>

			<div className="space-y-3 mb-4">
				{productivity.map(p => (
					<div key={p.label}>
						<div className="flex items-baseline justify-between text-sm mb-1">
							<span className="font-medium">{p.label}</span>
							<span className="font-mono text-xs">
								{fmtCost(p.totalCost)} ({p.turns} turns)
							</span>
						</div>
						<div className="relative h-5 rounded-full overflow-hidden bg-(--bg-hover)">
							<div
								className="absolute inset-y-0 left-0 rounded-full"
								style={{
									width: `${(p.totalCost / maxCost) * 100}%`,
									backgroundColor: p.label.includes('Fix') ? '#ef4444' : '#22c55e',
									opacity: 0.6,
								}}
							/>
						</div>
					</div>
				))}
			</div>

			<table className="w-full text-xs font-mono">
				<thead>
					<tr className="text-(--text-dim) border-b border-(--border)">
						<th className="text-left pb-1 pr-3">Phase</th>
						<th className="text-right pb-1 pr-3">Turns</th>
						<th className="text-right pb-1 pr-3">Input Tok</th>
						<th className="text-right pb-1 pr-3">Output Tok</th>
						<th className="text-right pb-1 pr-3">Cost</th>
						<th className="text-right pb-1 pr-3">Avg Out/Turn</th>
						<th className="text-right pb-1">Cost/1k Out</th>
					</tr>
				</thead>
				<tbody>
					{productivity.map(p => (
						<tr key={p.label} className="border-b border-(--border)/20">
							<td className="py-1 pr-3 font-sans font-medium">{p.label}</td>
							<td className="py-1 pr-3 text-right">{p.turns}</td>
							<td className="py-1 pr-3 text-right">{fmt(p.totalInputTokens)}</td>
							<td className="py-1 pr-3 text-right">{fmt(p.totalOutputTokens)}</td>
							<td className="py-1 pr-3 text-right">{fmtCost(p.totalCost)}</td>
							<td className="py-1 pr-3 text-right">{fmt(p.avgOutputPerTurn)}</td>
							<td className="py-1 text-right">
								{p.costPerOutputToken > 0
									? <span className={p.costPerOutputToken > 0.15 ? 'text-(--error)' : 'text-(--accent)'}>${p.costPerOutputToken.toFixed(3)}</span>
									: '—'}
							</td>
						</tr>
					))}
				</tbody>
			</table>

			{productivity.length >= 2 && productivity[1].costPerOutputToken > 0 && productivity[0].costPerOutputToken > 0 && (
				<div className="mt-4 p-3 bg-(--bg-hover) rounded-lg text-xs text-(--text-dim)">
					Fix phases cost <span className="font-mono text-(--error)">
						{(productivity[1].costPerOutputToken / productivity[0].costPerOutputToken).toFixed(1)}x
					</span> more per output token than build phases. Each token of generated code during a fix phase
					is significantly more expensive due to the accumulated context and repeated diff/error messages.
				</div>
			)}
		</section>
	)
}

function CostEfficiencyCurve({ bands }: { bands: CostEfficiencyBand[] }) {
	if (bands.length === 0) return null

	const maxCostPer1k = Math.max(...bands.map(b => b.costPer1kOutput), 0.001)
	const firstBand = bands[0]
	const lastBand = bands[bands.length - 1]
	const escalation = firstBand.costPer1kOutput > 0 ? lastBand.costPer1kOutput / firstBand.costPer1kOutput : 0

	// Find the band where cost/output exceeds 2x the first band
	const diminishingPoint = bands.find(b => b.costPer1kOutput > firstBand.costPer1kOutput * 2)
	const cheapestBand = bands.reduce((a, b) => a.costPer1kOutput < b.costPer1kOutput ? a : b)

	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-2">Cost Efficiency by Turn Number</h2>
			<p className="text-xs text-(--text-dim) mb-4">
				How cost-per-output-token changes as a cycle progresses. Later turns accumulate more context,
				making each token of output progressively more expensive. The &quot;diminishing returns&quot; point
				is where cost/output exceeds 2x the initial rate.
			</p>

			<div className="space-y-2 mb-4">
				{bands.map(b => (
					<div key={b.range} className="flex items-center gap-3">
						<span className="text-xs font-mono w-12 text-right text-(--text-dim)">T{b.range}</span>
						<div className="flex-1 h-5 relative">
							<div
								className="h-full rounded-sm"
								style={{
									width: `${Math.max((b.costPer1kOutput / maxCostPer1k) * 100, 2)}%`,
									backgroundColor: b.costPer1kOutput > firstBand.costPer1kOutput * 2 ? 'var(--error)' : 'var(--accent)',
									opacity: 0.8,
								}}
							/>
						</div>
						<span className="text-xs font-mono w-20 text-right">${b.costPer1kOutput.toFixed(3)}/1k</span>
						<span className="text-xs text-(--text-dim) w-16 text-right">{b.turns} turns</span>
					</div>
				))}
			</div>

			<table className="w-full text-xs font-mono">
				<thead>
					<tr className="text-(--text-dim) border-b border-(--border)">
						<th className="text-left pb-1 pr-3">Turn Range</th>
						<th className="text-right pb-1 pr-3">Turns</th>
						<th className="text-right pb-1 pr-3">Cost</th>
						<th className="text-right pb-1 pr-3">Output Tok</th>
						<th className="text-right pb-1 pr-3">Avg Input</th>
						<th className="text-right pb-1">Cost/1k Out</th>
					</tr>
				</thead>
				<tbody>
					{bands.map(b => (
						<tr key={b.range} className="border-b border-(--border)/20">
							<td className="py-1 pr-3 font-sans">{b.range}</td>
							<td className="py-1 pr-3 text-right">{b.turns}</td>
							<td className="py-1 pr-3 text-right">{fmtCost(b.totalCost)}</td>
							<td className="py-1 pr-3 text-right">{fmt(b.totalOutput)}</td>
							<td className="py-1 pr-3 text-right">{fmt(b.avgInputTokens)}</td>
							<td className="py-1 text-right">
								<span className={b.costPer1kOutput > firstBand.costPer1kOutput * 2 ? 'text-(--error)' : 'text-(--accent)'}>
									${b.costPer1kOutput.toFixed(3)}
								</span>
							</td>
						</tr>
					))}
				</tbody>
			</table>

			<div className="mt-4 p-3 bg-(--bg-hover) rounded-lg text-xs text-(--text-dim)">
				{escalation > 1 && (
					<>Cost per output token escalates <span className="font-mono text-(--error)">{escalation.toFixed(1)}x</span> from
					early turns (T{firstBand.range}) to late turns (T{lastBand.range}).{' '}</>
				)}
				{cheapestBand !== firstBand && (
					<>The most efficient range is <span className="font-mono text-(--accent)">T{cheapestBand.range}</span> (${cheapestBand.costPer1kOutput.toFixed(3)}/1k)
					&mdash; the model hits peak productivity after initial setup reads.{' '}</>
				)}
				{diminishingPoint ? (
					<>The diminishing returns threshold (2x initial cost) is reached at turns <span className="font-mono text-(--warn)">{diminishingPoint.range}</span>.
					This jump coincides with fix-phase restarts, which inject large uncached diffs.</>
				) : (
					<>No turn range exceeds 2x the initial cost/output rate &mdash; these cycles are relatively efficient.</>
				)}
			</div>
		</section>
	)
}

function OptimizationOpportunities({ stats }: { stats: Statistics }) {
	const builderPhase = stats.phaseStats.find(p => p.phase === 'builder')
	const memoryPhase = stats.phaseStats.find(p => p.phase === 'memory')

	const builderBreakdown = stats.systemPromptBreakdowns.find(b => b.phase === 'builder')
	const uncachedBuilderChars = builderBreakdown
		? builderBreakdown.blocks.filter(b => !b.cached).reduce((s, b) => s + b.chars, 0)
		: 0
	const uncachedBuilderTokens = Math.round(uncachedBuilderChars / 4)

	const avgBuilderTurns = builderPhase
		? Math.round(builderPhase.calls / Math.max(stats.cycleCount, 1))
		: 10

	const shortMemoryCalls = stats.memoryCallDetails.filter(d => d.contentChars < 200).length
	const shortMemoryCost = stats.memoryCallDetails.filter(d => d.contentChars < 200).reduce((s, d) => s + d.cost, 0)

	const totalLateFullResults = stats.builderTurnPoints
		.filter(p => p.turnInPhase > 3)
		.reduce((s, p) => s + p.fullToolResults, 0)

	const fixSegments = stats.fixPhaseSegments
	const totalFixCost = fixSegments.reduce((s, seg) => s + seg.totalCost, 0)
	const totalFixTurns = fixSegments.reduce((s, seg) => s + seg.turnCount, 0)
	const avgFixFirstMsgTokens = fixSegments.length > 0
		? Math.round(fixSegments.reduce((s, seg) => s + seg.firstMsgChars / 4, 0) / fixSegments.length)
		: 0

	const byCycleSpikes = (() => {
		const byCycle = new Map<number, BuilderTurnPoint[]>()
		for (const p of stats.builderTurnPoints) {
			const arr = byCycle.get(p.cycleIndex) ?? []
			arr.push(p)
			byCycle.set(p.cycleIndex, arr)
		}
		let totalDelta = 0
		for (const [, pts] of byCycle) {
			for (let i = 1; i < pts.length; i++) {
				const d = pts[i].inputTokens - pts[i - 1].inputTokens
				if (d > 2000) totalDelta += d
			}
		}
		return totalDelta
	})()

	const above15k = stats.tokenBuckets.filter(b => b.min >= 15000)
	const above15kCost = above15k.reduce((s, b) => s + b.totalCost, 0)
	const above15kTurns = above15k.reduce((s, b) => s + b.count, 0)

	const rate = stats.effectiveInputRate

	const cacheSavings = (uncachedBuilderTokens * avgBuilderTurns * rate * 0.9) / 1_000_000
	const privateDeclSavings = (uncachedBuilderTokens * 0.5 * avgBuilderTurns * rate) / 1_000_000
	const fixCacheSavings = (avgFixFirstMsgTokens * totalFixTurns * 0.9 * rate) / 1_000_000 / Math.max(stats.cycleCount, 1)
	const spikesSavings = (byCycleSpikes * rate) / 1_000_000 / Math.max(stats.cycleCount, 1)

	const totalWastedReReadChars = stats.repeatedFileReads.reduce((s, r) => s + (r.totalChars / r.readCount) * (r.readCount - 1), 0)
	const totalWastedReReads = stats.repeatedFileReads.reduce((s, r) => s + r.readCount - 1, 0)
	const lateFullTokenEstimate = totalLateFullResults > 0
		? Math.round(stats.builderTurnPoints.filter(p => p.turnInPhase > 3).reduce((s, p) => s + p.fullToolResults * (p.largestToolResultChars || 500), 0) / 4)
		: 0
	const tieredCompressionSavings = lateFullTokenEstimate > 0 ? (lateFullTokenEstimate * rate) / 1_000_000 : 0

	const depGraphBlock = builderBreakdown?.blocks.find(b =>
		b.preview.toLowerCase().includes('depend') || b.preview.toLowerCase().includes('import graph')
	)
	const depGraphTokens = depGraphBlock ? Math.round(depGraphBlock.chars / 4) : 0

	const memoryModelName = stats.modelsByPhase['memory'] ?? 'unknown'
	const avgSummaryWords = stats.memoryCallDetails.length > 0
		? Math.round(stats.memoryCallDetails.reduce((s, d) => s + d.summaryChars, 0) / stats.memoryCallDetails.length / 5)
		: 0

	const crossoverTurn = (() => {
		for (const p of stats.builderTurnPoints) {
			if (p.messageChars > p.systemChars && p.turnInPhase > 1) return p.turnInPhase
		}
		return null
	})()

	const opportunities = [
		{
			title: 'Cache builder system prompt',
			savings: uncachedBuilderTokens > 0
				? `~${fmtCost(cacheSavings)}/cycle`
				: 'Already cached \u2713',
			dollarSavings: uncachedBuilderTokens > 0 ? cacheSavings : 0,
			impact: uncachedBuilderTokens > 0 ? 'HIGH' : 'N/A',
			description: `${fmt(uncachedBuilderTokens)} uncached tokens \u00d7 ${avgBuilderTurns} builder turns/cycle = ${fmt(uncachedBuilderTokens * avgBuilderTurns)} wasted tokens per cycle at full price instead of 90% cache discount.`,
			applicable: uncachedBuilderTokens > 0,
		},
		{
			title: 'Reduce uncached system prompt content',
			savings: `~${fmtCost(privateDeclSavings)}/cycle`,
			dollarSavings: privateDeclSavings,
			impact: uncachedBuilderTokens > 0 ? 'HIGH' : 'N/A',
			description: `Uncached system blocks contain ${fmt(uncachedBuilderTokens)} tokens. Reducing this content by ~50% (e.g. filtering internal declarations, abbreviating) would save ${fmt(uncachedBuilderTokens * 0.5)} tokens/turn.`,
			applicable: uncachedBuilderTokens > 0,
		},
		{
			title: 'Remove dependency graph from system prompt',
			savings: depGraphTokens > 0 ? `~${fmt(depGraphTokens)} tok/turn` : 'N/A',
			dollarSavings: depGraphTokens > 0 ? (depGraphTokens * avgBuilderTurns * rate) / 1_000_000 : 0,
			impact: depGraphTokens > 0 ? 'MEDIUM' : 'N/A',
			description: depGraphTokens > 0
				? `Dependency graph block is ${fmt(depGraphTokens)} tokens (${pct(depGraphBlock!.chars, builderBreakdown!.totalSystemChars)} of system prompt). Models can deduce dependencies from imports.`
				: 'No dependency graph block detected in system prompt.',
			applicable: depGraphTokens > 0,
		},
		{
			title: 'Use cheaper model for memory summarization',
			savings: memoryPhase ? `~${fmtCost(memoryPhase.cost * 0.67 / Math.max(stats.cycleCount, 1))}/cycle` : 'N/A',
			dollarSavings: memoryPhase ? (memoryPhase.cost * 0.67 / Math.max(stats.cycleCount, 1)) : 0,
			impact: 'LOW',
			description: `Memory phase generates ~${avgSummaryWords}-word summaries using ${memoryModelName}. A cheaper model handles short summarization identically.${memoryPhase ? ` Currently ${memoryPhase.calls} calls costing ${fmtCost(memoryPhase.cost)}.` : ''}`,
			applicable: !!memoryPhase,
		},
		{
			title: 'Skip summarization for short memories',
			savings: shortMemoryCalls > 0 ? `~${fmtCost(shortMemoryCost / Math.max(stats.cycleCount, 1))}/cycle` : 'N/A',
			dollarSavings: shortMemoryCalls > 0 ? shortMemoryCost / Math.max(stats.cycleCount, 1) : 0,
			impact: 'LOW',
			description: `${shortMemoryCalls} memory ${shortMemoryCalls === 1 ? 'call' : 'calls'} had content <200 chars \u2014 already short enough to use verbatim as the summary.`,
			applicable: shortMemoryCalls > 0,
		},
		{
			title: 'Tiered compression instead of binary redaction',
			savings: totalLateFullResults > 0 ? `~${fmt(lateFullTokenEstimate)} tok/cycle` : 'N/A',
			dollarSavings: tieredCompressionSavings,
			impact: totalLateFullResults > 0 ? 'MEDIUM-HIGH' : 'N/A',
			description: `${totalLateFullResults} full tool results in late turns (>3) suggest re-reads. ${totalWastedReReads > 0 ? `${totalWastedReReads} redundant file reads totaling ~${fmt(totalWastedReReadChars)} wasted chars. ` : ''}A tiered summarization approach would preserve key information while still reducing context.`,
			applicable: totalLateFullResults > 0,
		},
		{
			title: 'Cache fixPatch message + abbreviate diff',
			savings: fixSegments.length > 0
				? `~${fmtCost(fixCacheSavings)}/cycle`
				: 'N/A',
			dollarSavings: fixSegments.length > 0 ? fixCacheSavings : 0,
			impact: fixSegments.length > 0 ? 'HIGH' : 'N/A',
			description: `${fixSegments.length} fix phases detected with ${totalFixTurns} turns costing ${fmtCost(totalFixCost)}. The full git diff (~${fmt(avgFixFirstMsgTokens)} tokens) is sent uncached every fix turn. Caching it and abbreviating file creations would save most of this.`,
			applicable: fixSegments.length > 0,
		},
		{
			title: 'Immediate compression of large tool results',
			savings: byCycleSpikes > 0 ? `~${fmt(byCycleSpikes / Math.max(stats.cycleCount, 1))} tok/cycle` : 'N/A',
			dollarSavings: spikesSavings,
			impact: byCycleSpikes > 5000 ? 'MEDIUM-HIGH' : 'MEDIUM',
			description: `Current tool results are only compressed on the next turn. ${fmt(byCycleSpikes)} spike tokens from large responses (>2k token jumps) could be eliminated by summarizing results above a size threshold immediately.`,
			applicable: byCycleSpikes > 0,
		},
		{
			title: 'Token threshold compression at 15k',
			savings: above15kTurns > 0 ? `${above15kTurns} turns (${pct(above15kCost, builderPhase?.cost ?? 1)} of builder cost)` : 'N/A',
			dollarSavings: above15kCost * 0.3 / Math.max(stats.cycleCount, 1),
			impact: above15kTurns > 0 ? 'MEDIUM' : 'N/A',
			description: `${above15kTurns} builder turns exceed 15k input tokens, costing ${fmtCost(above15kCost)}.${crossoverTurn ? ` After the system/user crossover (~turn ${crossoverTurn}), messages dominate input.` : ''} Aggressive compression above 15k would cap costs.`,
			applicable: above15kTurns > 0,
		},
	]

	const sorted = [...opportunities].sort((a, b) => {
		const order = { 'HIGH': 0, 'MEDIUM-HIGH': 1, 'MEDIUM': 2, 'LOW': 3, 'N/A': 4 }
		return (order[a.impact as keyof typeof order] ?? 4) - (order[b.impact as keyof typeof order] ?? 4)
	})

	return (
		<section className="border border-(--border) rounded-lg p-5">
			<h2 className="text-lg font-semibold mb-4">Optimization Opportunities</h2>

			<div className="space-y-3">
				{sorted.filter(o => o.applicable).map((o, i) => (
					<div key={i} className="border border-(--border) rounded-lg p-4">
						<div className="flex items-center justify-between mb-1">
							<h3 className="font-medium text-sm">{o.title}</h3>
							<div className="flex gap-3 text-xs">
								<span className={`px-2 py-0.5 rounded-full font-medium ${
									o.impact === 'HIGH' ? 'bg-green-500/20 text-green-400'
									: o.impact === 'MEDIUM-HIGH' ? 'bg-yellow-500/20 text-yellow-400'
									: o.impact === 'MEDIUM' ? 'bg-blue-500/20 text-blue-400'
									: 'bg-gray-500/20 text-gray-400'
								}`}>
									{o.impact}
								</span>
							</div>
						</div>
						<p className="text-xs text-(--text-dim) mb-2">{o.description}</p>
						<div className="text-xs font-mono text-(--accent)">
							Estimated savings: {o.savings}
						</div>
					</div>
				))}
			</div>

			{/* Cost projection waterfall */}
			{(() => {
				const savingsEstimates = sorted.filter(o => o.applicable && o.dollarSavings > 0)
				if (savingsEstimates.length === 0) return null
				const runningCosts: number[] = []
				let rc = stats.avgCostPerCycle
				for (const o of savingsEstimates) {
					rc = Math.max(0, rc - o.dollarSavings)
					runningCosts.push(rc)
				}
				const finalCost = runningCosts[runningCosts.length - 1] ?? stats.avgCostPerCycle
				const totalTheoreticalSavings = savingsEstimates.reduce((s, o) => s + o.dollarSavings, 0)
				const theoreticalReduction = stats.avgCostPerCycle > 0 ? (totalTheoreticalSavings / stats.avgCostPerCycle) * 100 : 0
				const realisticLow = Math.round(Math.min(theoreticalReduction * 0.45, 90))
				const realisticHigh = Math.round(Math.min(theoreticalReduction * 0.6, 95))
				return (
					<div className="mt-6 border border-(--border) rounded-lg p-4">
						<h3 className="font-medium text-sm mb-3">Projected Cost After Optimizations</h3>
						<div className="space-y-1 text-xs font-mono">
							<div className="flex justify-between py-1 border-b border-(--border)">
								<span className="text-(--text-dim)">Current avg cost/cycle</span>
								<span className="text-(--error)">{fmtCost(stats.avgCostPerCycle)}</span>
							</div>
							{savingsEstimates.map((o, i) => (
								<div key={i} className="flex justify-between py-1 border-b border-(--border)/30">
									<span className="text-(--text-dim)">&minus; {o.title}</span>
									<span className="text-(--accent)">&minus;{fmtCost(o.dollarSavings)} &rarr; {fmtCost(runningCosts[i])}</span>
								</div>
							))}
							<div className="flex justify-between py-2 font-semibold text-sm">
								<span>Projected cost/cycle</span>
								<span className="text-(--accent)">{fmtCost(finalCost)}</span>
							</div>
							<div className="text-(--text-dim) font-sans">
								Total reduction: <span className="font-mono text-(--accent)">{pct(stats.avgCostPerCycle - finalCost, stats.avgCostPerCycle)}</span> (
								<span className="font-mono">{fmtCost(stats.avgCostPerCycle - finalCost)}/cycle</span>)
							</div>
							{theoreticalReduction > 30 && (
								<div className="text-(--warn) font-sans mt-2 text-[10px]">
									Note: Savings overlap &mdash; caching and compression address some of the same tokens.
									Conservative estimate: <span className="font-mono">{realisticLow}-{realisticHigh}%</span> reduction is realistic.
								</div>
							)}
						</div>
					</div>
				)
			})()}
		</section>
	)
}
