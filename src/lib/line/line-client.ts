import { messagingApi } from "@line/bot-sdk"
import crypto from "node:crypto"

// ─── Client singleton ────────────────────────────────────────────────────────

let _client: messagingApi.MessagingApiClient | null = null

function getClient(): messagingApi.MessagingApiClient {
  if (_client) return _client
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN")
  _client = new messagingApi.MessagingApiClient({ channelAccessToken: token })
  return _client
}

// ─── Webhook signature verification ──────────────────────────────────────────

export function verifyLineSignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET
  if (!secret) throw new Error("Missing LINE_CHANNEL_SECRET")
  const hmac = crypto.createHmac("SHA256", secret)
  hmac.update(body)
  const expected = hmac.digest("base64")
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  )
}

// ─── Push quote via LINE ─────────────────────────────────────────────────────

interface QuoteSummary {
  quoteCode: string
  totalNtd: number
  suggestedDays: number
  pdfUrl: string
  validUntil: string
}

/**
 * Reply to user with a text summary + Flex Message containing PDF download link.
 */
export async function replyQuotePdf(
  replyToken: string,
  summary: QuoteSummary,
): Promise<void> {
  const client = getClient()

  await client.replyMessage({
    replyToken,
    messages: [
      {
        type: "flex",
        altText: `您的報價單 ${summary.quoteCode} — NTD ${summary.totalNtd.toLocaleString()}`,
        contents: buildQuoteFlexBubble(summary),
      },
    ],
  })
}

/**
 * Push a welcome message when user follows the official account.
 */
export async function pushWelcomeMessage(userId: string): Promise<void> {
  const client = getClient()

  await client.pushMessage({
    to: userId,
    messages: [
      {
        type: "text",
        text:
          "歡迎加入 GDS 低空作業官方帳號！🚁\n\n" +
          "如需取得報價單，請在網站完成報價後，\n" +
          "點擊「透過 LINE 取得報價單」按鈕即可。\n\n" +
          "您也可以直接傳送報價編號（如 Q-20260323-456）查詢報價單。",
      },
    ],
  })
}

// ─── Flex Message builder ────────────────────────────────────────────────────

function buildQuoteFlexBubble(summary: QuoteSummary): messagingApi.FlexBubble {
  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#27272A",
      paddingAll: "16px",
      contents: [
        {
          type: "text",
          text: "GDS 低空作業報價單",
          color: "#FFFFFF",
          weight: "bold",
          size: "md",
        },
        {
          type: "text",
          text: summary.quoteCode,
          color: "#A1A1AA",
          size: "xs",
          margin: "sm",
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "16px",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: "報價總額",
              color: "#71717A",
              size: "sm",
              flex: 1,
            },
            {
              type: "text",
              text: `NTD ${summary.totalNtd.toLocaleString()}`,
              color: "#2563EB",
              weight: "bold",
              size: "lg",
              flex: 2,
              align: "end",
            },
          ],
        },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: "預估工期",
              color: "#71717A",
              size: "sm",
              flex: 1,
            },
            {
              type: "text",
              text: `${summary.suggestedDays} 天`,
              color: "#18181B",
              weight: "bold",
              size: "md",
              flex: 2,
              align: "end",
            },
          ],
        },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: "有效至",
              color: "#71717A",
              size: "xs",
              flex: 1,
            },
            {
              type: "text",
              text: summary.validUntil,
              color: "#71717A",
              size: "xs",
              flex: 2,
              align: "end",
            },
          ],
        },
        {
          type: "separator",
          margin: "md",
        },
        {
          type: "text",
          text: "⚠️ 本報價為快速估算，正式報價需現場勘查確認。",
          color: "#92400E",
          size: "xxs",
          wrap: true,
          margin: "md",
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      contents: [
        {
          type: "button",
          action: {
            type: "uri",
            label: "下載報價單 PDF",
            uri: summary.pdfUrl,
          },
          style: "primary",
          color: "#2563EB",
        },
      ],
    },
  }
}
