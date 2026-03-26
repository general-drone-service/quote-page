import { getLineClient } from "./client"
import { buildQuoteFlexBubble } from "./flex"
import { WELCOME_MESSAGE_ZH } from "./messages"
import type { QuoteSummary } from "./types"

/**
 * Reply to user with a Flex Message containing quote details and PDF download link.
 */
export async function replyQuotePdf(
  replyToken: string,
  summary: QuoteSummary,
): Promise<void> {
  const client = getLineClient()

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
 * Reply with a plain text message.
 */
export async function replyText(
  replyToken: string,
  text: string,
): Promise<void> {
  const client = getLineClient()

  await client.replyMessage({
    replyToken,
    messages: [{ type: "text", text }],
  })
}

/**
 * Push a welcome message when user follows the official account.
 */
export async function pushWelcomeMessage(userId: string): Promise<void> {
  const client = getLineClient()

  await client.pushMessage({
    to: userId,
    messages: [{ type: "text", text: WELCOME_MESSAGE_ZH }],
  })
}
