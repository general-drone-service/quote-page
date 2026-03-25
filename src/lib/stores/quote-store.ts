const STORAGE_KEY = "gds_quotes_v1"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuoteRecord {
  id: string
  quote_code: string
  client_name?: string
  address?: string
  building_name?: string
  floors: number
  total_area_m2: number
  total_ntd: number
  suggested_days: number
  created_at: string
}

// ─── Store API ────────────────────────────────────────────────────────────────

export function getQuotes(): QuoteRecord[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as QuoteRecord[]) : []
  } catch {
    return []
  }
}

export function saveQuote(record: Omit<QuoteRecord, "id" | "created_at">): QuoteRecord {
  const saved: QuoteRecord = {
    ...record,
    id: `QR-${Date.now().toString(36).toUpperCase()}`,
    created_at: new Date().toISOString(),
  }
  const all = getQuotes()
  all.unshift(saved)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch { /* quota exceeded */ }
  return saved
}
