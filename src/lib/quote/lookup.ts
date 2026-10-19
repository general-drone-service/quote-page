export function normalizeQuoteCode(input: string): string {
  return input.trim().toUpperCase()
}

/**
 * Extracts quote code from raw user text.
 * Supports messages such as "我要報價單 Q-20260325-858 😕".
 */
export function extractQuoteCode(raw: string): string | null {
  const normalized = normalizeQuoteCode(raw)
  const match = normalized.match(/\bQ-\d{8}-\d+\b/)
  return match ? match[0] : null
}

const QUOTE_CODE = /^Q-\d{8}-\d{3}$/

/** Codes the wizard generates: Q-YYYYMMDD-NNN with NNN in 100–999. */
export function isQuoteCode(code: string): boolean {
  return QUOTE_CODE.test(code)
}

/** Same date, new random suffix: used when another quote already holds the code. */
export function rerollQuoteCode(code: string): string {
  return `${code.slice(0, 11)}${crypto.getRandomValues(new Uint32Array(1))[0] % 900 + 100}`
}
