import { NextResponse } from "next/server"
import { generateQuotePdf } from "@/lib/pdf"
import type { QuotePdfInput } from "@/lib/pdf"
import { getSupabaseAdmin } from "@/lib/supabase/client"
import { getCrmAdmin } from "@/lib/supabase/crm"
import { buildAdLead } from "@/lib/attribution"

/**
 * Best-effort mirror of a paid-ad quote lead into the shared CRM `ad_leads`.
 * NEVER throws — CRM down or env missing only logs; the quote itself is unaffected.
 */
async function mirrorAdLead(
  adSearch: string | undefined,
  landingPath: string | undefined,
  formData: QuotePdfInput["formData"] | undefined,
): Promise<void> {
  try {
    const adLead = buildAdLead(adSearch || "", landingPath || null, {
      name: formData?.clientName ?? null,
      address: formData?.address ?? null,
    })
    if (!adLead) return // organic — nothing to attribute

    const crm = getCrmAdmin()
    if (!crm) return // CRM env not configured

    const { error } = await crm.from("ad_leads").insert(adLead)
    // 23505 = duplicate click id (already mirrored) → benign
    if (error && error.code !== "23505") {
      console.error("ad_leads mirror failed:", { code: error.code, message: error.message })
    }
  } catch (err) {
    console.error("ad_leads mirror threw:", err)
  }
}

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as QuotePdfInput & {
      adSearch?: string
      landingPath?: string
    }

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

    // ── Best-effort mirror to shared CRM ad_leads (never blocks the quote) ──
    await mirrorAdLead(body.adSearch, body.landingPath, body.formData)

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
