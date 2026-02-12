import mongoose, { type Document, type Model, Schema } from 'mongoose'

export interface IGenerated extends Document {
	phase: string
	modelId: string
	system: unknown[]
	messages: unknown[]
	response: unknown[]
	inputTokens: number
	outputTokens: number
	cost: number
	stopReason: string
	createdAt: Date
}

const generatedSchema = new Schema<IGenerated>({
	phase: String,
	modelId: String,
	system: Schema.Types.Mixed,
	messages: Schema.Types.Mixed,
	response: Schema.Types.Mixed,
	inputTokens: Number,
	outputTokens: Number,
	cost: Number,
	stopReason: String,
}, { timestamps: { createdAt: true, updatedAt: false } })

export const GeneratedModel: Model<IGenerated> =
	mongoose.models.Generated ?? mongoose.model<IGenerated>('Generated', generatedSchema)

export interface IMemory extends Document {
	content: string
	summary: string
	pinned: boolean
	createdAt: Date
	updatedAt: Date
}

const memorySchema = new Schema<IMemory>({
	content: String,
	summary: String,
	pinned: { type: Boolean, default: false },
}, { timestamps: true })

export const MemoryModel: Model<IMemory> =
	mongoose.models.Memory ?? mongoose.model<IMemory>('Memory', memorySchema)

export interface IUsageBreakdown {
	caller: string
	model: string
	calls: number
	inputTokens: number
	outputTokens: number
	cost: number
}

export interface IUsage extends Document {
	planTitle: string
	totalCalls: number
	totalInputTokens: number
	totalOutputTokens: number
	totalCost: number
	breakdown: IUsageBreakdown[]
	createdAt: Date
}

const usageSchema = new Schema<IUsage>({
	planTitle: String,
	totalCalls: Number,
	totalInputTokens: Number,
	totalOutputTokens: Number,
	totalCost: Number,
	breakdown: [{ caller: String, model: String, calls: Number, inputTokens: Number, outputTokens: Number, cost: Number }],
}, { timestamps: { createdAt: true, updatedAt: false } })

export const UsageModel: Model<IUsage> =
	mongoose.models.Usage ?? mongoose.model<IUsage>('Usage', usageSchema)

export interface IIterationLog extends Document {
	entries: { timestamp: string; level: string; message: string; context?: Record<string, unknown> }[]
	createdAt: Date
}

const iterationLogSchema = new Schema<IIterationLog>({
	entries: [{
		timestamp: String,
		level: String,
		message: String,
		context: Schema.Types.Mixed,
	}],
}, { timestamps: { createdAt: true, updatedAt: false } })

export const IterationLogModel: Model<IIterationLog> =
	mongoose.models.IterationLog ?? mongoose.model<IIterationLog>('IterationLog', iterationLogSchema)
