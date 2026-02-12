import { connectDB } from './db'
import { GeneratedModel, MemoryModel, IterationLogModel } from './models'
import type { IGenerated, IMemory, IIterationLog } from './models'

function serialize<T>(doc: T): T {
	return JSON.parse(JSON.stringify(doc))
}

export interface CycleSummary {
	id: string
	planTitle: string
	createdAt: string
	totalCost: number
	totalCalls: number
	totalInputTokens: number
	totalOutputTokens: number
	phases: { phase: string; count: number }[]
}

export interface GeneratedTurn {
	id: string
	phase: string
	modelId: string
	system: unknown[]
	messages: unknown[]
	response: unknown[]
	inputTokens: number
	outputTokens: number
	cost: number
	stopReason: string
	createdAt: string
}

function toTurn(g: IGenerated): GeneratedTurn {
	return {
		id: String(g._id),
		phase: g.phase,
		modelId: g.modelId,
		system: g.system ?? [],
		messages: g.messages,
		response: g.response,
		inputTokens: g.inputTokens,
		outputTokens: g.outputTokens,
		cost: g.cost,
		stopReason: g.stopReason,
		createdAt: g.createdAt.toISOString(),
	}
}

function groupIntoCycles(turns: GeneratedTurn[]): GeneratedTurn[][] {
	const cycles: GeneratedTurn[][] = []
	let prevPhase = ''
	for (const turn of turns) {
		if (turn.phase === 'planner' && prevPhase !== 'planner') {
			cycles.push([turn])
		} else {
			if (cycles.length === 0) cycles.push([])
			cycles[cycles.length - 1].push(turn)
		}
		prevPhase = turn.phase
	}
	return cycles
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = Record<string, any>

function extractPlanTitle(turns: GeneratedTurn[]): string {
	for (const t of turns) {
		if (t.phase !== 'planner') continue
		for (const block of t.response as AnyBlock[]) {
			if (block.type === 'tool_use' && block.name === 'submit_plan') {
				return block.input?.title ?? 'Untitled'
			}
		}
	}
	return 'Untitled cycle'
}

function summarizeCycle(turns: GeneratedTurn[]): CycleSummary {
	const phases = new Map<string, number>()
	let totalCost = 0, totalInputTokens = 0, totalOutputTokens = 0
	for (const t of turns) {
		phases.set(t.phase, (phases.get(t.phase) ?? 0) + 1)
		totalCost += t.cost
		totalInputTokens += t.inputTokens
		totalOutputTokens += t.outputTokens
	}
	return {
		id: turns[0].id,
		planTitle: extractPlanTitle(turns),
		createdAt: turns[0].createdAt,
		totalCost,
		totalCalls: turns.length,
		totalInputTokens,
		totalOutputTokens,
		phases: Array.from(phases.entries()).map(([phase, count]) => ({ phase, count })),
	}
}

export async function getCycles(): Promise<CycleSummary[]> {
	await connectDB()
	const all = await GeneratedModel.find().sort({ createdAt: 1 }).lean<IGenerated[]>()
	const turns = all.map(toTurn)
	const cycles = groupIntoCycles(turns)

	return cycles
		.filter(c => c.length > 0)
		.map(c => summarizeCycle(c))
		.reverse()
}

export async function getCycleDetail(cycleId: string): Promise<{ usage: CycleSummary; turns: GeneratedTurn[]; log: IIterationLog | null } | null> {
	await connectDB()

	const firstTurn = await GeneratedModel.findById(cycleId).lean<IGenerated>()
	if (!firstTurn) return null

	const forward = await GeneratedModel
		.find({ createdAt: { $gte: firstTurn.createdAt } })
		.sort({ createdAt: 1 })
		.lean<IGenerated[]>()

	const cycle: GeneratedTurn[] = []
	let seenNonPlanner = false
	for (const g of forward) {
		const turn = toTurn(g)
		if (turn.phase === 'planner' && seenNonPlanner) break
		if (turn.phase !== 'planner') seenNonPlanner = true
		cycle.push(turn)
	}

	if (cycle.length === 0) return null

	const firstDate = new Date(cycle[0].createdAt)
	const lastTurnDate = new Date(cycle[cycle.length - 1].createdAt)
	const log = await IterationLogModel
		.findOne({ createdAt: { $gte: firstDate, $lte: new Date(lastTurnDate.getTime() + 60_000) } })
		.sort({ createdAt: -1 })
		.lean<IIterationLog>()

	return {
		usage: summarizeCycle(cycle),
		turns: cycle,
		log: log ? serialize(log) : null,
	}
}

export async function getMemories(): Promise<(IMemory & { _id: string })[]> {
	await connectDB()
	const memories = await MemoryModel.find().sort({ pinned: -1, createdAt: -1 }).lean<IMemory[]>()
	return serialize(memories) as (IMemory & { _id: string })[]
}

export interface TurnStatRow {
	phase: string
	inputTokens: number
	outputTokens: number
	cost: number
	createdAt: string
	cycleId: string
	turnInCycle: number
}

// ---- Statistics types ----

export interface PhaseStats {
	phase: string
	calls: number
	inputTokens: number
	outputTokens: number
	cost: number
	avgInputTokens: number
	avgOutputTokens: number
	avgCost: number
}

export interface BuilderTurnPoint {
	cycleIndex: number
	cycleTitle: string
	turnInPhase: number
	inputTokens: number
	outputTokens: number
	cost: number
	systemChars: number
	messageChars: number
	userMsgCount: number
	assistantMsgCount: number
	toolResultCount: number
	compressedToolResults: number
	fullToolResults: number
	isFixPhaseStart: boolean
	firstMsgChars: number
	largestToolResultChars: number
	largestToolResultName: string
}

export interface SystemPromptBreakdown {
	cycleIndex: number
	phase: string
	totalSystemChars: number
	blocks: { index: number; chars: number; cached: boolean; preview: string }[]
}

export interface MemoryCallDetail {
	cycleIndex: number
	cycleTitle: string
	inputTokens: number
	outputTokens: number
	cost: number
	contentChars: number
	summaryChars: number
}

export interface CycleOverview {
	index: number
	title: string
	totalCost: number
	totalInputTokens: number
	totalOutputTokens: number
	totalCalls: number
	phaseCosts: Record<string, number>
	phaseInputTokens: Record<string, number>
	builderTurns: number
	plannerTurns: number
	memoryTurns: number
}

export interface FixPhaseSegment {
	cycleIndex: number
	cycleTitle: string
	startTurn: number
	turnCount: number
	firstMsgChars: number
	totalCost: number
	totalInputTokens: number
}

export interface TokenBucket {
	range: string
	min: number
	max: number
	count: number
	totalCost: number
	totalInputTokens: number
}

export interface ToolUsageStat {
	tool: string
	invocations: number
	totalResultChars: number
	avgResultChars: number
	maxResultChars: number
	spikeCausing: number
}

export interface PhaseProductivity {
	label: string
	turns: number
	totalInputTokens: number
	totalOutputTokens: number
	totalCost: number
	costPerOutputToken: number
	avgOutputPerTurn: number
}

export interface RepeatedFileRead {
	cycleIndex: number
	cycleTitle: string
	filePath: string
	readCount: number
	totalChars: number
	turnNumbers: number[]
}

export interface CostEfficiencyBand {
	range: string
	turns: number
	totalCost: number
	totalOutput: number
	costPer1kOutput: number
	avgInputTokens: number
}

export interface Statistics {
	cycleCount: number
	totalCost: number
	totalInputTokens: number
	totalOutputTokens: number
	totalCalls: number
	avgCostPerCycle: number
	avgInputTokensPerCycle: number

	phaseStats: PhaseStats[]
	cycleOverviews: CycleOverview[]
	builderTurnPoints: BuilderTurnPoint[]
	systemPromptBreakdowns: SystemPromptBreakdown[]
	memoryCallDetails: MemoryCallDetail[]
	fixPhaseSegments: FixPhaseSegment[]
	tokenBuckets: TokenBucket[]
	toolUsageStats: ToolUsageStat[]
	phaseProductivity: PhaseProductivity[]
	repeatedFileReads: RepeatedFileRead[]
	costEfficiencyBands: CostEfficiencyBand[]
	effectiveInputRate: number
	modelsByPhase: Record<string, string>
}

export async function getAllTurnStats(): Promise<TurnStatRow[]> {
	await connectDB()
	const all = await GeneratedModel
		.find()
		.select('phase inputTokens outputTokens cost createdAt')
		.sort({ createdAt: 1 })
		.lean<Pick<IGenerated, '_id' | 'phase' | 'inputTokens' | 'outputTokens' | 'cost' | 'createdAt'>[]>()

	let cycleId = ''
	let turnInCycle = 0
	let prevPhase = ''

	return all.map(g => {
		if (g.phase === 'planner' && prevPhase !== 'planner') {
			cycleId = String(g._id)
			turnInCycle = 0
		}
		prevPhase = g.phase
		return {
			phase: g.phase,
			inputTokens: g.inputTokens,
			outputTokens: g.outputTokens,
			cost: g.cost,
			createdAt: g.createdAt.toISOString(),
			cycleId: cycleId || String(g._id),
			turnInCycle: turnInCycle++,
		}
	})
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMsg = Record<string, any>

function charLenMsg(msg: AnyMsg): number {
	if (typeof msg.content === 'string') return msg.content.length
	if (Array.isArray(msg.content)) {
		return msg.content.reduce((s: number, b: AnyMsg) => {
			if (b.type === 'text') return s + (b.text?.length ?? 0)
			if (b.type === 'tool_result') {
				const t = typeof b.content === 'string' ? b.content : JSON.stringify(b.content)
				return s + t.length
			}
			if (b.type === 'tool_use') return s + JSON.stringify(b.input ?? '').length
			return s + JSON.stringify(b).length
		}, 0)
	}
	return JSON.stringify(msg).length
}

function systemBlockLen(block: unknown): number {
	if (typeof block === 'string') return block.length
	const b = block as AnyMsg
	return b.text?.length ?? JSON.stringify(b).length
}

function isCompressedToolResult(content: string): boolean {
	return content.startsWith('[') && (
		content.includes('was removed from context') ||
		content.includes('was removed — ') ||
		content.includes('[Read ') ||
		content.includes('[Searched ') ||
		content.includes('[File search') ||
		content.includes('[Listed ') ||
		content.includes('[Diff ')
	)
}

function countToolResults(messages: AnyMsg[]): { total: number; compressed: number; full: number } {
	let total = 0, compressed = 0, full = 0
	for (const msg of messages) {
		if (msg.role !== 'user' || !Array.isArray(msg.content)) continue
		for (const block of msg.content) {
			if (block.type !== 'tool_result') continue
			total++
			const text = typeof block.content === 'string' ? block.content : ''
			if (text.length <= 100 || isCompressedToolResult(text)) compressed++
			else full++
		}
	}
	return { total, compressed, full }
}

function findLargestToolResult(messages: AnyMsg[]): { chars: number; name: string } {
	let maxChars = 0, maxName = ''
	for (const msg of messages) {
		if (msg.role !== 'user' || !Array.isArray(msg.content)) continue
		for (const block of msg.content) {
			if (block.type !== 'tool_result') continue
			const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
			if (text.length > maxChars) {
				maxChars = text.length
				const toolId = block.tool_use_id as string
				const toolUse = messages
					.filter((m: AnyMsg) => m.role === 'assistant' && Array.isArray(m.content))
					.flatMap((m: AnyMsg) => m.content)
					.find((b: AnyMsg) => b.type === 'tool_use' && b.id === toolId)
				maxName = toolUse?.name ?? 'unknown'
			}
		}
	}
	return { chars: maxChars, name: maxName }
}

export async function getStatistics(): Promise<Statistics> {
	await connectDB()
	const all = await GeneratedModel.find().sort({ createdAt: 1 }).lean<IGenerated[]>()
	const turns = all.map(toTurn)
	const cycles = groupIntoCycles(turns)

	const totalCost = turns.reduce((s, t) => s + t.cost, 0)
	const totalInputTokens = turns.reduce((s, t) => s + t.inputTokens, 0)
	const totalOutputTokens = turns.reduce((s, t) => s + t.outputTokens, 0)
	const cycleCount = cycles.length

	// Phase stats
	const phaseMap = new Map<string, { calls: number; inputTokens: number; outputTokens: number; cost: number }>()
	for (const t of turns) {
		const p = phaseMap.get(t.phase) ?? { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 }
		p.calls++
		p.inputTokens += t.inputTokens
		p.outputTokens += t.outputTokens
		p.cost += t.cost
		phaseMap.set(t.phase, p)
	}
	const phaseStats: PhaseStats[] = [...phaseMap.entries()].map(([phase, p]) => ({
		phase,
		...p,
		avgInputTokens: Math.round(p.inputTokens / p.calls),
		avgOutputTokens: Math.round(p.outputTokens / p.calls),
		avgCost: p.cost / p.calls,
	})).sort((a, b) => b.cost - a.cost)

	// Cycle overviews
	const cycleOverviews: CycleOverview[] = cycles.map((cycleTurns, i) => {
		const phaseCosts: Record<string, number> = {}
		const phaseInputTokens: Record<string, number> = {}
		let builderTurns = 0, plannerTurns = 0, memoryTurns = 0
		let tc = 0, ti = 0, to = 0
		for (const t of cycleTurns) {
			phaseCosts[t.phase] = (phaseCosts[t.phase] ?? 0) + t.cost
			phaseInputTokens[t.phase] = (phaseInputTokens[t.phase] ?? 0) + t.inputTokens
			tc += t.cost; ti += t.inputTokens; to += t.outputTokens
			if (t.phase === 'builder') builderTurns++
			if (t.phase === 'planner') plannerTurns++
			if (t.phase === 'memory') memoryTurns++
		}
		return {
			index: i,
			title: extractPlanTitle(cycleTurns),
			totalCost: tc,
			totalInputTokens: ti,
			totalOutputTokens: to,
			totalCalls: cycleTurns.length,
			phaseCosts,
			phaseInputTokens,
			builderTurns,
			plannerTurns,
			memoryTurns,
		}
	})

	// Builder turn-by-turn data
	const builderTurnPoints: BuilderTurnPoint[] = []
	for (let ci = 0; ci < cycles.length; ci++) {
		const cycleTurns = cycles[ci]
		const title = extractPlanTitle(cycleTurns)
		let builderIdx = 0
		for (const t of cycleTurns) {
			if (t.phase !== 'builder') continue
			builderIdx++
			const msgs = (t.messages ?? []) as AnyMsg[]
			const sys = (t.system ?? []) as unknown[]
			const systemChars = sys.reduce((s: number, b) => s + systemBlockLen(b), 0)
			let messageChars = 0, userCount = 0, assistantCount = 0
			for (const m of msgs) {
				messageChars += charLenMsg(m)
				if (m.role === 'user') userCount++
				else if (m.role === 'assistant') assistantCount++
			}
			const { total, compressed, full } = countToolResults(msgs)

			const isFixPhaseStart = builderIdx > 1 && userCount === 1 && assistantCount === 1
			const firstMsg = msgs.find((m: AnyMsg) => m.role === 'user')
			const firstMsgChars = firstMsg ? charLenMsg(firstMsg) : 0
			const { chars: largestToolResultChars, name: largestToolResultName } = findLargestToolResult(msgs)

			builderTurnPoints.push({
				cycleIndex: ci,
				cycleTitle: title,
				turnInPhase: builderIdx,
				inputTokens: t.inputTokens,
				outputTokens: t.outputTokens,
				cost: t.cost,
				systemChars,
				messageChars,
				userMsgCount: userCount,
				assistantMsgCount: assistantCount,
				toolResultCount: total,
				compressedToolResults: compressed,
				fullToolResults: full,
				isFixPhaseStart,
				firstMsgChars,
				largestToolResultChars,
				largestToolResultName,
			})
		}
	}

	// System prompt breakdowns (first builder + first planner per cycle)
	const systemPromptBreakdowns: SystemPromptBreakdown[] = []
	for (let ci = 0; ci < cycles.length; ci++) {
		const cycleTurns = cycles[ci]
		for (const phase of ['planner', 'builder'] as const) {
			const first = cycleTurns.find(t => t.phase === phase)
			if (!first) continue
			const sys = (first.system ?? []) as AnyMsg[]
			const blocks = sys.map((b, bi) => ({
				index: bi,
				chars: systemBlockLen(b),
				cached: !!b.cache_control,
				preview: (typeof b === 'string' ? b : b.text ?? '').slice(0, 120),
			}))
			systemPromptBreakdowns.push({
				cycleIndex: ci,
				phase,
				totalSystemChars: blocks.reduce((s, b) => s + b.chars, 0),
				blocks,
			})
		}
	}

	// Memory call details
	const memoryCallDetails: MemoryCallDetail[] = []
	for (let ci = 0; ci < cycles.length; ci++) {
		const cycleTurns = cycles[ci]
		const title = extractPlanTitle(cycleTurns)
		for (const t of cycleTurns) {
			if (t.phase !== 'memory') continue
			const msgs = (t.messages ?? []) as AnyMsg[]
			const contentChars = msgs.reduce((s: number, m: AnyMsg) => s + charLenMsg(m), 0)
			const resp = (t.response ?? []) as AnyMsg[]
			const summaryChars = resp.reduce((s: number, b: AnyMsg) => {
				if (b.type === 'text') return s + (b.text?.length ?? 0)
				return s
			}, 0)
			memoryCallDetails.push({
				cycleIndex: ci,
				cycleTitle: title,
				inputTokens: t.inputTokens,
				outputTokens: t.outputTokens,
				cost: t.cost,
				contentChars,
				summaryChars,
			})
		}
	}

	// Fix-phase segments: groups of builder turns starting at a fixPatch restart
	const fixPhaseSegments: FixPhaseSegment[] = []
	for (let ci = 0; ci < cycles.length; ci++) {
		const pts = builderTurnPoints.filter(p => p.cycleIndex === ci)
		const fixStarts = pts.filter(p => p.isFixPhaseStart)
		for (const start of fixStarts) {
			const segTurns = pts.filter(p => p.turnInPhase >= start.turnInPhase)
			const nextFix = segTurns.find(p => p.turnInPhase > start.turnInPhase && p.isFixPhaseStart)
			const end = nextFix ? nextFix.turnInPhase : Infinity
			const inSegment = segTurns.filter(p => p.turnInPhase < end)
			fixPhaseSegments.push({
				cycleIndex: ci,
				cycleTitle: start.cycleTitle,
				startTurn: start.turnInPhase,
				turnCount: inSegment.length,
				firstMsgChars: start.firstMsgChars,
				totalCost: inSegment.reduce((s, p) => s + p.cost, 0),
				totalInputTokens: inSegment.reduce((s, p) => s + p.inputTokens, 0),
			})
		}
	}

	// Token buckets for builder turns
	const bucketDefs = [
		{ range: '0-2k', min: 0, max: 2000 },
		{ range: '2k-5k', min: 2000, max: 5000 },
		{ range: '5k-10k', min: 5000, max: 10000 },
		{ range: '10k-15k', min: 10000, max: 15000 },
		{ range: '15k-20k', min: 15000, max: 20000 },
		{ range: '20k+', min: 20000, max: Infinity },
	]
	const tokenBuckets: TokenBucket[] = bucketDefs.map(b => {
		const inBucket = builderTurnPoints.filter(p => p.inputTokens >= b.min && p.inputTokens < b.max)
		return {
			...b,
			count: inBucket.length,
			totalCost: inBucket.reduce((s, p) => s + p.cost, 0),
			totalInputTokens: inBucket.reduce((s, p) => s + p.inputTokens, 0),
		}
	})

	// Tool usage statistics: extract tool names and result sizes from builder messages
	const toolMap = new Map<string, { invocations: number; totalChars: number; maxChars: number; results: number[] }>()
	for (let ci = 0; ci < cycles.length; ci++) {
		for (const t of cycles[ci]) {
			if (t.phase !== 'builder') continue
			const msgs = (t.messages ?? []) as AnyMsg[]
			for (const msg of msgs) {
				if (msg.role !== 'user' || !Array.isArray(msg.content)) continue
				for (const block of msg.content) {
					if (block.type !== 'tool_result') continue
					const toolId = block.tool_use_id as string
					const toolUse = msgs
						.filter((m: AnyMsg) => m.role === 'assistant' && Array.isArray(m.content))
						.flatMap((m: AnyMsg) => m.content)
						.find((b: AnyMsg) => b.type === 'tool_use' && b.id === toolId)
					const name = toolUse?.name ?? 'unknown'
					const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
					const chars = text.length
					const entry = toolMap.get(name) ?? { invocations: 0, totalChars: 0, maxChars: 0, results: [] }
					entry.invocations++
					entry.totalChars += chars
					entry.maxChars = Math.max(entry.maxChars, chars)
					entry.results.push(chars)
					toolMap.set(name, entry)
				}
			}
		}
	}

	const toolUsageStats: ToolUsageStat[] = [...toolMap.entries()]
		.map(([tool, data]) => ({
			tool,
			invocations: data.invocations,
			totalResultChars: data.totalChars,
			avgResultChars: Math.round(data.totalChars / data.invocations),
			maxResultChars: data.maxChars,
			spikeCausing: data.results.filter(r => r > 8000).length,
		}))
		.sort((a, b) => b.totalResultChars - a.totalResultChars)

	// Phase productivity: build vs fix
	const fixTurnIndices = new Set<string>()
	for (const seg of fixPhaseSegments) {
		const pts = builderTurnPoints.filter(p => p.cycleIndex === seg.cycleIndex)
		for (const p of pts) {
			if (p.turnInPhase >= seg.startTurn) {
				const nextSeg = fixPhaseSegments.find(s => s.cycleIndex === seg.cycleIndex && s.startTurn > seg.startTurn)
				if (!nextSeg || p.turnInPhase < nextSeg.startTurn) {
					fixTurnIndices.add(`${seg.cycleIndex}-${p.turnInPhase}`)
				}
			}
		}
	}

	const buildPts = builderTurnPoints.filter(p => !fixTurnIndices.has(`${p.cycleIndex}-${p.turnInPhase}`))
	const fixPts = builderTurnPoints.filter(p => fixTurnIndices.has(`${p.cycleIndex}-${p.turnInPhase}`))

	const makeProductivity = (label: string, pts: BuilderTurnPoint[]): PhaseProductivity => {
		const ti = pts.reduce((s, p) => s + p.inputTokens, 0)
		const to = pts.reduce((s, p) => s + p.outputTokens, 0)
		const tc = pts.reduce((s, p) => s + p.cost, 0)
		return {
			label,
			turns: pts.length,
			totalInputTokens: ti,
			totalOutputTokens: to,
			totalCost: tc,
			costPerOutputToken: to > 0 ? (tc / to) * 1000 : 0,
			avgOutputPerTurn: pts.length > 0 ? Math.round(to / pts.length) : 0,
		}
	}

	const phaseProductivity: PhaseProductivity[] = [
		makeProductivity('Build (no fix)', buildPts),
		makeProductivity('Fix phases', fixPts),
	]

	// Repeated file reads: extract file paths from read_file tool_use in the response (new actions per turn)
	const fileReadMap = new Map<string, { count: number; totalChars: number; turns: Set<number> }>()
	for (let ci = 0; ci < cycles.length; ci++) {
		const builderTurns = cycles[ci].filter(t => t.phase === 'builder')
		for (let bi = 0; bi < builderTurns.length; bi++) {
			const t = builderTurns[bi]
			const resp = (t.response ?? []) as AnyMsg[]
			const nextMsgs = bi + 1 < builderTurns.length ? (builderTurns[bi + 1].messages ?? []) as AnyMsg[] : []
			for (const block of resp) {
				if (block.type === 'tool_use' && block.name === 'read_file') {
					const fp = block.input?.filePath ?? block.input?.path ?? ''
					if (!fp) continue
					const key = `${ci}::${fp}`
					const entry = fileReadMap.get(key) ?? { count: 0, totalChars: 0, turns: new Set<number>() }
					entry.count++
					entry.turns.add(bi + 1)
					const resultBlock = nextMsgs
						.filter((m: AnyMsg) => m.role === 'user' && Array.isArray(m.content))
						.flatMap((m: AnyMsg) => m.content)
						.find((b: AnyMsg) => b.type === 'tool_result' && b.tool_use_id === block.id)
					if (resultBlock) {
						const text = typeof resultBlock.content === 'string' ? resultBlock.content : ''
						entry.totalChars += text.length
					}
					fileReadMap.set(key, entry)
				}
			}
		}
	}
	const repeatedFileReads: RepeatedFileRead[] = [...fileReadMap.entries()]
		.filter(([, data]) => data.count > 1)
		.map(([key, data]) => {
			const [ciStr, ...fpParts] = key.split('::')
			const ci = parseInt(ciStr)
			return {
				cycleIndex: ci,
				cycleTitle: extractPlanTitle(cycles[ci]),
				filePath: fpParts.join('::'),
				readCount: data.count,
				totalChars: data.totalChars,
				turnNumbers: [...data.turns].sort((a, b) => a - b),
			}
		})
		.sort((a, b) => b.readCount - a.readCount)

	// Cost efficiency bands: group builder turns by turn-number ranges
	const bandDefs = [
		{ range: '1-3', min: 1, max: 3 },
		{ range: '4-7', min: 4, max: 7 },
		{ range: '8-12', min: 8, max: 12 },
		{ range: '13-20', min: 13, max: 20 },
		{ range: '21-30', min: 21, max: 30 },
		{ range: '31+', min: 31, max: Infinity },
	]
	const costEfficiencyBands: CostEfficiencyBand[] = bandDefs.map(b => {
		const inBand = builderTurnPoints.filter(p => p.turnInPhase >= b.min && p.turnInPhase <= b.max)
		const tc = inBand.reduce((s, p) => s + p.cost, 0)
		const to = inBand.reduce((s, p) => s + p.outputTokens, 0)
		const ti = inBand.reduce((s, p) => s + p.inputTokens, 0)
		return {
			range: b.range,
			turns: inBand.length,
			totalCost: tc,
			totalOutput: to,
			costPer1kOutput: to > 0 ? (tc / to) * 1000 : 0,
			avgInputTokens: inBand.length > 0 ? Math.round(ti / inBand.length) : 0,
		}
	}).filter(b => b.turns > 0)

	const effectiveInputRate = totalInputTokens > 0 ? (totalCost / totalInputTokens) * 1_000_000 : 3

	const modelsByPhase: Record<string, string> = {}
	for (const t of turns) {
		if (!modelsByPhase[t.phase] && t.modelId) {
			modelsByPhase[t.phase] = t.modelId
		}
	}

	return {
		cycleCount,
		totalCost,
		totalInputTokens,
		totalOutputTokens,
		totalCalls: turns.length,
		avgCostPerCycle: cycleCount > 0 ? totalCost / cycleCount : 0,
		avgInputTokensPerCycle: cycleCount > 0 ? Math.round(totalInputTokens / cycleCount) : 0,

		phaseStats,
		cycleOverviews,
		builderTurnPoints,
		systemPromptBreakdowns,
		memoryCallDetails,
		fixPhaseSegments,
		tokenBuckets,
		toolUsageStats,
		phaseProductivity,
		repeatedFileReads,
		costEfficiencyBands,
		effectiveInputRate,
		modelsByPhase,
	}
}
