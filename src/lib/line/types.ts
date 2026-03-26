export interface QuoteSummary {
  quoteCode: string
  totalNtd: number
  suggestedDays: number
  pdfUrl: string
  validUntil: string
}

export interface LineEvent {
  type: string
  replyToken?: string
  source?: { type: string; userId?: string }
  message?: { type: string; text?: string }
}

export interface LineWebhookBody {
  events: LineEvent[]
}
