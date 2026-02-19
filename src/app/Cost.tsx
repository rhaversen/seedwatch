'use client'

import { useCurrency } from '@/lib/CurrencyProvider'

export function Cost({ value }: { value: number }) {
	const { formatCost } = useCurrency()
	return <>{formatCost(value)}</>
}
