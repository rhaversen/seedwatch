import mongoose from 'mongoose'

const MONGODB_URI = process.env.MONGODB_URI

let cached = (global as Record<string, unknown>).__mongoose as {
	conn: typeof mongoose | null
	promise: Promise<typeof mongoose> | null
} | undefined

if (!cached) {
	cached = { conn: null, promise: null }
	;(global as Record<string, unknown>).__mongoose = cached
}

export async function connectDB(): Promise<typeof mongoose> {
	if (!MONGODB_URI) {
		throw new Error('MONGODB_URI is not set — add it to seedwatch/.env.local')
	}

	if (cached!.conn) return cached!.conn

	if (!cached!.promise) {
		cached!.promise = mongoose.connect(MONGODB_URI)
	}

	cached!.conn = await cached!.promise
	return cached!.conn
}
