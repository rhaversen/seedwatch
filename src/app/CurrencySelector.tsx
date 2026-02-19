'use client'

import { useState, useRef, useEffect } from 'react'
import { useCurrency } from '@/lib/CurrencyProvider'
import { CURRENCIES } from '@/lib/currencies'

export function CurrencySelector() {
	const { currency, setCurrency } = useCurrency()
	const [open, setOpen] = useState(false)
	const [search, setSearch] = useState('')
	const ref = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
		}
		document.addEventListener('mousedown', handleClick)
		return () => document.removeEventListener('mousedown', handleClick)
	}, [])

	useEffect(() => {
		if (open) {
			setTimeout(() => inputRef.current?.focus(), 0)
		}
	}, [open])

	function toggle() {
		setSearch('')
		setOpen(v => !v)
	}

	const filtered = CURRENCIES.filter(c =>
		c.code.toLowerCase().includes(search.toLowerCase()) ||
		c.name.toLowerCase().includes(search.toLowerCase())
	)

	return (
		<div ref={ref} className="relative ml-auto">
			<button
				onClick={() => toggle()}
				className="text-sm text-(--text-dim) hover:text-(--text) px-2 py-1 rounded border border-(--border) hover:bg-(--bg-hover) transition-colors cursor-pointer"
			>
				{currency}
			</button>
			{open && (
				<div className="absolute right-0 top-full mt-1 w-64 bg-(--bg-card) border border-(--border) rounded-lg shadow-xl z-50 overflow-hidden">
					<div className="p-2 border-b border-(--border)">
						<input
							ref={inputRef}
							type="text"
							value={search}
							onChange={e => setSearch(e.target.value)}
							placeholder="Search currencies..."
							className="w-full bg-transparent text-sm text-(--text) placeholder:text-(--text-dim) outline-none"
						/>
					</div>
					<div className="max-h-64 overflow-y-auto seedwatch-scrollbar">
						{filtered.map(c => (
							<button
								key={c.code}
								onClick={() => { setCurrency(c.code); setOpen(false) }}
								className={`w-full text-left px-3 py-2 text-sm hover:bg-(--bg-hover) flex items-center gap-2 cursor-pointer ${c.code === currency ? 'text-(--accent)' : 'text-(--text)'}`}
							>
								<span className="font-mono w-10">{c.code}</span>
								<span className="text-(--text-dim)">{c.name}</span>
								<span className="ml-auto text-(--text-dim)">{c.symbol}</span>
							</button>
						))}
						{filtered.length === 0 && (
							<div className="px-3 py-4 text-sm text-(--text-dim) text-center">No currencies found</div>
						)}
					</div>
				</div>
			)}
		</div>
	)
}
