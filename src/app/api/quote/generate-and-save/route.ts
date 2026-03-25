import { NextResponse } from "next/server"
import { generateQuotePdf } from "@/lib/line/generate-quote-pdf"
import type { QuotePdfInput } from "@/lib/line/generate-quote-pdf"
import { getSupabaseAdmin } from "@/lib/supabase/client"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as QuotePdfInput

    // ── Validate required fields ───────────────────────────────────────────
    if (!body.pricing?.quote_code || !body.timeResult || !body.formData || !body.areaEstimate) {
      return NextResponse.json(
        { error: "Missing required fields: pricing, timeResult, formData, areaEstimate" },
        { status: 400 },
      )
    }

    const quoteCode = body.pricing.quote_code

    // ── Generate PDF ───────────────────────────────────────────────────────
    const pdfBuffer = generateQuotePdf(body)

    // ── Upload to Supabase Storage ─────────────────────────────────────────
    const supabase = getSupabaseAdmin()
    const pdfPath = `quotes/${quoteCode}.pdf`

    const { error: uploadError } = await supabase.storage
      .from("quote-pdfs")
      .upload(pdfPath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      })

    if (uploadError) {
      console.error("Supabase storage upload error:", uploadError)
      return NextResponse.json(
        { error: "Failed to upload PDF" },
        { status: 500 },
      )
    }

    // ── Get public URL ─────────────────────────────────────────────────────
    const { data: urlData } = supabase.storage
      .from("quote-pdfs")
      .getPublicUrl(pdfPath)

    const pdfUrl = urlData.publicUrl

    // ── Save quote record to DB ────────────────────────────────────────────
    const { error: dbError } = await supabase.from("quotes").upsert(
      {
        quote_code: quoteCode,
        form_data: body.formData,
        area_estimate: body.areaEstimate,
        building_name: body.buildingName ?? null,
        pricing: body.pricing,
        time_result: body.timeResult,
        pdf_url: pdfUrl,
        expires_at: body.pricing.valid_until,
      },
      { onConflict: "quote_code" },
    )

    if (dbError) {
      console.error("Supabase DB insert error:", dbError)
      // PDF is already uploaded, so we can still return success
      // The webhook can fall back to storage lookup
    }

    return NextResponse.json({
      quoteCode,
      pdfUrl,
    })
  } catch (err) {
    console.error("Quote generate-and-save error:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
