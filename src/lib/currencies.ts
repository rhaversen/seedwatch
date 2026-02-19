export interface Currency {
	code: string
	name: string
	symbol: string
}

export const CURRENCIES: Currency[] = [
	{ code: 'USD', name: 'US Dollar', symbol: '$' },
	{ code: 'EUR', name: 'Euro', symbol: '€' },
	{ code: 'GBP', name: 'British Pound', symbol: '£' },
	{ code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
	{ code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$' },
	{ code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
	{ code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
	{ code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
	{ code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
	{ code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
	{ code: 'KRW', name: 'South Korean Won', symbol: '₩' },
	{ code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
	{ code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
	{ code: 'MXN', name: 'Mexican Peso', symbol: 'MX$' },
	{ code: 'INR', name: 'Indian Rupee', symbol: '₹' },
	{ code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
	{ code: 'ZAR', name: 'South African Rand', symbol: 'R' },
	{ code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
	{ code: 'PLN', name: 'Polish Złoty', symbol: 'zł' },
	{ code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$' },
	{ code: 'THB', name: 'Thai Baht', symbol: '฿' },
	{ code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
	{ code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
	{ code: 'ILS', name: 'Israeli Shekel', symbol: '₪' },
	{ code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
	{ code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
	{ code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
	{ code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' },
	{ code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
	{ code: 'RON', name: 'Romanian Leu', symbol: 'lei' },
	{ code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft' },
	{ code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
	{ code: 'ISK', name: 'Icelandic Króna', symbol: 'kr' },
]

export async function fetchRates(): Promise<Record<string, number>> {
	try {
		const res = await fetch('https://latest.currency-api.pages.dev/v1/currencies/usd.json', {
			next: { revalidate: 3600 },
		})
		const data = await res.json()
		return data.usd ?? {}
	} catch {
		return {}
	}
}
