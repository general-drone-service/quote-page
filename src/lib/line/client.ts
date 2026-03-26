import { messagingApi } from "@line/bot-sdk"

// ─── Client singleton ────────────────────────────────────────────────────────

let _client: messagingApi.MessagingApiClient | null = null

export function getLineClient(): messagingApi.MessagingApiClient {
  if (_client) return _client
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN")
  _client = new messagingApi.MessagingApiClient({ channelAccessToken: token })
  return _client
}
