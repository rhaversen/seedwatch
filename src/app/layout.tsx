import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
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
        </nav>
        <main className="max-w-7xl mx-auto px-6 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
