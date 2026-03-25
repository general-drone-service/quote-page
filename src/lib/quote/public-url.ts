/**
 * Public base URL for the quote app (LINE / 錯誤訊息用).
 * Override with NEXT_PUBLIC_QUOTE_APP_URL in deployment.
 */
export function getQuoteAppOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_QUOTE_APP_URL?.trim()
  if (raw) {
    try {
      return new URL(raw).origin
    } catch {
      /* fall through */
    }
  }
  return "https://quote.drone168.com"
}

export function buildQuoteNotFoundMessageZh(quoteCode: string): string {
  const base = getQuoteAppOrigin()
  return `找不到報價單 ${quoteCode} 😕\n\n請確認編號是否正確，或至 ${base} 重新取得報價。`
}

export function buildMissingQuoteCodeMessageZh(): string {
  const base = getQuoteAppOrigin()
  return `請確認編號是否正確，或至 ${base} 重新取得報價。`
}
