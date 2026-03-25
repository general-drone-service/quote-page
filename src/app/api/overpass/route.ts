// ─── GET /api/overpass?lat=...&lng=... ────────────────────────────────────────
//
// Proxy to Overpass API to fetch building footprints near a coordinate.
// Returns:
//   - geometry: polygon points
//   - dimensions: MBR width/depth and per-side lengths (more accurate than perimeter/N)
//   - name/address from OSM tags when available

import { NextResponse } from "next/server"

const OVERPASS_URL = "https://overpass-api.de/api/interpreter"

// ─── Minimum Bounding Rectangle (MBR) via rotating edge method ───────────────
//
// For each edge of the polygon, we rotate the point cloud to align with that
// edge, then compute the axis-aligned bounding box. The rotation with minimum
// perimeter gives the true building orientation and dimensions.

interface Dimensions {
  width_m: number    // longer side
  depth_m: number    // shorter side
  sides_m: number[]  // [w, d, w, d] for 4-sided; generalised for N facades
  angle_deg: number  // building orientation (degrees from north)
}

function computeMBR(polygon: { lat: number; lon: number }[]): Dimensions {
  if (polygon.length < 3) return { width_m: 0, depth_m: 0, sides_m: [], angle_deg: 0 }

  // Convert to local Cartesian (meters) with the first point as origin
  const latRef = polygon[0].lat
  const lonRef = polygon[0].lon
  const latScale = 111_320                                       // m per degree lat
  const lonScale = 111_320 * Math.cos(latRef * Math.PI / 180)   // m per degree lon

  const pts = polygon.map(p => ({
    x: (p.lon - lonRef) * lonScale,
    y: (p.lat - latRef) * latScale,
  }))

  // Edge directions (skip closing edge if polygon is closed)
  const edges: { angle: number; len: number }[] = []
  const n = pts.length
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x
    const dy = pts[i + 1].y - pts[i].y
    const len = Math.hypot(dx, dy)
    if (len < 0.5) continue
    edges.push({ angle: Math.atan2(dy, dx), len })
  }
  if (edges.length === 0) return { width_m: 0, depth_m: 0, sides_m: [], angle_deg: 0 }

  // Try rotating to each edge direction and find minimum-perimeter bounding box
  let bestWidth = Infinity, bestDepth = Infinity, bestAngle = 0

  for (const edge of edges) {
    const cos = Math.cos(-edge.angle)
    const sin = Math.sin(-edge.angle)
    const rotated = pts.map(p => ({
      x: p.x * cos - p.y * sin,
      y: p.x * sin + p.y * cos,
    }))
    const xs = rotated.map(p => p.x)
    const ys = rotated.map(p => p.y)
    const w = Math.max(...xs) - Math.min(...xs)
    const d = Math.max(...ys) - Math.min(...ys)
    if (w + d < bestWidth + bestDepth) {
      bestWidth = w
      bestDepth = d
      bestAngle = edge.angle
    }
  }

  // Ensure width ≥ depth
  const [w, d] = bestWidth >= bestDepth
    ? [bestWidth, bestDepth]
    : [bestDepth, bestWidth]

  const angle_deg = (bestAngle * 180 / Math.PI + 360) % 180

  return {
    width_m: Math.round(w),
    depth_m: Math.round(d),
    sides_m: [Math.round(w), Math.round(d), Math.round(w), Math.round(d)],
    angle_deg: Math.round(angle_deg * 10) / 10,
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lat = searchParams.get("lat")
  const lng = searchParams.get("lng")

  if (!lat || !lng) {
    return NextResponse.json({ status: "error", reason: "missing lat/lng" }, { status: 400 })
  }

  const query = `
    [out:json][timeout:10];
    (
      way["building"](around:60,${lat},${lng});
      relation["building"](around:60,${lat},${lng});
    );
    out geom tags;
  `.trim()

  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      next: { revalidate: 86400 },
    })
    if (!res.ok) {
      return NextResponse.json({ status: "error", reason: "overpass returned " + res.status })
    }

    const data = await res.json()
    const elements = data.elements ?? []

    // Find closest building element with valid geometry
    let bestElement: {
      geometry: { lat: number; lon: number }[];
      tags?: Record<string, string>;
    } | null = null
    let bestDist = Infinity

    for (const el of elements) {
      if (!el.geometry || el.geometry.length < 3) continue
      const centLat = el.geometry.reduce((s: number, p: { lat: number }) => s + p.lat, 0) / el.geometry.length
      const centLon = el.geometry.reduce((s: number, p: { lon: number }) => s + p.lon, 0) / el.geometry.length
      const dist = Math.hypot(centLat - Number(lat), centLon - Number(lng))
      if (dist < bestDist) {
        bestDist = dist
        bestElement = el
      }
    }

    if (!bestElement) {
      return NextResponse.json({ status: "not_found", elements_count: elements.length })
    }

    const tags = bestElement.tags ?? {}
    const dimensions = computeMBR(bestElement.geometry)

    // Extract human-readable identifiers from OSM tags
    const name = tags["name"] ?? tags["name:zh"] ?? tags["name:zh-TW"] ?? null
    const buildingAddr = [
      tags["addr:housenumber"],
      tags["addr:street"],
      tags["addr:city"],
    ].filter(Boolean).join(" ") || null

    return NextResponse.json({
      status: "found",
      geometry: bestElement.geometry,
      elements_count: elements.length,
      dimensions,
      name,            // OSM building name if tagged (e.g. "台北101")
      address: buildingAddr,  // OSM address tags if available
    })
  } catch {
    return NextResponse.json({ status: "error", reason: "network error" })
  }
}
