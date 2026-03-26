import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase/client"
import { extractQuoteCode, normalizeQuoteCode } from "@/lib/quote/lookup"
import { getQuoteAppOrigin } from "@/lib/quote/public-url"

export const runtime = "nodejs"

type LookupPayload = {
  quoteCode?: string
  message?: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as LookupPayload

    const fromQuoteCode = body.quoteCode ? normalizeQuoteCode(body.quoteCode) : null
    const fromMessage = body.message ? extractQuoteCode(body.message) : null
    const quoteCode = fromQuoteCode ?? fromMessage

    if (!quoteCode) {
      const recreateQuoteUrl = getQuoteAppOrigin()
      return NextResponse.json(
        {
          error: "Missing quote code. Provide quoteCode or message containing Q-YYYYMMDD-XXX.",
          found: false,
          recreateQuoteUrl,
          messageZh: `請確認編號是否正確，或至 ${recreateQuoteUrl} 重新取得報價。`,
        },
        { status: 400 },
      )
    }

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from("quotes")
      .select("quote_code,pdf_url,pricing,time_result,expires_at,created_at")
      .eq("quote_code", quoteCode)
      .maybeSingle()

    if (error) {
      console.error("Quote lookup DB error:", error)
      return NextResponse.json({ error: "Quote lookup failed" }, { status: 500 })
    }

    if (!data) {
      const recreateQuoteUrl = getQuoteAppOrigin()
      return NextResponse.json(
        {
          found: false,
          quoteCode,
          recreateQuoteUrl,
          messageZh: `找不到報價單 ${quoteCode} 😕\n\n請確認編號是否正確，或至 ${recreateQuoteUrl} 重新取得報價。`,
          error: `Quote not found: ${quoteCode}`,
        },
        { status: 404 },
      )
    }

    const pricing = data.pricing as { total?: number; valid_until?: string } | null
    const timeResult = data.time_result as { suggested_days?: number } | null

    return NextResponse.json({
      found: true,
      quoteCode: data.quote_code,
      pdfUrl: data.pdf_url,
      totalNtd: pricing?.total ?? null,
      suggestedDays: timeResult?.suggested_days ?? null,
      expiresAt: data.expires_at,
      createdAt: data.created_at,
    })
  } catch (err) {
    console.error("Quote lookup error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
