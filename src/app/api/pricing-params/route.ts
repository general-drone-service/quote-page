import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase/client"
import { PRICING_PARAMS_DEFAULT, type PricingParams } from "@/lib/engines/pricing-params"

// ─── GET: Read active pricing params ─────────────────────────────────────────

export async function GET() {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from("pricing_params")
      .select("version, params, notes, created_at")
      .eq("is_active", true)
      .limit(1)
      .single()

    if (error || !data) {
      return NextResponse.json({
        params: PRICING_PARAMS_DEFAULT,
        source: "default",
      })
    }

    return NextResponse.json({
      params: { ...data.params as PricingParams, version: data.version },
      version: data.version,
      notes: data.notes,
      updated_at: data.created_at,
      source: "database",
    })
  } catch {
    return NextResponse.json({
      params: PRICING_PARAMS_DEFAULT,
      source: "default",
    })
  }
}

// ─── POST: Create a new pricing params version ──────────────────────────────

interface CreateBody {
  version: string
  params: PricingParams
  notes?: string
  created_by?: string
  activate?: boolean
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateBody

    if (!body.version || !body.params) {
      return NextResponse.json(
        { error: "Missing required fields: version, params" },
        { status: 400 },
      )
    }

    const supabase = getSupabaseAdmin()

    // If activating, deactivate all existing versions first
    if (body.activate !== false) {
      await supabase
        .from("pricing_params")
        .update({ is_active: false })
        .eq("is_active", true)
    }

    const { data, error } = await supabase
      .from("pricing_params")
      .insert({
        version: body.version,
        params: body.params,
        notes: body.notes ?? null,
        is_active: body.activate !== false,
        created_by: body.created_by ?? null,
      })
      .select()
      .single()

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `Version "${body.version}" already exists` },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, version: data.version })
  } catch (err) {
    console.error("pricing-params POST error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// ─── PUT: Activate an existing version ──────────────────────────────────────

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { version: string }

    if (!body.version) {
      return NextResponse.json({ error: "Missing version" }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    // Verify the version exists
    const { data: existing } = await supabase
      .from("pricing_params")
      .select("id")
      .eq("version", body.version)
      .single()

    if (!existing) {
      return NextResponse.json({ error: `Version "${body.version}" not found` }, { status: 404 })
    }

    // Deactivate all, then activate the requested version
    await supabase
      .from("pricing_params")
      .update({ is_active: false })
      .eq("is_active", true)

    await supabase
      .from("pricing_params")
      .update({ is_active: true })
      .eq("version", body.version)

    return NextResponse.json({ ok: true, active_version: body.version })
  } catch (err) {
    console.error("pricing-params PUT error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
