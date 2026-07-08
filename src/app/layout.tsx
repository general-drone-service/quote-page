import type { Metadata } from "next"
import "./globals.css"
import { AdCapture } from "./components/AdCapture"

const title = "GDS 快速報價 — 低空外牆作業"
const description =
  "無人機外牆清洗與外牆檢測快速報價工具，輸入建物樓層、面積、位置等基本資訊，即可即時估算作業費用與預估工期，協助合作夥伴快速掌握報價區間。由一般無人機服務股份有限公司 Drone168 提供，服務範圍涵蓋全台高空建築外牆清洗、防水塗料翻新與紅外線熱像檢測。"
const ogImage = "https://www.drone168.com/media/home/professional-cleaning-drone.jpg"

export const metadata: Metadata = {
  metadataBase: new URL("https://quote.drone168.com"),
  title,
  description,
  alternates: {
    canonical: "https://quote.drone168.com",
  },
  openGraph: {
    title,
    description,
    url: "https://quote.drone168.com",
    siteName: "General Drone Service",
    locale: "zh_TW",
    type: "website",
    images: [ogImage],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [ogImage],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <body className="antialiased font-sans">
        <AdCapture />
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
          <footer className="border-t border-zinc-200 bg-white">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 text-xs text-zinc-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <a
                href="https://www.drone168.com"
                className="text-zinc-600 hover:text-zinc-900 underline underline-offset-2"
              >
                一般無人機服務股份有限公司 · 官方網站
              </a>
              <p>&copy; {new Date().getFullYear()} General Drone Service. All rights reserved.</p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
