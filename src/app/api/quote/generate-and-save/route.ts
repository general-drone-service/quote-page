import { NextResponse } from "next/server"
import { generateQuotePdf } from "@/lib/pdf"
import type { QuotePdfInput } from "@/lib/pdf"
import { getSupabaseAdmin } from "@/lib/supabase/client"
import { getCrmAdmin } from "@/lib/supabase/crm"
import { buildAdLead } from "@/lib/attribution"
import { isQuoteCode, rerollQuoteCode } from "@/lib/quote/lookup"

const MAX_CODE_ATTEMPTS = 5

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

    if (!isQuoteCode(body.pricing.quote_code)) {
      return NextResponse.json({ error: "Invalid quote code" }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    // ── Claim the quote code ───────────────────────────────────────────────
    // Only 900 codes per day: insert (never upsert) so a collision picks a new
    // suffix instead of overwriting another customer's quote.
    let quoteCode = body.pricing.quote_code
    let claimed = false
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !claimed; attempt++) {
      if (attempt > 0) quoteCode = rerollQuoteCode(quoteCode)
      const { error } = await supabase.from("quotes").insert({
        quote_code: quoteCode,
        form_data: body.formData,
        area_estimate: body.areaEstimate,
        building_name: body.buildingName ?? null,
        pricing: { ...body.pricing, quote_code: quoteCode },
        time_result: body.timeResult,
        expires_at: body.pricing.valid_until,
      })
      if (!error) claimed = true
      else if (error.code !== "23505") {
        console.error("Supabase DB insert error:", error)
        return NextResponse.json({ error: "Failed to save quote" }, { status: 500 })
      }
    }
    if (!claimed) {
      console.error("Quote code collisions exhausted for", body.pricing.quote_code.slice(0, 10))
      return NextResponse.json({ error: "Failed to save quote" }, { status: 503 })
    }

    // From here on any failure must give the code back: a quote row without a PDF
    // would make the LINE reply fail, and a stray file stays publicly readable
    let pdfPath: string | null = null
    let pdfUrl: string
    try {
      // ── Generate PDF ─────────────────────────────────────────────────────
      const pdfBuffer = generateQuotePdf({ ...body, pricing: { ...body.pricing, quote_code: quoteCode } })

      // ── Upload to Supabase Storage ───────────────────────────────────────
      // Random file name: the bucket is public, so a path derived from the code alone could be guessed
      const path = `quotes/${quoteCode}-${crypto.randomUUID()}.pdf`
      // Set before the upload: a failed response does not prove the file was not stored
      pdfPath = path
      const { error: uploadError } = await supabase.storage
        .from("quote-pdfs")
        .upload(path, pdfBuffer, { contentType: "application/pdf" })
      if (uploadError) throw new Error(`PDF upload failed: ${uploadError.message}`)

      // ── Get public URL ───────────────────────────────────────────────────
      pdfUrl = supabase.storage.from("quote-pdfs").getPublicUrl(path).data.publicUrl

      const { error: dbError } = await supabase.from("quotes").update({ pdf_url: pdfUrl }).eq("quote_code", quoteCode)
      if (dbError) throw new Error(`pdf_url update failed: ${dbError.message}`)
    } catch (err) {
      console.error("Quote generate-and-save failed after claiming", quoteCode, err)
      const { error: deleteError } = await supabase.from("quotes").delete().eq("quote_code", quoteCode)
      if (deleteError) console.error("Failed to release quote code", quoteCode, deleteError)
      if (pdfPath) {
        const { error: removeError } = await supabase.storage.from("quote-pdfs").remove([pdfPath])
        if (removeError) console.error("Failed to remove orphan PDF", pdfPath, removeError)
      }
      return NextResponse.json({ error: "Failed to save quote" }, { status: 500 })
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
