import { NextResponse } from "next/server"
import { verifyLineSignature } from "@/lib/line/signature"
import { replyQuotePdf, replyText, pushWelcomeMessage } from "@/lib/line/send"
import { buildQuoteNotFoundMessageZh } from "@/lib/line/messages"
import type { LineEvent, LineWebhookBody } from "@/lib/line/types"
import { getSupabaseAdmin } from "@/lib/supabase/client"
import { extractQuoteCode } from "@/lib/quote/lookup"

export const runtime = "nodejs"

// ─── POST handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()

    const signature = request.headers.get("x-line-signature")
    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 401 })
    }

    try {
      if (!verifyLineSignature(rawBody, signature)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
      }
    } catch {
      console.warn("LINE signature verification skipped (missing secret?)")
    }

    const body = JSON.parse(rawBody) as LineWebhookBody

    for (const event of body.events) {
      if (event.type === "follow" && event.source?.userId) {
        await handleFollow(event.source.userId)
      } else if (
        event.type === "message" &&
        event.message?.type === "text" &&
        event.message.text &&
        event.replyToken
      ) {
        await handleTextMessage(event.replyToken, event.message.text)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("LINE webhook error:", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

// ─── Event handlers ──────────────────────────────────────────────────────────

async function handleFollow(userId: string) {
  try {
    await pushWelcomeMessage(userId)
  } catch (err) {
    console.error("Failed to send welcome message:", err)
  }
}

async function handleTextMessage(replyToken: string, text: string) {
  const quoteCode = extractQuoteCode(text)
  if (!quoteCode) return

  try {
    const supabase = getSupabaseAdmin()

    const { data: quote, error } = await supabase
      .from("quotes")
      .select("quote_code, pricing, time_result, expires_at, pdf_url")
      .eq("quote_code", quoteCode)
      .maybeSingle()

    if (error || !quote) {
      await replyText(replyToken, buildQuoteNotFoundMessageZh(quoteCode))
      return
    }

    const pricing = quote.pricing as { total: number; valid_until: string }
    const timeResult = quote.time_result as { suggested_days: number }

    await replyQuotePdf(replyToken, {
      quoteCode: quote.quote_code as string,
      totalNtd: pricing.total,
      suggestedDays: timeResult.suggested_days,
      pdfUrl: quote.pdf_url as string,
      validUntil: (quote.expires_at as string) ?? pricing.valid_until,
    })
  } catch (err) {
    console.error(`Failed to handle quote ${quoteCode}:`, err)
  }
}
