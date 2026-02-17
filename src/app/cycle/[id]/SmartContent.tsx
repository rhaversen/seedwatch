'use client'

import { useState, useMemo, Fragment } from 'react'

function tryParseJson(text: string): unknown | null {
	const trimmed = text.trim()
	if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null
	try {
		const parsed = JSON.parse(trimmed)
		if (typeof parsed === 'object' && parsed !== null) return parsed
	} catch { /* not json */ }
	return null
}

function isLikelyJson(text: string): boolean {
	return tryParseJson(text) !== null
}

function JsonHighlight({ json, maxDepth = 6, depth = 0 }: { json: unknown; maxDepth?: number; depth?: number }) {
	if (depth > maxDepth) return <span className="text-(--text-dim)">{JSON.stringify(json)}</span>

	if (json === null) return <span className="text-purple-400">null</span>
	if (typeof json === 'boolean') return <span className="text-purple-400">{String(json)}</span>
	if (typeof json === 'number') return <span className="text-cyan-400">{json}</span>

	if (typeof json === 'string') {
		if (json.length > 500) {
			return <span className="text-green-400">&quot;{json.slice(0, 500)}…&quot;</span>
		}
		return <span className="text-green-400">&quot;{json}&quot;</span>
	}

	if (Array.isArray(json)) {
		if (json.length === 0) return <span className="text-(--text-dim)">{'[]'}</span>
		const indent = '  '.repeat(depth + 1)
		const closeIndent = '  '.repeat(depth)
		return (
			<span>
				{'[\n'}
				{json.map((item, i) => (
					<Fragment key={i}>
						{indent}<JsonHighlight json={item} maxDepth={maxDepth} depth={depth + 1} />
						{i < json.length - 1 ? ',\n' : '\n'}
					</Fragment>
				))}
				{closeIndent}{']'}
			</span>
		)
	}

	if (typeof json === 'object') {
		const entries = Object.entries(json as Record<string, unknown>)
		if (entries.length === 0) return <span className="text-(--text-dim)">{'{}'}</span>
		const indent = '  '.repeat(depth + 1)
		const closeIndent = '  '.repeat(depth)
		return (
			<span>
				{'{\n'}
				{entries.map(([key, value], i) => (
					<Fragment key={key}>
						{indent}<span className="text-blue-400">&quot;{key}&quot;</span>: <JsonHighlight json={value} maxDepth={maxDepth} depth={depth + 1} />
						{i < entries.length - 1 ? ',\n' : '\n'}
					</Fragment>
				))}
				{closeIndent}{'}'}
			</span>
		)
	}

	return <span>{String(json)}</span>
}

function formatTextContent(text: string): string {
	return text
		.replace(/\\n/g, '\n')
		.replace(/\\t/g, '\t')
		.replace(/\\r/g, '\r')
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, '\\')
}

export function SmartContent({ text, className = '', maxHeight = '20rem' }: {
	text: string
	className?: string
	maxHeight?: string
}) {
	const [mode, setMode] = useState<'formatted' | 'raw'>('formatted')

	const jsonParsed = useMemo(() => tryParseJson(text), [text])
	const hasEscapes = useMemo(() => /\\[ntr"\\]/.test(text), [text])
	const formatted = useMemo(() => hasEscapes ? formatTextContent(text) : text, [text, hasEscapes])
	const hasFormatting = jsonParsed !== null || hasEscapes

	if (!hasFormatting) {
		return (
			<pre className={`text-xs whitespace-pre-wrap wrap-break-word font-mono ${className}`} style={{ maxHeight, overflow: 'auto' }}>
				{text}
			</pre>
		)
	}

	return (
		<div>
			<div className="flex justify-end mb-0.5">
				<button
					onClick={() => setMode(m => m === 'formatted' ? 'raw' : 'formatted')}
					className="text-[9px] text-(--text-dim) hover:text-(--text) transition-colors px-1 py-0.5 rounded hover:bg-(--bg-hover)"
				>
					{mode === 'formatted' ? 'raw' : 'formatted'}
				</button>
			</div>
			{mode === 'raw' ? (
				<pre className={`text-xs whitespace-pre-wrap wrap-break-word font-mono ${className}`} style={{ maxHeight, overflow: 'auto' }}>
					{text}
				</pre>
			) : jsonParsed !== null ? (
				<pre className={`text-xs whitespace-pre-wrap wrap-break-word font-mono ${className}`} style={{ maxHeight, overflow: 'auto' }}>
					<JsonHighlight json={jsonParsed} />
				</pre>
			) : (
				<pre className={`text-xs whitespace-pre-wrap wrap-break-word font-mono ${className}`} style={{ maxHeight, overflow: 'auto' }}>
					{formatted}
				</pre>
			)}
		</div>
	)
}
