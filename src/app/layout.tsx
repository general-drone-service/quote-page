import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "GDS 快速報價 — 低空外牆作業",
  description: "合作夥伴快速報價工具 — quote.drone168.com",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <body className="antialiased font-sans">
        <div className="min-h-screen bg-white text-zinc-800 font-sans">
          {/* Standalone header */}
          <header className="border-b border-zinc-200 bg-white sticky top-0 z-50">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
                G
              </div>
              <div>
                <h1 className="text-lg font-semibold text-zinc-900">GDS 快速報價</h1>
                <p className="text-xs text-zinc-500">低空外牆作業估算工具</p>
              </div>
            </div>
          </header>
          <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
