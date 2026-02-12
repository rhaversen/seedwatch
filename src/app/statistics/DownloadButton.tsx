'use client'

import { useState } from 'react'

export default function DownloadButton() {
	const [loading, setLoading] = useState(false)

	async function handleDownload() {
		setLoading(true)
		try {
			const res = await fetch('/api/statistics/markdown')
			if (!res.ok) throw new Error('Failed to generate markdown')
			const blob = await res.blob()
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1]
				?? `seedgpt-statistics-${new Date().toISOString().slice(0, 10)}.md`
			document.body.appendChild(a)
			a.click()
			a.remove()
			URL.revokeObjectURL(url)
		} catch (err) {
			console.error(err)
		} finally {
			setLoading(false)
		}
	}

	return (
		<button
			onClick={handleDownload}
			disabled={loading}
			className="px-4 py-1.5 text-sm font-medium rounded-lg border border-(--border) hover:bg-(--bg-hover) transition-colors disabled:opacity-50 cursor-pointer"
		>
			{loading ? 'Generating…' : '↓ Download .md'}
		</button>
	)
}
