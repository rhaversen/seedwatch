import mongoose, { type Document, type Model, Schema } from 'mongoose'

export interface IGenerated extends Document {
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
	createdAt: Date
}

const generatedSchema = new Schema<IGenerated>({
	phase: String,
	modelId: String,
	iterationId: { type: String, default: '' },
	system: Schema.Types.Mixed,
	messages: Schema.Types.Mixed,
	response: Schema.Types.Mixed,
	inputTokens: Number,
	outputTokens: Number,
	cacheWrite5mTokens: { type: Number, default: 0 },
	cacheWrite1hTokens: { type: Number, default: 0 },
	cacheReadTokens: { type: Number, default: 0 },
	cost: Number,
	batch: { type: Boolean, default: false },
	stopReason: String,
}, { timestamps: { createdAt: true, updatedAt: false } })

export const GeneratedModel: Model<IGenerated> =
	mongoose.models.Generated ?? mongoose.model<IGenerated>('Generated', generatedSchema)

export type MemoryCategory = 'note' | 'reflection'

export interface IMemory extends Document {
	content: string
	summary: string
	category: MemoryCategory
	active: boolean
	createdAt: Date
	updatedAt: Date
}

const memorySchema = new Schema<IMemory>({
	content: String,
	summary: String,
	category: { type: String, enum: ['note', 'reflection'], required: true },
	active: { type: Boolean, default: true },
}, { timestamps: true })

export const MemoryModel: Model<IMemory> =
	mongoose.models.Memory ?? mongoose.model<IMemory>('Memory', memorySchema)

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
