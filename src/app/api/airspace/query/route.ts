// ─── GET /api/airspace/query?lat=<lat>&lng=<lng> ─────────────────────────────
//
// Returns airspace status for a given coordinate using bundled static
// Taiwan zone definitions. No external API calls — zero runtime cost.
//
// Design rationale: dronegis.caa.gov.tw (ArcGIS Enterprise) is geofenced
// to Taiwan IPs and has no public API. Static zones cover all civilian
// airports + key restricted areas from CAA announcements (民用航空法 §99-13).

import { NextResponse } from "next/server"
import { queryAirspaceByCoords } from "@/lib/engines/airspace-zones"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lat = parseFloat(searchParams.get("lat") ?? "")
  const lng = parseFloat(searchParams.get("lng") ?? "")

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "Missing or invalid lat/lng" }, { status: 400 })
  }

  // Sanity check: Taiwan bounding box (roughly)
  // Lat: 21°N – 26.5°N, Lng: 118°E – 122.5°E
  if (lat < 20 || lat > 27 || lng < 117 || lng > 123) {
    return NextResponse.json({ error: "Coordinates outside Taiwan bounds" }, { status: 400 })
  }

  const result = queryAirspaceByCoords(lat, lng)
  return NextResponse.json(result)
}
