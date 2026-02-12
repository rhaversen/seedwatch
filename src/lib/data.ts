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
