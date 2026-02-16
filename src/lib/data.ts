import { connectDB } from './db'
import { GeneratedModel, MemoryModel, IterationLogModel } from './models'
import type { IGenerated, IMemory, IIterationLog, MemoryCategory } from './models'
import { OVERHEAD_PHASES } from './phases'

interface ModelPricing {
	inputPerMTok: number
	cacheWrite5mPerMTok: number
	cacheWrite1hPerMTok: number
	cacheReadPerMTok: number
	outputPerMTok: number
}

const PRICING: Record<string, ModelPricing> = {
	'claude-opus-4-6':   { inputPerMTok: 5,    cacheWrite5mPerMTok: 6.25,  cacheWrite1hPerMTok: 10,   cacheReadPerMTok: 0.50, outputPerMTok: 25   },
	'claude-sonnet-4-5': { inputPerMTok: 3,    cacheWrite5mPerMTok: 3.75,  cacheWrite1hPerMTok: 6,    cacheReadPerMTok: 0.30, outputPerMTok: 15   },
	'claude-haiku-4-5':  { inputPerMTok: 1,    cacheWrite5mPerMTok: 1.25,  cacheWrite1hPerMTok: 2,    cacheReadPerMTok: 0.10, outputPerMTok: 5    },
}

const DEFAULT_PRICING: ModelPricing = { inputPerMTok: 5, cacheWrite5mPerMTok: 6.25, cacheWrite1hPerMTok: 10, cacheReadPerMTok: 0.50, outputPerMTok: 25 }

function splitCost(t: GeneratedTurn): { inputCost: number; outputCost: number } {
	const pricing = PRICING[t.modelId] ?? DEFAULT_PRICING
	const totalCacheWrite = t.cacheWrite5mTokens + t.cacheWrite1hTokens
	const uncached = Math.max(0, t.inputTokens - totalCacheWrite - t.cacheReadTokens)
	const inputCost = (uncached * pricing.inputPerMTok
		+ t.cacheWrite5mTokens * pricing.cacheWrite5mPerMTok
		+ t.cacheWrite1hTokens * pricing.cacheWrite1hPerMTok
		+ t.cacheReadTokens * pricing.cacheReadPerMTok) / 1_000_000
	const outputCost = (t.outputTokens * pricing.outputPerMTok) / 1_000_000
	const multiplier = t.batch ? 0.5 : 1
	return { inputCost: inputCost * multiplier, outputCost: outputCost * multiplier }
}

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
	totalCacheWrite5mTokens: number
	totalCacheWrite1hTokens: number
	totalCacheReadTokens: number
	phases: { phase: string; count: number }[]
}

export interface GeneratedTurn {
	id: string
	phase: string
	modelId: string
	iterationId: string
	system: unknown[]
	messages: unknown[]
	response: unknown[]
	inputTokens: number
	outputTokens: number
	cacheWrite5mTokens: number
	cacheWrite1hTokens: number
	cacheReadTokens: number
	cost: number
	batch: boolean
	stopReason: string
	createdAt: string
}

function toTurn(g: IGenerated): GeneratedTurn {
	return {
		id: String(g._id),
		phase: g.phase,
		modelId: g.modelId,
		iterationId: g.iterationId ?? '',
		system: g.system ?? [],
		messages: g.messages,
		response: g.response,
		inputTokens: g.inputTokens,
		outputTokens: g.outputTokens,
		cacheWrite5mTokens: g.cacheWrite5mTokens ?? 0,
		cacheWrite1hTokens: g.cacheWrite1hTokens ?? 0,
		cacheReadTokens: g.cacheReadTokens ?? 0,
		cost: g.cost,
		batch: g.batch ?? false,
		stopReason: g.stopReason,
		createdAt: g.createdAt.toISOString(),
	}
}

function groupIntoCycles(turns: GeneratedTurn[]): GeneratedTurn[][] {
	const map = new Map<string, GeneratedTurn[]>()
	const order: string[] = []
	for (const turn of turns) {
		const key = turn.iterationId || turn.id
		if (!map.has(key)) {
			map.set(key, [])
			order.push(key)
		}
		map.get(key)!.push(turn)
	}
	return order.map(k => map.get(k)!)
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
	let totalCacheWrite5mTokens = 0, totalCacheWrite1hTokens = 0, totalCacheReadTokens = 0
	for (const t of turns) {
		phases.set(t.phase, (phases.get(t.phase) ?? 0) + 1)
		totalCost += t.cost
		totalInputTokens += t.inputTokens
		totalOutputTokens += t.outputTokens
		totalCacheWrite5mTokens += t.cacheWrite5mTokens
		totalCacheWrite1hTokens += t.cacheWrite1hTokens
		totalCacheReadTokens += t.cacheReadTokens
	}
	return {
		id: turns[0].id,
		planTitle: extractPlanTitle(turns),
		createdAt: turns[0].createdAt,
		totalCost,
		totalCalls: turns.length,
		totalInputTokens,
		totalOutputTokens,
		totalCacheWrite5mTokens,
		totalCacheWrite1hTokens,
		totalCacheReadTokens,
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

	const iterationId = firstTurn.iterationId
	let docs: IGenerated[]

	if (iterationId) {
		docs = await GeneratedModel
			.find({ iterationId })
			.sort({ createdAt: 1 })
			.lean<IGenerated[]>()
	} else {
		docs = [firstTurn]
	}

	const cycle = docs.map(toTurn)
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
	const memories = await MemoryModel.find().sort({ category: 1, createdAt: -1 }).lean<IMemory[]>()
	return serialize(memories) as (IMemory & { _id: string })[]
}

export interface TurnStatRow {
	phase: string
	inputTokens: number
	outputTokens: number
	cacheWrite5mTokens: number
	cacheWrite1hTokens: number
	cacheReadTokens: number
	cost: number
	batch: boolean
	systemChars: number
	userChars: number
	assistantChars: number
	userMsgChars: number[]
	assistantMsgChars: number[]
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
	cacheWrite5mTokens: number
	cacheWrite1hTokens: number
	cacheReadTokens: number
	cost: number
	inputCost: number
	outputCost: number
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

export interface SummarizerBatchDetail {
	cycleIndex: number
	cycleTitle: string
	entriesInBatch: number
	totalInputTokens: number
	totalOutputTokens: number
	totalCost: number
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
	summarizerBatches: number
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
	reReadTurn: number
	originalTurn: number
	reReadChars: number
	originalStartLine: number
	originalEndLine: number
	reReadStartLine: number
	reReadEndLine: number
	overlapLines: number
}

export interface CostEfficiencyBand {
	range: string
	turns: number
	totalCost: number
	totalOutput: number
	costPer1kOutput: number
	avgInputTokens: number
}

export interface CostVelocity {
	firstCycleAt: string
	lastCycleAt: string
	totalElapsedHours: number
	costPerHour: number
	costPerDay: number
	projectedMonthlyCost: number
	cyclesPerDay: number
	avgCycleDurationMinutes: number
	medianCycleDurationMinutes: number
	minCycleDurationMinutes: number
	maxCycleDurationMinutes: number
	avgCycleCost: number
	medianCycleCost: number
	costTrend: { cycleIndex: number; cost: number; durationMinutes: number; cumulativeCost: number }[]
}

export interface Statistics {
	cycleCount: number
	totalCost: number
	totalInputTokens: number
	totalOutputTokens: number
	totalCacheWrite5mTokens: number
	totalCacheWrite1hTokens: number
	totalCacheReadTokens: number
	totalCalls: number
	avgCostPerCycle: number
	avgInputTokensPerCycle: number

	phaseStats: PhaseStats[]
	cycleOverviews: CycleOverview[]
	builderTurnPoints: BuilderTurnPoint[]
	systemPromptBreakdowns: SystemPromptBreakdown[]
	memoryCallDetails: MemoryCallDetail[]
	summarizerBatchDetails: SummarizerBatchDetail[]
	fixPhaseSegments: FixPhaseSegment[]
	tokenBuckets: TokenBucket[]
	toolUsageStats: ToolUsageStat[]
	phaseProductivity: PhaseProductivity[]
	repeatedFileReads: RepeatedFileRead[]
	costEfficiencyBands: CostEfficiencyBand[]
	costVelocity: CostVelocity | null
	effectiveInputRate: number
	modelsByPhase: Record<string, string>
}

export async function getAllTurnStats(): Promise<TurnStatRow[]> {
	await connectDB()
	const all = await GeneratedModel
		.find()
		.select('phase iterationId inputTokens outputTokens cacheWrite5mTokens cacheWrite1hTokens cacheReadTokens cost batch system messages createdAt')
		.sort({ createdAt: 1 })
		.lean<Pick<IGenerated, '_id' | 'phase' | 'iterationId' | 'inputTokens' | 'outputTokens' | 'cacheWrite5mTokens' | 'cacheWrite1hTokens' | 'cacheReadTokens' | 'cost' | 'batch' | 'system' | 'messages' | 'createdAt'>[]>()

	const iterationFirstId = new Map<string, string>()
	const iterationTurnCount = new Map<string, number>()

	return all.map(g => {
		const iterId = g.iterationId || String(g._id)
		if (!iterationFirstId.has(iterId)) {
			iterationFirstId.set(iterId, String(g._id))
			iterationTurnCount.set(iterId, 0)
		}
		const turnInCycle = iterationTurnCount.get(iterId)!
		iterationTurnCount.set(iterId, turnInCycle + 1)

		const msgs = (g.messages ?? []) as AnyMsg[]
		const sys = (g.system ?? []) as unknown[]
		const systemChars = sys.reduce((s: number, b) => s + systemBlockLen(b), 0)
		const userMsgChars: number[] = []
		const assistantMsgChars: number[] = []
		for (const m of msgs) {
			const len = charLenMsg(m)
			if (m.role === 'user') userMsgChars.push(len)
			else if (m.role === 'assistant') assistantMsgChars.push(len)
		}

		return {
			phase: g.phase,
			inputTokens: g.inputTokens,
			outputTokens: g.outputTokens,
			cacheWrite5mTokens: g.cacheWrite5mTokens ?? 0,
			cacheWrite1hTokens: g.cacheWrite1hTokens ?? 0,
			cacheReadTokens: g.cacheReadTokens ?? 0,
			cost: g.cost,
			batch: g.batch ?? false,
			systemChars,
			userChars: userMsgChars.reduce((s, n) => s + n, 0),
			assistantChars: assistantMsgChars.reduce((s, n) => s + n, 0),
			userMsgChars,
			assistantMsgChars,
			createdAt: g.createdAt.toISOString(),
			cycleId: iterationFirstId.get(iterId)!,
			turnInCycle,
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
	const totalCacheWrite5mTokens = turns.reduce((s, t) => s + t.cacheWrite5mTokens, 0)
	const totalCacheWrite1hTokens = turns.reduce((s, t) => s + t.cacheWrite1hTokens, 0)
	const totalCacheReadTokens = turns.reduce((s, t) => s + t.cacheReadTokens, 0)
	const cycleCount = cycles.length

	// Phase stats
	const phaseMap = new Map<string, { calls: number; inputTokens: number; outputTokens: number; cacheWrite5mTokens: number; cacheWrite1hTokens: number; cacheReadTokens: number; cost: number; inputCost: number; outputCost: number }>()
	for (const t of turns) {
		const p = phaseMap.get(t.phase) ?? { calls: 0, inputTokens: 0, outputTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: 0, cost: 0, inputCost: 0, outputCost: 0 }
		p.calls++
		p.inputTokens += t.inputTokens
		p.outputTokens += t.outputTokens
		p.cacheWrite5mTokens += t.cacheWrite5mTokens
		p.cacheWrite1hTokens += t.cacheWrite1hTokens
		p.cacheReadTokens += t.cacheReadTokens
		p.cost += t.cost
		const split = splitCost(t)
		p.inputCost += split.inputCost
		p.outputCost += split.outputCost
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
		let builderTurns = 0, plannerTurns = 0, memoryTurns = 0, summarizerBatches = 0
		let tc = 0, ti = 0, to = 0
		let prevSummarizer = false
		for (const t of cycleTurns) {
			phaseCosts[t.phase] = (phaseCosts[t.phase] ?? 0) + t.cost
			phaseInputTokens[t.phase] = (phaseInputTokens[t.phase] ?? 0) + t.inputTokens
			tc += t.cost; ti += t.inputTokens; to += t.outputTokens
			if (t.phase === 'builder') builderTurns++
			if (t.phase === 'planner') plannerTurns++
			if (t.phase === 'memory') memoryTurns++
			if (t.phase === 'summarizer' && !prevSummarizer) summarizerBatches++
			prevSummarizer = t.phase === 'summarizer'
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
			summarizerBatches,
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
			const lastCachedIdx = sys.findLastIndex((b: AnyMsg) => typeof b === 'object' && 'cache_control' in b && !!b.cache_control)
			const blocks = sys.map((b, bi) => ({
				index: bi,
				chars: systemBlockLen(b),
				cached: bi <= lastCachedIdx,
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

	// Summarizer batch details
	const summarizerBatchDetails: SummarizerBatchDetail[] = []
	for (let ci = 0; ci < cycles.length; ci++) {
		const cycleTurns = cycles[ci]
		const title = extractPlanTitle(cycleTurns)
		let i = 0
		while (i < cycleTurns.length) {
			if (cycleTurns[i].phase === 'summarizer') {
				let j = i + 1
				while (j < cycleTurns.length && cycleTurns[j].phase === 'summarizer') j++
				const batch = cycleTurns.slice(i, j)
				summarizerBatchDetails.push({
					cycleIndex: ci,
					cycleTitle: title,
					entriesInBatch: batch.length,
					totalInputTokens: batch.reduce((s, t) => s + t.inputTokens, 0),
					totalOutputTokens: batch.reduce((s, t) => s + t.outputTokens, 0),
					totalCost: batch.reduce((s, t) => s + t.cost, 0),
				})
				i = j
			} else {
				i++
			}
		}
	}

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

	// Repeated file reads caused by compression:
	// Only count a re-read as redundant if an earlier read of overlapping lines was compressed (gap markers injected)
	// between the two reads, meaning the summarizer removed context the agent later needed again.
	const GAP_MARKER = '[Lines omitted from context.'
	const repeatedFileReads: RepeatedFileRead[] = []

	for (let ci = 0; ci < cycles.length; ci++) {
		const cycleTurns = cycles[ci]
		const title = extractPlanTitle(cycleTurns)

		interface ReadRecord {
			toolUseId: string
			filePath: string
			startLine: number
			endLine: number
			turnIdx: number
			compressed: boolean
		}

		const reads: ReadRecord[] = []
		let lastSummarizerIdx = -1

		for (let ti = 0; ti < cycleTurns.length; ti++) {
			const t = cycleTurns[ti]

			if (t.phase === 'summarizer') {
				lastSummarizerIdx = ti
				// Check which prior reads got compressed by looking at tool_results in the messages
				// of the NEXT non-summarizer turn
				continue
			}

			// Check if any prior reads were compressed in this turn's messages
			const msgs = (t.messages ?? []) as AnyMsg[]
			for (const read of reads) {
				if (read.compressed) continue
				for (const msg of msgs) {
					if (msg.role !== 'user' || !Array.isArray(msg.content)) continue
					for (const block of msg.content) {
						if (block.type !== 'tool_result' || block.tool_use_id !== read.toolUseId) continue
						const text = typeof block.content === 'string' ? block.content : ''
						if (text.includes(GAP_MARKER)) {
							read.compressed = true
						}
					}
				}
			}

			if (t.phase !== 'builder' && t.phase !== 'planner') continue

			// Extract new read_file actions from this turn's response
			const resp = (t.response ?? []) as AnyMsg[]
			for (const block of resp) {
				if (block.type !== 'tool_use' || block.name !== 'read_file') continue
				const fp = block.input?.filePath ?? block.input?.path ?? ''
				if (!fp) continue
				const startLine = Number(block.input?.startLine) || 1
				const endLine = Number(block.input?.endLine) || Infinity

				// Check if this is a re-read of lines that were compressed away from an earlier read
				for (const prior of reads) {
					if (prior.filePath !== fp) continue
					if (!prior.compressed) continue
					// A summarizer must have run between the original read and this re-read
					if (lastSummarizerIdx <= prior.turnIdx) continue

					// Check line range overlap
					const overlapStart = Math.max(prior.startLine, startLine)
					const overlapEnd = Math.min(prior.endLine, endLine)
					if (overlapStart > overlapEnd) continue

					// Find the result chars for this re-read from the next turn's messages
					const nextTurn = cycleTurns[ti + 1]
					const nextMsgs = nextTurn ? (nextTurn.messages ?? []) as AnyMsg[] : []
					let reReadChars = 0
					for (const m of nextMsgs) {
						if (m.role !== 'user' || !Array.isArray(m.content)) continue
						for (const b of m.content) {
							if (b.type === 'tool_result' && b.tool_use_id === block.id) {
								reReadChars = typeof b.content === 'string' ? b.content.length : 0
							}
						}
					}

					repeatedFileReads.push({
						cycleIndex: ci,
						cycleTitle: title,
						filePath: fp,
						reReadTurn: ti + 1,
						originalTurn: prior.turnIdx + 1,
						reReadChars,
						originalStartLine: prior.startLine,
						originalEndLine: prior.endLine === Infinity ? 0 : prior.endLine,
						reReadStartLine: startLine,
						reReadEndLine: endLine === Infinity ? 0 : endLine,
						overlapLines: overlapEnd - overlapStart + 1,
					})
				}

				reads.push({
					toolUseId: block.id,
					filePath: fp,
					startLine: startLine,
					endLine: endLine,
					turnIdx: ti,
					compressed: false,
				})
			}
		}
	}
	repeatedFileReads.sort((a, b) => a.cycleIndex - b.cycleIndex || a.reReadTurn - b.reReadTurn)

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

	// Cost velocity
	let costVelocity: CostVelocity | null = null
	if (cycles.length >= 2) {
		const cycleDurations: { index: number; cost: number; durationMinutes: number }[] = []
		let cumulativeCost = 0
		for (let i = 0; i < cycles.length; i++) {
			const c = cycles[i]
			const first = new Date(c[0].createdAt).getTime()
			const last = new Date(c[c.length - 1].createdAt).getTime()
			const durationMinutes = Math.max((last - first) / 60_000, 0.1)
			const cost = c.reduce((s, t) => s + t.cost, 0)
			cumulativeCost += cost
			cycleDurations.push({ index: i, cost, durationMinutes })
		}

		const firstCycleAt = cycles[0][0].createdAt
		const lastCycleAt = cycles[cycles.length - 1][cycles[cycles.length - 1].length - 1].createdAt
		const totalElapsedMs = new Date(lastCycleAt).getTime() - new Date(firstCycleAt).getTime()
		const totalElapsedHours = Math.max(totalElapsedMs / 3_600_000, 0.01)

		const sortedDurations = cycleDurations.map(d => d.durationMinutes).sort((a, b) => a - b)
		const sortedCosts = cycleDurations.map(d => d.cost).sort((a, b) => a - b)
		const median = (arr: number[]) => arr.length % 2 === 0
			? (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2
			: arr[Math.floor(arr.length / 2)]

		const costPerHour = totalCost / totalElapsedHours
		const costPerDay = costPerHour * 24
		const cyclesPerDay = cycles.length / (totalElapsedHours / 24)

		let cumCost = 0
		const costTrend = cycleDurations.map(d => {
			cumCost += d.cost
			return { cycleIndex: d.index, cost: d.cost, durationMinutes: d.durationMinutes, cumulativeCost: cumCost }
		})

		costVelocity = {
			firstCycleAt,
			lastCycleAt,
			totalElapsedHours,
			costPerHour,
			costPerDay,
			projectedMonthlyCost: costPerDay * 30,
			cyclesPerDay,
			avgCycleDurationMinutes: sortedDurations.reduce((s, d) => s + d, 0) / sortedDurations.length,
			medianCycleDurationMinutes: median(sortedDurations),
			minCycleDurationMinutes: sortedDurations[0],
			maxCycleDurationMinutes: sortedDurations[sortedDurations.length - 1],
			avgCycleCost: totalCost / cycles.length,
			medianCycleCost: median(sortedCosts),
			costTrend,
		}
	}

	return {
		cycleCount,
		totalCost,
		totalInputTokens,
		totalOutputTokens,
		totalCacheWrite5mTokens,
		totalCacheWrite1hTokens,
		totalCacheReadTokens,
		totalCalls: turns.length,
		avgCostPerCycle: cycleCount > 0 ? totalCost / cycleCount : 0,
		avgInputTokensPerCycle: cycleCount > 0 ? Math.round(totalInputTokens / cycleCount) : 0,

		phaseStats,
		cycleOverviews,
		builderTurnPoints,
		systemPromptBreakdowns,
		memoryCallDetails,
		summarizerBatchDetails,
		fixPhaseSegments,
		tokenBuckets,
		toolUsageStats,
		phaseProductivity,
		repeatedFileReads,
		costEfficiencyBands,
		costVelocity,
		effectiveInputRate,
		modelsByPhase,
	}
}

// ---- Search ----

export interface SearchHit {
	turnId: string
	turnIndex: number
	role: string
	snippet: string
}

export interface SearchResult {
	cycleId: string
	cycleTitle: string
	phase: string
	createdAt: string
	hits: SearchHit[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTexts(blocks: any[]): { role: string; text: string }[] {
	const out: { role: string; text: string }[] = []
	if (!Array.isArray(blocks)) return out
	for (const b of blocks) {
		if (!b) continue
		const role: string = b.role ?? 'response'
		if (typeof b.content === 'string') {
			out.push({ role, text: b.content })
		} else if (Array.isArray(b.content)) {
			for (const part of b.content) {
				if (part?.type === 'text' && part.text) out.push({ role, text: part.text })
				else if (part?.type === 'tool_result' && typeof part.content === 'string') out.push({ role, text: part.content })
				else if (part?.type === 'tool_use' && part.input) out.push({ role, text: JSON.stringify(part.input) })
			}
		}
		if (b.type === 'text' && b.text) out.push({ role: 'response', text: b.text })
		if (b.type === 'tool_use' && b.input) out.push({ role: 'response', text: JSON.stringify(b.input) })
	}
	return out
}

function snippet(text: string, query: string, radius = 80): string {
	const lower = text.toLowerCase()
	const qi = lower.indexOf(query.toLowerCase())
	if (qi === -1) return text.slice(0, radius * 2)
	const start = Math.max(0, qi - radius)
	const end = Math.min(text.length, qi + query.length + radius)
	let s = text.slice(start, end)
	if (start > 0) s = '…' + s
	if (end < text.length) s = s + '…'
	return s
}

export async function searchTurns(query: string, limit = 100): Promise<SearchResult[]> {
	if (!query || query.length < 2) return []
	await connectDB()

	const all = await GeneratedModel.find()
		.sort({ createdAt: 1 })
		.select('phase iterationId messages response createdAt')
		.lean<IGenerated[]>()

	const minimalTurns: GeneratedTurn[] = all.map(g => ({
		id: String(g._id),
		phase: g.phase,
		modelId: '',
		iterationId: g.iterationId ?? '',
		system: [],
		messages: g.messages,
		response: g.response,
		inputTokens: 0,
		outputTokens: 0,
		cacheWrite5mTokens: 0,
		cacheWrite1hTokens: 0,
		cacheReadTokens: 0,
		cost: 0,
		batch: false,
		stopReason: '',
		createdAt: g.createdAt.toISOString(),
	}))

	const cycles = groupIntoCycles(minimalTurns)
	const results: SearchResult[] = []
	const ql = query.toLowerCase()
	let totalHits = 0

	for (const cycle of cycles) {
		const cycleId = cycle[0].id
		const cycleTitle = extractPlanTitle(cycle)

		const phaseGroups = new Map<string, SearchResult>()

		for (let ti = 0; ti < cycle.length; ti++) {
			const turn = cycle[ti]
			const raw = all.find(g => String(g._id) === turn.id)
			if (!raw) continue

			const msgTexts = extractTexts(raw.messages as unknown[])
			const resTexts = extractTexts(raw.response as unknown[])

			for (const { role, text } of [...msgTexts, ...resTexts]) {
				if (text.toLowerCase().includes(ql)) {
					const key = turn.phase
					if (!phaseGroups.has(key)) {
						phaseGroups.set(key, {
							cycleId,
							cycleTitle,
							phase: turn.phase,
							createdAt: turn.createdAt,
							hits: [],
						})
					}
					phaseGroups.get(key)!.hits.push({
						turnId: turn.id,
						turnIndex: ti,
						role,
						snippet: snippet(text, query),
					})
					totalHits++
					break
				}
			}
			if (totalHits >= limit) break
		}

		for (const group of phaseGroups.values()) {
			results.push(group)
		}
		if (totalHits >= limit) break
	}

	return results
}
