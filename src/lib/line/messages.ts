import { getQuoteAppOrigin } from "@/lib/quote/public-url"

/** Welcome message sent when a user follows the OA */
export const WELCOME_MESSAGE_ZH =
  "歡迎加入 GDS 低空作業官方帳號！🚁\n\n" +
  "如需取得報價單，請在網站完成報價後，\n" +
  "點擊「透過 LINE 取得報價單」按鈕即可。\n\n" +
  "您也可以直接傳送報價編號（如 Q-20260323-456）查詢報價單。"

export function buildQuoteNotFoundMessageZh(quoteCode: string): string {
  const base = getQuoteAppOrigin()
  return `找不到報價單 ${quoteCode} 😕\n\n請確認編號是否正確，或至 ${base} 重新取得報價。`
}

export function buildMissingQuoteCodeMessageZh(): string {
  const base = getQuoteAppOrigin()
  return `請確認編號是否正確，或至 ${base} 重新取得報價。`
}
