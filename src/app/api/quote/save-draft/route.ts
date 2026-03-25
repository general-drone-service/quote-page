import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase/client"

export const runtime = "nodejs"

interface SaveDraftBody {
  /** Unique session id — generated once per wizard session on the client */
  session_id: string
  /** Current wizard step (0, 1, 2) */
  step: number
  /** All form data collected so far */
  form_data: Record<string, unknown>
  /** Area estimate (set after Step 2) */
  area_estimate?: Record<string, unknown> | null
  /** Building polygon vertices from Overpass or manual draw */
  building_polygon?: { lat: number; lon: number }[] | null
  /** Base64 PNG of the map screenshot (set after polygon draw) */
  map_screenshot_base64?: string | null
  /** Building name (auto-detected or user-entered) */
  building_name?: string | null
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SaveDraftBody

    if (!body.session_id) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    // Upload map screenshot to storage if provided
    let mapScreenshotUrl: string | null = null
    if (body.map_screenshot_base64) {
      const buffer = Buffer.from(body.map_screenshot_base64, "base64")
      const path = `quote-drafts/${body.session_id}/map.png`

      const { error: uploadErr } = await supabase.storage
        .from("quote-pdfs")
        .upload(path, buffer, {
          contentType: "image/png",
          upsert: true,
        })

      if (!uploadErr) {
        const { data: urlData } = supabase.storage
          .from("quote-pdfs")
          .getPublicUrl(path)
        mapScreenshotUrl = urlData.publicUrl
      }
    }

    // Upsert draft record
    const { error: dbError } = await supabase.from("quote_drafts").upsert(
      {
        session_id: body.session_id,
        step: body.step,
        form_data: body.form_data,
        area_estimate: body.area_estimate ?? null,
        building_polygon: body.building_polygon ?? null,
        building_name: body.building_name ?? null,
        map_screenshot_url: mapScreenshotUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id" },
    )

    if (dbError) {
      console.error("Supabase quote_drafts upsert error:", dbError)
      return NextResponse.json({ error: "Failed to save draft" }, { status: 500 })
    }

    return NextResponse.json({ ok: true, session_id: body.session_id })
  } catch (err) {
    console.error("Quote save-draft error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
