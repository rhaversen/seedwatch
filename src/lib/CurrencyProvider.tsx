'use client'

import { createContext, useContext, useState, useCallback, useMemo } from 'react'

interface CurrencyContextValue {
	currency: string
	setCurrency: (code: string) => void
	formatCost: (usdValue: number) => string
}

const CurrencyContext = createContext<CurrencyContextValue>({
	currency: 'USD',
	setCurrency: () => {},
	formatCost: (n) => {
		if (n >= 0.01) return `$${n.toFixed(4)}`
		return `$${n.toFixed(6)}`
	},
})

export const useCurrency = () => useContext(CurrencyContext)

export function CurrencyProvider({
	children,
	initialCurrency = 'USD',
	initialRates = {},
}: {
	children: React.ReactNode
	initialCurrency?: string
	initialRates?: Record<string, number>
}) {
	const [currency, setCurrencyState] = useState(initialCurrency)
	const [rates] = useState(initialRates)

	const setCurrency = useCallback((code: string) => {
		setCurrencyState(code)
		document.cookie = `seedwatch-currency=${encodeURIComponent(code)};path=/;max-age=${365 * 86400};SameSite=Lax`
	}, [])

	const formatCost = useCallback((usdValue: number): string => {
		const rate = currency === 'USD' ? 1 : (rates[currency.toLowerCase()] ?? 1)
		const converted = usdValue * rate
		const digits = Math.abs(converted) >= 0.01 ? 4 : 6
		try {
			return new Intl.NumberFormat('en-US', {
				style: 'currency',
				currency,
				minimumFractionDigits: 2,
				maximumFractionDigits: digits,
			}).format(converted)
		} catch {
			return `${converted.toFixed(digits)} ${currency}`
		}
	}, [currency, rates])

	const value = useMemo(() => ({ currency, setCurrency, formatCost }), [currency, setCurrency, formatCost])

	return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}
