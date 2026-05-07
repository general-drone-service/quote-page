import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase/client"
import { PRICING_PARAMS_DEFAULT } from "@/lib/engines/pricing-params"
import type { CommuteResult } from "@/lib/types"

export const runtime = "nodejs"

interface RequestBody {
  destination_lat: number
  destination_lng: number
  work_days: number
}

export async function POST(request: Request) {
  let body: RequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!isFinite(body.destination_lat) || !isFinite(body.destination_lng) || body.work_days < 1) {
    return NextResponse.json({ error: "Invalid coordinates or work_days" }, { status: 400 })
  }

  const params = PRICING_PARAMS_DEFAULT

  // ── Try cache (rounded to 4 decimal ≈ 11 m precision) ─────────────────────
  const supabase = getSupabaseAdmin()
  const latRounded = Math.round(body.destination_lat * 10000) / 10000
  const lngRounded = Math.round(body.destination_lng * 10000) / 10000

  const { data: cached } = await supabase
    .from("commute_cache")
    .select("one_way_hours, google_response, created_at")
    .gte("expires_at", new Date().toISOString())
    .filter("destination_lat", "gte", latRounded - 0.0001)
    .filter("destination_lat", "lte", latRounded + 0.0001)
    .filter("destination_lng", "gte", lngRounded - 0.0001)
    .filter("destination_lng", "lte", lngRounded + 0.0001)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  let one_way_hours: number
  let cached_at: string | undefined
  let warning: string | undefined

  if (cached) {
    one_way_hours = Number(cached.one_way_hours)
    cached_at = cached.created_at as string
  } else {
    const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY
    if (!apiKey) {
      return mockResponse(body, params, "Missing GOOGLE_MAPS_SERVER_KEY")
    }

    const origin = `${params.commute_origin.lat},${params.commute_origin.lng}`
    const destination = `${body.destination_lat},${body.destination_lng}`
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json`
              + `?origins=${origin}&destinations=${destination}`
              + `&departure_time=now&traffic_model=best_guess&key=${apiKey}`

    let google: unknown
    try {
      const res = await fetch(url)
      google = await res.json()
    } catch (err) {
      console.error("Google Distance Matrix error:", err)
      return mockResponse(body, params, "Google API request failed")
    }

    const g = google as {
      status: string
      rows?: Array<{
        elements?: Array<{
          status: string
          duration?: { value: number }
          duration_in_traffic?: { value: number }
        }>
      }>
    }

    const element = g.rows?.[0]?.elements?.[0]
    if (g.status !== "OK" || !element || element.status !== "OK") {
      console.warn("Google Distance Matrix returned non-OK:", g.status, element?.status)
      return mockResponse(body, params, `Google API status: ${g.status}/${element?.status}`)
    }

    const seconds = element.duration_in_traffic?.value ?? element.duration?.value ?? 0
    one_way_hours = seconds / 3600

    await supabase.from("commute_cache").insert({
      destination_lat: latRounded,
      destination_lng: lngRounded,
      one_way_hours,
      google_response: g,
    })
  }

  // ── Compute fees ────────────────────────────────────────────────────────────
  const c = params.commute
  const isLodging = one_way_hours > c.lodging_threshold_hours
  const round_trip_fee = Math.round(one_way_hours * 2 * c.fee_per_hour)

  const result: CommuteResult = isLodging
    ? {
        mode: "lodging",
        one_way_hours,
        commute_fee: round_trip_fee,
        fuel_fee: 0,
        lodging_fee: c.lodging_per_day * body.work_days,
        origin_address: params.commute_origin.address,
        destination_address: `${body.destination_lat},${body.destination_lng}`,
        cached_at, warning,
      }
    : {
        mode: "daily",
        one_way_hours,
        commute_fee: round_trip_fee * body.work_days,
        fuel_fee: c.daily_fuel_fee * body.work_days,
        lodging_fee: 0,
        origin_address: params.commute_origin.address,
        destination_address: `${body.destination_lat},${body.destination_lng}`,
        cached_at, warning,
      }

  return NextResponse.json(result)
}

function mockResponse(body: RequestBody, params: typeof PRICING_PARAMS_DEFAULT, warning: string) {
  const c = params.commute
  const result: CommuteResult = {
    mode: "daily",
    one_way_hours: 1,
    commute_fee: 1 * 2 * c.fee_per_hour * body.work_days,
    fuel_fee: c.daily_fuel_fee * body.work_days,
    lodging_fee: 0,
    origin_address: params.commute_origin.address,
    destination_address: `${body.destination_lat},${body.destination_lng}`,
    warning,
  }
  return NextResponse.json(result)
}
