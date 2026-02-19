import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { CurrencyProvider } from "@/lib/CurrencyProvider";
import { CurrencySelector } from "./CurrencySelector";
import { fetchRates } from "@/lib/currencies";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SeedWatch",
  description: "SeedGPT database viewer",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const savedCurrency = cookieStore.get("seedwatch-currency")?.value ?? "USD";
  const rates = await fetchRates();

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <CurrencyProvider initialCurrency={savedCurrency} initialRates={rates}>
          <nav className="border-b border-(--border) px-6 py-3 flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold tracking-tight text-(--accent)">
              SeedWatch
            </Link>
            <Link href="/" className="text-sm text-(--text-dim) hover:text-(--text)">
              Cycles
            </Link>
            <Link href="/memories" className="text-sm text-(--text-dim) hover:text-(--text)">
              Memories
            </Link>
            <Link href="/statistics" className="text-sm text-(--text-dim) hover:text-(--text)">
              Statistics
            </Link>
            <Link href="/search" className="text-sm text-(--text-dim) hover:text-(--text)">
              Search
            </Link>
            <CurrencySelector />
          </nav>
          <main className="max-w-7xl mx-auto px-6 py-6">
            {children}
          </main>
        </CurrencyProvider>
      </body>
    </html>
  );
}
