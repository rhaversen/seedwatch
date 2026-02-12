import { getStatistics } from '@/lib/data'
import type { Statistics, BuilderTurnPoint } from '@/lib/data'

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

function mdTable(headers: string[], rows: string[][]): string {
	const sep = headers.map(() => '---')
	const lines = [
		`| ${headers.join(' | ')} |`,
		`| ${sep.join(' | ')} |`,
		...rows.map(r => `| ${r.join(' | ')} |`),
	]
	return lines.join('\n')
}

function generateMarkdown(stats: Statistics): string {
	const lines: string[] = []
	const push = (...s: string[]) => lines.push(...s)
	const blank = () => lines.push('')

	push(`# Token Usage Statistics`)
	push(`_Generated ${new Date().toISOString()}_`)
	blank()

	generateExecutiveSummary(stats, push, blank)
	generateToplineStats(stats, push, blank)
	generatePhaseBreakdown(stats, push, blank)
	generateCycleComparison(stats, push, blank)
	generateCycleScorecard(stats, push, blank)
	generateBuilderEscalation(stats, push, blank)
	generateFixPhaseAnalysis(stats, push, blank)
	generateInputTokenSpikes(stats, push, blank)
	generateSystemUserSplit(stats, push, blank)
	generateTokenThresholdAnalysis(stats, push, blank)
	generateSystemPromptAnalysis(stats, push, blank)
	generateCompressionAnalysis(stats, push, blank)
	generateRepeatedFileReads(stats, push, blank)
	generateToolUsageAnalysis(stats, push, blank)
	generateBuildVsFixProductivity(stats, push, blank)
	generateCostEfficiencyCurve(stats, push, blank)
	generateMemoryOverhead(stats, push, blank)
	generateOptimizationOpportunities(stats, push, blank)

	return lines.join('\n')
}

function generateExecutiveSummary(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
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

	const findings: { label: string; detail: string }[] = []

	if (fixProd && fixCostPct > 0) {
		findings.push({
			label: 'Fix phases dominate cost',
			detail: `${fixCostPct.toFixed(0)}% of total spend is in fix phases${fixCostMultiplier > 0 ? `, costing ${fixCostMultiplier.toFixed(1)}x more per output token than build phases` : ''}.`,
		})
	}
	if (uncachedTokens > 0) {
		findings.push({
			label: 'Uncached system prompt',
			detail: `${fmt(uncachedTokens)} tokens of builder system prompt are sent uncached every turn. Caching saves ~${fmtCost(cacheSavingsPerCycle)}/cycle.`,
		})
	}
	if (totalReReads > 0) {
		findings.push({
			label: 'Aggressive compression causes re-reads',
			detail: `${totalReReads} redundant file reads across cycles because earlier results were fully redacted instead of summarized.`,
		})
	}

	if (findings.length === 0) return

	push(`## Key Findings`)
	blank()
	findings.forEach((f, i) => {
		push(`${i + 1}. **${f.label}** — ${f.detail}`)
	})
	blank()
}

function generateToplineStats(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	push(`## Topline Stats`)
	blank()
	push(mdTable(
		['Metric', 'Value'],
		[
			['Total Cost', fmtCost(stats.totalCost)],
			['Total API Calls', String(stats.totalCalls)],
			['Avg Cost / Cycle', fmtCost(stats.avgCostPerCycle)],
			['Cycles Analyzed', String(stats.cycleCount)],
			['Total Input Tokens', fmt(stats.totalInputTokens)],
			['Total Output Tokens', fmt(stats.totalOutputTokens)],
			['Avg Input / Cycle', fmt(stats.avgInputTokensPerCycle)],
			['Input/Output Ratio', `${(stats.totalInputTokens / Math.max(stats.totalOutputTokens, 1)).toFixed(1)}x`],
			['Cost / Output Token', `$${(stats.totalCost / Math.max(stats.totalOutputTokens, 1) * 1000).toFixed(2)}/1k`],
		],
	))
	blank()
}

function generatePhaseBreakdown(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	push(`## Phase Breakdown`)
	blank()
	push(mdTable(
		['Phase', 'Calls', 'Input Tokens', 'Output Tokens', 'Cost', '% of Cost', 'Avg Input/Call', 'Avg Cost/Call'],
		stats.phaseStats.map(p => [
			p.phase,
			String(p.calls),
			fmt(p.inputTokens),
			fmt(p.outputTokens),
			fmtCost(p.cost),
			pct(p.cost, stats.totalCost),
			fmt(p.avgInputTokens),
			fmtCost(p.avgCost),
		]),
	))
	blank()
}

function generateCycleComparison(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	push(`## Per-Cycle Comparison`)
	blank()
	push(mdTable(
		['#', 'Title', 'Cost', 'Calls', 'Input Tokens', 'Builder Turns', 'Planner Turns', 'Memory Calls'],
		stats.cycleOverviews.map(c => [
			String(c.index + 1),
			c.title,
			fmtCost(c.totalCost),
			String(c.totalCalls),
			fmt(c.totalInputTokens),
			String(c.builderTurns),
			String(c.plannerTurns),
			String(c.memoryTurns),
		]),
	))
	blank()
}

function generateCycleScorecard(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	const rows = stats.cycleOverviews.map(c => {
		const fixSegs = stats.fixPhaseSegments.filter(f => f.cycleIndex === c.index)
		const fixTurns = fixSegs.reduce((s, f) => s + f.turnCount, 0)
		const fixCost = fixSegs.reduce((s, f) => s + f.totalCost, 0)
		const reReads = stats.repeatedFileReads.filter(r => r.cycleIndex === c.index)
		const reReadCount = reReads.reduce((s, r) => s + r.readCount - 1, 0)
		const costPerOutput = c.totalOutputTokens > 0 ? (c.totalCost / c.totalOutputTokens) * 1000 : 0
		const fixPct = c.totalCost > 0 ? (fixCost / c.totalCost) * 100 : 0
		return { title: c.title, turns: c.builderTurns, fixPhases: fixSegs.length, fixTurns, fixPct, reReads: reReadCount, costPerOutput, totalCost: c.totalCost }
	})

	push(`## Cycle Efficiency Scorecard`)
	blank()
	push(`Consolidated view of efficiency metrics per cycle. Cycles with high fix %, many re-reads, or high cost/output are the least efficient.`)
	blank()
	push(mdTable(
		['Cycle', 'Turns', 'Fix Phases', 'Fix Cost %', 'Re-reads', 'Cost/1k Out', 'Total Cost'],
		rows.map(r => [
			r.title, String(r.turns), String(r.fixPhases), `${r.fixPct.toFixed(0)}%`,
			String(r.reReads), `$${r.costPerOutput.toFixed(3)}`, fmtCost(r.totalCost),
		]),
	))
	blank()

	if (rows.length > 0) {
		const worst = rows.reduce((a, b) => a.costPerOutput > b.costPerOutput ? a : b)
		const best = rows.reduce((a, b) => a.costPerOutput < b.costPerOutput ? a : b)
		push(`**Least efficient:** ${worst.title} (${worst.fixPhases} fix phases, $${worst.costPerOutput.toFixed(3)}/1k output). **Most efficient:** ${best.title} ($${best.costPerOutput.toFixed(3)}/1k output).`)
		const over50 = rows.filter(r => r.fixPct > 50)
		if (over50.length > 0) {
			push(`${over50.length} of ${rows.length} cycles spent >50% of cost in fix phases — reducing initial build errors would have the largest impact.`)
		}
		blank()
	}
}

function generateBuilderEscalation(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	const points = stats.builderTurnPoints
	if (points.length === 0) return

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
			rate, startTokens: first, endTokens: last, turns: cyclePts.length,
			medianInput,
			totalCost: cyclePts.reduce((s, p) => s + p.cost, 0),
			avgOutput: Math.round(cyclePts.reduce((s, p) => s + p.outputTokens, 0) / cyclePts.length),
		})
	}

	const overallAvgGrowth = avgGrowthRates.length > 0
		? avgGrowthRates.reduce((s, r) => s + r.rate, 0) / avgGrowthRates.length : 0
	const totalOutTok = points.reduce((s, p) => s + p.outputTokens, 0)
	const avgOutputPerTurn = Math.round(totalOutTok / Math.max(points.length, 1))
	const lowOutputTurns = points.filter(p => p.outputTokens < 100)

	push(`## Builder Turn Escalation`)
	blank()
	push(`How input tokens grow with each successive builder turn within a cycle. Higher growth = more tokens wasted on conversation history accumulation.`)
	blank()
	push(mdTable(
		['Metric', 'Value'],
		[
			['Avg Growth/Turn', `+${fmt(overallAvgGrowth)} tok`],
			['Max Builder Input', `${fmt(maxInput)} tok`],
			['Max Builder Turns', String(maxTurn)],
			['Avg Output/Turn', `${fmt(avgOutputPerTurn)} tok`],
		],
	))
	blank()

	if (avgGrowthRates.length > 0) {
		push(`### Per-Cycle Growth`)
		blank()
		push(mdTable(
			['Cycle', 'Turns', 'Start', 'End', 'Median', 'Growth/Turn', 'Avg Out', 'Cost'],
			avgGrowthRates.map(r => [
				r.cycle, String(r.turns), fmt(r.startTokens), fmt(r.endTokens),
				fmt(r.medianInput), `+${fmt(r.rate)}`, fmt(r.avgOutput), fmtCost(r.totalCost),
			]),
		))
		blank()
	}

	for (const [ci, cyclePts] of byCycle) {
		const maxPt = cyclePts.reduce((a, b) => a.inputTokens > b.inputTokens ? a : b)
		const fixStarts = cyclePts.filter(p => p.isFixPhaseStart)
		const keyIndices = new Set([0, cyclePts.indexOf(maxPt), cyclePts.length - 1, ...fixStarts.map(f => cyclePts.indexOf(f))])
		if (cyclePts.length > 6 && keyIndices.size < 4) keyIndices.add(Math.floor(cyclePts.length / 2))
		const keyTurns = [...keyIndices].sort((a, b) => a - b).map(i => ({ ...cyclePts[i], idx: i }))

		push(`### #${ci + 1} ${cyclePts[0].cycleTitle}`)
		push(`_${cyclePts.length} turns, showing ${keyTurns.length} key points_`)
		blank()
		push(mdTable(
			['Turn', 'Why', 'Input', 'Output', 'Cost', 'Msgs', 'Compressed'],
			keyTurns.map(p => {
				const label = p.idx === 0 ? 'start' : p.isFixPhaseStart ? '⚠ fix' : cyclePts.indexOf(maxPt) === p.idx ? '⬆ peak' : p.idx === cyclePts.length - 1 ? 'final' : 'mid'
				return [
					String(p.turnInPhase), label, fmt(p.inputTokens), fmt(p.outputTokens),
					fmtCost(p.cost), `${p.userMsgCount}u/${p.assistantMsgCount}a`,
					`${p.compressedToolResults}/${p.toolResultCount}`,
				]
			}),
		))
		blank()
	}

	push(`### Output Productivity`)
	blank()
	push(`- Low-output turns (<100 tok): ${lowOutputTurns.length}/${points.length} (${pct(lowOutputTurns.length, points.length)})`)
	push(`- Cost of low-output turns: ${fmtCost(lowOutputTurns.reduce((s, p) => s + p.cost, 0))}`)
	push(`- Input/Output ratio: ${(points.reduce((s, p) => s + p.inputTokens, 0) / Math.max(totalOutTok, 1)).toFixed(1)}x`)
	blank()
}

function generateFixPhaseAnalysis(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	const segments = stats.fixPhaseSegments
	const points = stats.builderTurnPoints
	const effectiveRate = stats.effectiveInputRate

	push(`## Fix Phase Analysis`)
	blank()

	if (segments.length === 0) {
		push(`No fix phases detected — all cycles completed without CI failures.`)
		blank()
		return
	}

	push(`When CI fails, \`fixPatch()\` resets the conversation and injects the full git diff + error output as a new first message. This diff is uncached and re-sent every turn of the fix phase.`)
	blank()

	const totalFixCost = segments.reduce((s, seg) => s + seg.totalCost, 0)
	const totalFixTurns = segments.reduce((s, seg) => s + seg.turnCount, 0)
	const avgFirstMsgChars = Math.round(segments.reduce((s, seg) => s + seg.firstMsgChars, 0) / segments.length)
	const fixStartPoints = points.filter(p => p.isFixPhaseStart)
	const avgFixStartTokens = fixStartPoints.length > 0
		? Math.round(fixStartPoints.reduce((s, p) => s + p.inputTokens, 0) / fixStartPoints.length) : 0

	push(mdTable(
		['Metric', 'Value'],
		[
			['Fix Phases', String(segments.length)],
			['Total Fix Cost', `${fmtCost(totalFixCost)} (${pct(totalFixCost, stats.totalCost)} of total)`],
			['Fix Turns', `${totalFixTurns} (${pct(totalFixTurns, points.length)} of builder turns)`],
			['Avg First Msg Size', `${fmt(avgFirstMsgChars)} ch (~${fmt(avgFirstMsgChars / 4)} tokens)`],
		],
	))
	blank()

	push(mdTable(
		['Cycle', 'Starts at Turn', 'Fix Turns', '1st Msg Chars', '~Tokens (uncached)', 'Cost', 'Input Tokens'],
		segments.map(seg => [
			seg.cycleTitle, String(seg.startTurn), String(seg.turnCount),
			fmt(seg.firstMsgChars), fmt(seg.firstMsgChars / 4),
			fmtCost(seg.totalCost), fmt(seg.totalInputTokens),
		]),
	))
	blank()

	push(`> **Optimization: Cache fix message + abbreviate diff** — The fix message averages ${fmt(avgFirstMsgChars)} chars (~${fmt(avgFirstMsgChars / 4)} tokens), re-sent uncached across ${totalFixTurns} fix turns. Adding \`cache_control\` to the first user message and abbreviating file creations to filenames-only would save ~${fmt(avgFixStartTokens * totalFixTurns * 0.9)} tokens at 90% cache discount = ~${fmtCost((avgFixStartTokens * totalFixTurns * 0.9 * effectiveRate) / 1_000_000)}/cycle.`)
	blank()
}

function generateInputTokenSpikes(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	const points = stats.builderTurnPoints
	const effectiveRate = stats.effectiveInputRate
	if (points.length < 2) return

	const byCycle = new Map<number, BuilderTurnPoint[]>()
	for (const p of points) {
		const arr = byCycle.get(p.cycleIndex) ?? []
		arr.push(p)
		byCycle.set(p.cycleIndex, arr)
	}

	type Spike = BuilderTurnPoint & { delta: number; prevTokens: number; spikeType: string }
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

	push(`## Input Token Spikes`)
	blank()
	push(`Turns where input tokens jumped by >2k compared to the previous turn.`)
	blank()
	push(mdTable(
		['Metric', 'Value'],
		[
			['Spikes (>2k jump)', String(spikes.length)],
			['Fix Restart Spikes', String(fixRestartSpikes.length)],
			['Context Growth Spikes', String(spikes.length - fixRestartSpikes.length)],
			['Spike Cost (est.)', fmtCost(totalSpikeCost)],
		],
	))
	blank()

	push(mdTable(
		['Cycle', 'Turn', 'Prev Tokens', 'This Turn', 'Δ Tokens', 'Type', 'Largest Result', 'Tool'],
		top15.map(sp => [
			sp.cycleTitle, `${sp.turnInPhase}${sp.isFixPhaseStart ? ' ⚠' : ''}`,
			fmt(sp.prevTokens), fmt(sp.inputTokens), `+${fmt(sp.delta)}`,
			sp.spikeType === 'fix-restart' ? '⚠ fix reset' : sp.spikeType === 'tool-result' ? 'tool result' : 'other',
			sp.largestToolResultChars > 0 ? `${fmt(sp.largestToolResultChars)} ch` : '—',
			sp.largestToolResultName,
		]),
	))
	blank()

	if (spikes.length > 15) push(`_Showing top 15 of ${spikes.length} spikes._`)
	push(`> **Immediate compression** — if the current turn's tool results were summarized before sending the next request, these spikes would be eliminated. Estimated savings: ${fmt(Math.round(spikes.reduce((s, sp) => s + sp.delta, 0) / Math.max([...new Set(spikes.map(sp => sp.cycleIndex))].length, 1)))} tokens/cycle.`)
	blank()
}

function generateSystemUserSplit(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	const points = stats.builderTurnPoints
	if (points.length === 0) return

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
		if (pts.length === 0) return 'N/A'
		const totalSys = pts.reduce((s, p) => s + p.systemChars, 0)
		const totalMsg = pts.reduce((s, p) => s + p.messageChars, 0)
		const total = totalSys + totalMsg
		return total > 0 ? `${Math.round((totalSys / total) * 100)}/${Math.round((totalMsg / total) * 100)}` : 'N/A'
	}

	const crossoverTurn = (() => {
		for (const [, pts] of byCycle) {
			for (const p of pts) {
				if (p.messageChars > p.systemChars && p.turnInPhase > 1) return p.turnInPhase
			}
		}
		return null
	})()

	push(`## System vs User Content Split`)
	blank()
	push(`How the balance between system prompt and conversation messages shifts over a cycle.`)
	blank()
	push(mdTable(
		['Phase', 'Sys/Msg Ratio'],
		[
			['Early (turns 1-3)', avgRatio(earlyTurns)],
			['Mid (turns 4-10)', avgRatio(midTurns)],
			['Late (turns 11+)', avgRatio(lateTurns)],
		],
	))
	blank()

	if (crossoverTurn) {
		push(`Message content surpasses system prompt at **turn ${crossoverTurn}**. After this point, conversation history dominates input tokens.`)
		blank()
	}

	push(mdTable(
		['Cycle', 'Avg Sys Chars', 'Avg Msg Chars', 'Sys %', 'Crossover Turn', 'Max Msg Chars'],
		[...byCycle.entries()].map(([, pts]) => {
			const avgSys = Math.round(pts.reduce((s, p) => s + p.systemChars, 0) / pts.length)
			const avgMsg = Math.round(pts.reduce((s, p) => s + p.messageChars, 0) / pts.length)
			const sysPct = ((avgSys / (avgSys + avgMsg)) * 100).toFixed(0)
			const cross = pts.find(p => p.messageChars > p.systemChars && p.turnInPhase > 1)
			const maxMsg = Math.max(...pts.map(p => p.messageChars))
			return [pts[0].cycleTitle, fmt(avgSys), fmt(avgMsg), `${sysPct}%`, cross ? `Turn ${cross.turnInPhase}` : '—', fmt(maxMsg)]
		}),
	))
	blank()
	push(`> **Implication:** After the crossover, reducing system prompt size has diminishing returns. For late turns, message compression becomes the primary lever.`)
	blank()
}

function generateTokenThresholdAnalysis(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	const buckets = stats.tokenBuckets
	const builderCost = stats.phaseStats.find(p => p.phase === 'builder')?.cost ?? 0
	if (buckets.length === 0) return

	const totalTurns = buckets.reduce((s, b) => s + b.count, 0)
	const above15k = buckets.filter(b => b.min >= 15000)
	const above15kCost = above15k.reduce((s, b) => s + b.totalCost, 0)
	const above15kTurns = above15k.reduce((s, b) => s + b.count, 0)

	push(`## Token Threshold Analysis`)
	blank()
	push(`Distribution of builder turns by input token count.`)
	blank()

	push(mdTable(
		['Range', 'Turns', '% of Turns', 'Cost'],
		buckets.map(b => [
			b.range, String(b.count), pct(b.count, totalTurns), fmtCost(b.totalCost),
		]),
	))
	blank()

	push(mdTable(
		['Metric', 'Value'],
		[
			['Turns above 15k tokens', `${above15kTurns} (${pct(above15kTurns, totalTurns)} of builder turns)`],
			['Cost above 15k threshold', `${fmtCost(above15kCost)} (${pct(above15kCost, builderCost)} of builder cost)`],
		],
	))
	blank()

	push(`> **Threshold compression** — if user messages were more aggressively compressed once input tokens exceed 15k, the ${above15kTurns} turns above that threshold (${pct(above15kCost, builderCost)} of builder cost) would shrink.`)
	blank()
}

function generateSystemPromptAnalysis(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	const breakdowns = stats.systemPromptBreakdowns
	if (breakdowns.length === 0) return

	const avgBuilderTurns = Math.round((stats.phaseStats.find(p => p.phase === 'builder')?.calls ?? 0) / Math.max(stats.cycleCount, 1))
	const effectiveRate = stats.effectiveInputRate

	push(`## System Prompt Analysis`)
	blank()

	for (const phase of ['planner', 'builder'] as const) {
		const items = breakdowns.filter(b => b.phase === phase)
		if (items.length === 0) continue

		const representative = items[0]
		const totalChars = representative.totalSystemChars
		const cachedChars = representative.blocks.filter(b => b.cached).reduce((s, b) => s + b.chars, 0)
		const uncachedChars = totalChars - cachedChars

		push(`### ${phase.charAt(0).toUpperCase() + phase.slice(1)} System Prompt`)
		blank()
		push(`- Total: ${fmt(totalChars)} chars (~${fmt(totalChars / 4)} tokens)`)
		push(`- Cached: ${fmt(cachedChars)} chars (${pct(cachedChars, totalChars)})`)
		push(`- Uncached: ${fmt(uncachedChars)} chars (${pct(uncachedChars, totalChars)})`)
		blank()

		push(mdTable(
			['Block', 'Chars', '~Tokens', '% of Total', 'Cached', 'Preview'],
			representative.blocks.map((b, i) => [
				String(i), fmt(b.chars), `~${fmt(b.chars / 4)}`, pct(b.chars, totalChars),
				b.cached ? '✓' : '✗', b.preview.slice(0, 60) + '…',
			]),
		))
		blank()

		if (items.length > 1) {
			push(`System prompt size across ${items.length} cycles: ${items.map(it => fmt(it.totalSystemChars)).join(' → ')} (${items.every(it => it.totalSystemChars === items[0].totalSystemChars) ? 'stable' : 'varying'})`)
			blank()
		}
	}

	const builderBreakdowns = breakdowns.filter(b => b.phase === 'builder')
	if (builderBreakdowns.length > 0) {
		const b = builderBreakdowns[0]
		const uncachedChars = b.blocks.filter(bl => !bl.cached).reduce((s, bl) => s + bl.chars, 0)
		if (uncachedChars > 0) {
			const tokensPerTurn = Math.round(uncachedChars / 4)
			const fullPriceTotal = tokensPerTurn * avgBuilderTurns
			const cacheDiscount = 0.1
			const cacheWriteMultiplier = 1.25
			const cachedPriceTotal = Math.round(tokensPerTurn * cacheWriteMultiplier + tokensPerTurn * cacheDiscount * (avgBuilderTurns - 1))
			const savingsPerIter = ((fullPriceTotal - cachedPriceTotal) * effectiveRate) / 1_000_000

			push(`### Cache Opportunity`)
			blank()
			push(`Builder has ${fmt(uncachedChars)} uncached chars (~${fmt(tokensPerTurn)} tokens) in its system prompt. Over ${avgBuilderTurns} builder turns at $${effectiveRate.toFixed(1)}/MTok effective rate:`)
			blank()
			push(`- Without cache: ${fmt(fullPriceTotal)} × $${effectiveRate.toFixed(1)}/MTok = $${((fullPriceTotal * effectiveRate) / 1_000_000).toFixed(4)}`)
			push(`- With cache (90% discount): $${((cachedPriceTotal * effectiveRate) / 1_000_000).toFixed(4)}`)
			push(`- **Savings per cycle: ~$${savingsPerIter.toFixed(4)}**`)
			blank()
		}
	}
}

function generateCompressionAnalysis(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	const points = stats.builderTurnPoints
	if (points.length === 0) return

	const totalToolResults = points.reduce((s, p) => s + p.toolResultCount, 0)
	const totalCompressed = points.reduce((s, p) => s + p.compressedToolResults, 0)
	const totalFull = points.reduce((s, p) => s + p.fullToolResults, 0)

	const byCycle = new Map<number, BuilderTurnPoint[]>()
	for (const p of points) {
		const arr = byCycle.get(p.cycleIndex) ?? []
		arr.push(p)
		byCycle.set(p.cycleIndex, arr)
	}

	const cycleRates = [...byCycle.entries()].map(([, pts]) => {
		const trTotal = pts.reduce((s, p) => s + p.toolResultCount, 0)
		const trComp = pts.reduce((s, p) => s + p.compressedToolResults, 0)
		const lateTurns = pts.filter(p => p.turnInPhase > 3)
		const lateFull = lateTurns.reduce((s, p) => s + p.fullToolResults, 0)
		return { title: pts[0].cycleTitle, total: trTotal, compressed: trComp, rate: trTotal > 0 ? trComp / trTotal : 0, lateFullResults: lateFull }
	})

	push(`## Compression Analysis`)
	blank()
	push(`Tool results from previous turns are redacted to save context.`)
	blank()

	push(mdTable(
		['Metric', 'Value'],
		[
			['Total Tool Results', String(totalToolResults)],
			['Compressed', `${totalCompressed} (${pct(totalCompressed, totalToolResults)})`],
			['Kept Full', `${totalFull} (${pct(totalFull, totalToolResults)})`],
		],
	))
	blank()

	push(mdTable(
		['Cycle', 'Tool Results', 'Compressed', 'Rate', 'Late Full Results'],
		cycleRates.map(c => [
			c.title, String(c.total), String(c.compressed),
			`${(c.rate * 100).toFixed(0)}%`, String(c.lateFullResults),
		]),
	))
	blank()

	push(`> **Late full results** (turn > 3 with uncompressed tool results) indicate the model is likely re-reading files it already read in earlier turns — turns wasted on re-fetching information that was redacted too aggressively.`)
	blank()
}

function generateRepeatedFileReads(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	const reads = stats.repeatedFileReads
	if (reads.length === 0) return

	const totalWastedReads = reads.reduce((s, r) => s + r.readCount - 1, 0)
	const totalWastedChars = reads.reduce((s, r) => s + (r.totalChars / r.readCount) * (r.readCount - 1), 0)
	const uniqueFiles = new Set(reads.map(r => r.filePath)).size

	push(`## Repeated File Reads`)
	blank()
	push(`Files read more than once within a single cycle.`)
	blank()

	push(mdTable(
		['Metric', 'Value'],
		[
			['Files Re-read', String(uniqueFiles)],
			['Redundant Reads', String(totalWastedReads)],
			['Wasted Context', `${fmt(totalWastedChars)} ch`],
		],
	))
	blank()

	push(mdTable(
		['File', 'Cycle', 'Reads', 'Total Chars', 'Turns'],
		reads.slice(0, 20).map(r => [
			r.filePath.split('/').pop() ?? r.filePath, r.cycleTitle,
			String(r.readCount), fmt(r.totalChars),
			r.turnNumbers.length <= 8 ? r.turnNumbers.join(', ') : `${r.turnNumbers.slice(0, 5).join(', ')}… +${r.turnNumbers.length - 5}`,
		]),
	))
	blank()

	push(`> Keeping a one-line summary of each tool result instead of full redaction would prevent ${totalWastedReads} redundant reads, saving ~${fmt(totalWastedChars * 0.25)} tokens of re-fetched context.`)
	blank()
}

function generateToolUsageAnalysis(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	const tools = stats.toolUsageStats
	if (tools.length === 0) return

	const totalChars = tools.reduce((s, t) => s + t.totalResultChars, 0)
	const totalInvocations = tools.reduce((s, t) => s + t.invocations, 0)

	push(`## Tool Usage Breakdown`)
	blank()
	push(`Which tools generate the most context? Large tool results directly inflate input tokens on subsequent turns.`)
	blank()

	push(mdTable(
		['Metric', 'Value'],
		[
			['Total Invocations', String(totalInvocations)],
			['Total Result Chars', fmt(totalChars)],
			['Avg Result Size', `${fmt(Math.round(totalChars / Math.max(totalInvocations, 1)))} ch`],
		],
	))
	blank()

	push(mdTable(
		['Tool', 'Calls', 'Total Chars', 'Avg Chars', 'Max Chars', '% of All', 'Spike Causing'],
		tools.map(t => [
			t.tool, String(t.invocations), fmt(t.totalResultChars),
			fmt(t.avgResultChars), fmt(t.maxResultChars),
			pct(t.totalResultChars, totalChars), String(t.spikeCausing),
		]),
	))
	blank()
}

function generateBuildVsFixProductivity(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	const productivity = stats.phaseProductivity
	if (productivity.length === 0) return

	push(`## Build vs Fix Productivity`)
	blank()
	push(`Comparing cost efficiency between normal build turns and fix-phase turns.`)
	blank()

	push(mdTable(
		['Phase', 'Turns', 'Input Tok', 'Output Tok', 'Cost', 'Avg Out/Turn', 'Cost/1k Out'],
		productivity.map(p => [
			p.label, String(p.turns), fmt(p.totalInputTokens), fmt(p.totalOutputTokens),
			fmtCost(p.totalCost), fmt(p.avgOutputPerTurn),
			p.costPerOutputToken > 0 ? `$${p.costPerOutputToken.toFixed(3)}` : '—',
		]),
	))
	blank()

	if (productivity.length >= 2 && productivity[1].costPerOutputToken > 0 && productivity[0].costPerOutputToken > 0) {
		push(`Fix phases cost **${(productivity[1].costPerOutputToken / productivity[0].costPerOutputToken).toFixed(1)}x** more per output token than build phases.`)
		blank()
	}
}

function generateCostEfficiencyCurve(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	const bands = stats.costEfficiencyBands
	if (bands.length === 0) return

	const firstBand = bands[0]
	const lastBand = bands[bands.length - 1]
	const escalation = firstBand.costPer1kOutput > 0 ? lastBand.costPer1kOutput / firstBand.costPer1kOutput : 0
	const diminishingPoint = bands.find(b => b.costPer1kOutput > firstBand.costPer1kOutput * 2)
	const cheapestBand = bands.reduce((a, b) => a.costPer1kOutput < b.costPer1kOutput ? a : b)

	push(`## Cost Efficiency by Turn Number`)
	blank()
	push(`How cost-per-output-token changes as a cycle progresses.`)
	blank()

	push(mdTable(
		['Turn Range', 'Turns', 'Cost', 'Output Tok', 'Avg Input', 'Cost/1k Out'],
		bands.map(b => [
			b.range, String(b.turns), fmtCost(b.totalCost), fmt(b.totalOutput),
			fmt(b.avgInputTokens), `$${b.costPer1kOutput.toFixed(3)}`,
		]),
	))
	blank()

	const notes: string[] = []
	if (escalation > 1) notes.push(`Cost per output token escalates **${escalation.toFixed(1)}x** from early turns (T${firstBand.range}) to late turns (T${lastBand.range}).`)
	if (cheapestBand !== firstBand) notes.push(`The most efficient range is T${cheapestBand.range} ($${cheapestBand.costPer1kOutput.toFixed(3)}/1k) — the model hits peak productivity after initial setup reads.`)
	if (diminishingPoint) {
		notes.push(`The diminishing returns threshold (2x initial cost) is reached at turns ${diminishingPoint.range}. This jump coincides with fix-phase restarts.`)
	} else {
		notes.push(`No turn range exceeds 2x the initial cost/output rate — these cycles are relatively efficient.`)
	}
	if (notes.length > 0) push(notes.join(' '))
	blank()
}

function generateMemoryOverhead(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	const details = stats.memoryCallDetails
	if (details.length === 0) return

	const totalMemoryCost = details.reduce((s, d) => s + d.cost, 0)
	const totalMemoryInput = details.reduce((s, d) => s + d.inputTokens, 0)
	const avgInputPerCall = Math.round(totalMemoryInput / details.length)
	const avgContentChars = Math.round(details.reduce((s, d) => s + d.contentChars, 0) / details.length)
	const avgSummaryChars = Math.round(details.reduce((s, d) => s + d.summaryChars, 0) / details.length)
	const avgSummaryWords = Math.round(avgSummaryChars / 5)
	const shortContent = details.filter(d => d.contentChars < 200)
	const shortContentCost = shortContent.reduce((s, d) => s + d.cost, 0)

	const byCycle = new Map<number, typeof details>()
	for (const d of details) {
		const arr = byCycle.get(d.cycleIndex) ?? []
		arr.push(d)
		byCycle.set(d.cycleIndex, arr)
	}

	push(`## Memory Summarization Overhead`)
	blank()
	push(`Every \`storePastMemory()\` call triggers a full LLM API call to generate a ~${avgSummaryWords}-word summary.`)
	blank()

	push(mdTable(
		['Metric', 'Value'],
		[
			['Total Memory Calls', String(details.length)],
			['Total Memory Cost', `${fmtCost(totalMemoryCost)} (${pct(totalMemoryCost, stats.totalCost)} of total)`],
			['Avg Input/Call', `${fmt(avgInputPerCall)} tok`],
			['Avg Content → Summary', `${fmt(avgContentChars)} → ${fmt(avgSummaryChars)} chars`],
		],
	))
	blank()

	push(mdTable(
		['Cycle', 'Calls', 'Input Tok', 'Cost', 'Avg Content', 'Short (<200ch)'],
		[...byCycle.entries()].map(([, calls]) => {
			const short = calls.filter(c => c.contentChars < 200).length
			return [
				calls[0].cycleTitle, String(calls.length),
				fmt(calls.reduce((s, c) => s + c.inputTokens, 0)),
				fmtCost(calls.reduce((s, c) => s + c.cost, 0)),
				`${fmt(calls.reduce((s, c) => s + c.contentChars, 0) / calls.length)} ch`,
				`${short}/${calls.length}`,
			]
		}),
	))
	blank()

	if (shortContent.length > 0) {
		push(`> **${shortContent.length}** ${shortContent.length === 1 ? 'call' : 'calls'} had content under 200 chars — short enough to use as-is without LLM summarization. Cost of these unnecessary calls: ${fmtCost(shortContentCost)}`)
		blank()
	}
}

function generateOptimizationOpportunities(stats: Statistics, push: (...s: string[]) => void, blank: () => void) {
	const builderPhase = stats.phaseStats.find(p => p.phase === 'builder')
	const memoryPhase = stats.phaseStats.find(p => p.phase === 'memory')

	const builderBreakdown = stats.systemPromptBreakdowns.find(b => b.phase === 'builder')
	const uncachedBuilderChars = builderBreakdown
		? builderBreakdown.blocks.filter(b => !b.cached).reduce((s, b) => s + b.chars, 0) : 0
	const uncachedBuilderTokens = Math.round(uncachedBuilderChars / 4)

	const avgBuilderTurns = builderPhase
		? Math.round(builderPhase.calls / Math.max(stats.cycleCount, 1)) : 10

	const shortMemoryCalls = stats.memoryCallDetails.filter(d => d.contentChars < 200).length
	const shortMemoryCost = stats.memoryCallDetails.filter(d => d.contentChars < 200).reduce((s, d) => s + d.cost, 0)

	const totalLateFullResults = stats.builderTurnPoints
		.filter(p => p.turnInPhase > 3)
		.reduce((s, p) => s + p.fullToolResults, 0)

	const fixSegments = stats.fixPhaseSegments
	const totalFixCost = fixSegments.reduce((s, seg) => s + seg.totalCost, 0)
	const totalFixTurns = fixSegments.reduce((s, seg) => s + seg.turnCount, 0)
	const avgFixFirstMsgTokens = fixSegments.length > 0
		? Math.round(fixSegments.reduce((s, seg) => s + seg.firstMsgChars / 4, 0) / fixSegments.length) : 0

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
		? Math.round(stats.builderTurnPoints.filter(p => p.turnInPhase > 3).reduce((s, p) => s + p.fullToolResults * (p.largestToolResultChars || 500), 0) / 4) : 0
	const tieredCompressionSavings = lateFullTokenEstimate > 0 ? (lateFullTokenEstimate * rate) / 1_000_000 : 0

	const depGraphBlock = builderBreakdown?.blocks.find(b =>
		b.preview.toLowerCase().includes('depend') || b.preview.toLowerCase().includes('import graph')
	)
	const depGraphTokens = depGraphBlock ? Math.round(depGraphBlock.chars / 4) : 0

	const memoryModelName = stats.modelsByPhase['memory'] ?? 'unknown'
	const avgSummaryWords = stats.memoryCallDetails.length > 0
		? Math.round(stats.memoryCallDetails.reduce((s, d) => s + d.summaryChars, 0) / stats.memoryCallDetails.length / 5) : 0

	const crossoverTurn = (() => {
		for (const p of stats.builderTurnPoints) {
			if (p.messageChars > p.systemChars && p.turnInPhase > 1) return p.turnInPhase
		}
		return null
	})()

	const opportunities = [
		{
			title: 'Cache builder system prompt',
			savings: uncachedBuilderTokens > 0 ? `~${fmtCost(cacheSavings)}/cycle` : 'Already cached ✓',
			dollarSavings: uncachedBuilderTokens > 0 ? cacheSavings : 0,
			impact: uncachedBuilderTokens > 0 ? 'HIGH' : 'N/A',
			description: `${fmt(uncachedBuilderTokens)} uncached tokens × ${avgBuilderTurns} builder turns/cycle = ${fmt(uncachedBuilderTokens * avgBuilderTurns)} wasted tokens per cycle at full price instead of 90% cache discount.`,
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
			description: `${shortMemoryCalls} memory ${shortMemoryCalls === 1 ? 'call' : 'calls'} had content <200 chars — already short enough to use verbatim as the summary.`,
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
			savings: fixSegments.length > 0 ? `~${fmtCost(fixCacheSavings)}/cycle` : 'N/A',
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
		const order: Record<string, number> = { 'HIGH': 0, 'MEDIUM-HIGH': 1, 'MEDIUM': 2, 'LOW': 3, 'N/A': 4 }
		return (order[a.impact] ?? 4) - (order[b.impact] ?? 4)
	})

	push(`## Optimization Opportunities`)
	blank()
	for (const o of sorted.filter(o => o.applicable)) {
		push(`### ${o.title}`)
		push(`**Impact:** ${o.impact} | **Estimated savings:** ${o.savings}`)
		blank()
		push(o.description)
		blank()
	}

	const savingsEstimates = sorted.filter(o => o.applicable && o.dollarSavings > 0)
	if (savingsEstimates.length > 0) {
		push(`### Projected Cost After Optimizations`)
		blank()
		let rc = stats.avgCostPerCycle
		const waterfallRows: string[][] = [['Current avg cost/cycle', fmtCost(stats.avgCostPerCycle)]]
		for (const o of savingsEstimates) {
			rc = Math.max(0, rc - o.dollarSavings)
			waterfallRows.push([`− ${o.title}`, `−${fmtCost(o.dollarSavings)} → ${fmtCost(rc)}`])
		}
		waterfallRows.push(['**Projected cost/cycle**', `**${fmtCost(rc)}**`])

		push(mdTable(['Step', 'Cost'], waterfallRows))
		blank()

		const totalTheoreticalSavings = savingsEstimates.reduce((s, o) => s + o.dollarSavings, 0)
		const theoreticalReduction = stats.avgCostPerCycle > 0 ? (totalTheoreticalSavings / stats.avgCostPerCycle) * 100 : 0

		push(`Total reduction: ${pct(stats.avgCostPerCycle - rc, stats.avgCostPerCycle)} (${fmtCost(stats.avgCostPerCycle - rc)}/cycle)`)
		if (theoreticalReduction > 30) {
			const realisticLow = Math.round(Math.min(theoreticalReduction * 0.45, 90))
			const realisticHigh = Math.round(Math.min(theoreticalReduction * 0.6, 95))
			push(`_Note: Savings overlap — caching and compression address some of the same tokens. Conservative estimate: ${realisticLow}-${realisticHigh}% reduction is realistic._`)
		}
		blank()
	}
}

export async function GET() {
	try {
		const stats = await getStatistics()
		if (stats.cycleCount === 0) {
			return new Response('No data found', { status: 404 })
		}
		const md = generateMarkdown(stats)
		return new Response(md, {
			headers: {
				'Content-Type': 'text/markdown; charset=utf-8',
				'Content-Disposition': `attachment; filename="seedgpt-statistics-${new Date().toISOString().slice(0, 10)}.md"`,
			},
		})
	} catch {
		return new Response('Could not generate statistics', { status: 500 })
	}
}
