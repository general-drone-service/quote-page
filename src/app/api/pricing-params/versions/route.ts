import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase/client"

export async function GET() {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from("pricing_params")
      .select("version, params, notes, is_active, created_by, created_at")
      .order("created_at", { ascending: false })

    if (error) {
      return NextResponse.json({ versions: [] })
    }

    return NextResponse.json({ versions: data })
  } catch {
    return NextResponse.json({ versions: [] })
  }
}
