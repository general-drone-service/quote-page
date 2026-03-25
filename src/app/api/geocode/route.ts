// ─── GET /api/geocode?q=<query>&mode=address|name ─────────────────────────────
//
// Multi-strategy Taiwan geocoding.
// Strategy order (most accurate for Taiwan first):
//   1. NLSC (Taiwan MOI) — primary; converts TWD97 → WGS84 when needed
//   2. Nominatim (OSM)  — fallback; bounded to Taiwan viewbox
//   3. Progressive address truncation for both providers
//
// mode=name  → treats query as a POI / building name, not an address

import { NextResponse } from "next/server"

const USER_AGENT = "GDS-LAOP-Mock/1.0 (demo only)"

// ─── Taiwan WGS84 bounding box ────────────────────────────────────────────────
//  Main island + Penghu; excludes Kinmen/Matsu (still Taiwan, just tighter box)
const TW_BOUNDS = { minLat: 21.8, maxLat: 25.4, minLng: 119.0, maxLng: 122.1 }

function isWithinTaiwan(lat: number, lng: number): boolean {
  return lat >= TW_BOUNDS.minLat && lat <= TW_BOUNDS.maxLat &&
    lng >= TW_BOUNDS.minLng && lng <= TW_BOUNDS.maxLng
}

// ─── TWD97 TM2 Zone 1 (EPSG:3826) → WGS84 ───────────────────────────────────
// Typical Taiwan values: x ≈ 150,000–320,000 m, y ≈ 2,400,000–2,850,000 m

function isTWD97Range(x: number, y: number): boolean {
  return x >= 100_000 && x <= 400_000 && y >= 2_300_000 && y <= 3_000_000
}

function twd97ToWGS84(easting: number, northing: number): { lat: number; lng: number } {
  const a = 6_378_137.0
  const f = 1.0 / 298.257_222_101
  const e2 = 2 * f - f * f
  const k0 = 0.9999
  const lon0 = 121.0 * (Math.PI / 180)
  const FE = 250_000.0

  const x = easting - FE
  const y = northing

  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))
  const M = y / k0
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256))

  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu)

  const sinPhi1 = Math.sin(phi1)
  const cosPhi1 = Math.cos(phi1)
  const tanPhi1 = Math.tan(phi1)

  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 ** 2)
  const T1 = tanPhi1 ** 2
  const C1 = (e2 / (1 - e2)) * cosPhi1 ** 2
  const R1 = (a * (1 - e2)) / (1 - e2 * sinPhi1 ** 2) ** 1.5
  const D = x / (N1 * k0)

  const lat =
    phi1 -
    ((N1 * tanPhi1) / R1) *
    (D ** 2 / 2 -
      ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * (e2 / (1 - e2))) * D ** 4) / 24 +
      ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * (e2 / (1 - e2)) - 3 * C1 ** 2) *
        D ** 6) / 720)

  const lon =
    lon0 +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * (e2 / (1 - e2)) + 24 * T1 ** 2) *
        D ** 5) / 120) / cosPhi1

  return { lat: lat * (180 / Math.PI), lng: lon * (180 / Math.PI) }
}

// ─── Strategy 1: NLSC (primary for Taiwan) ───────────────────────────────────

async function tryNLSC(q: string) {
  const url = new URL("https://geocoder.nlsc.gov.tw/query.aspx")
  url.searchParams.set("queryType", "26")
  url.searchParams.set("inPut", q)
  url.searchParams.set("oSRS", "EPSG:4326")
  url.searchParams.set("format", "JSON")

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) return null

  let data: Record<string, unknown>
  try { data = await res.json() } catch { return null }

  // Try structured geometry [lng, lat] first
  const geom = data.theGeometry as { coordinates?: number[] } | undefined
  if (geom?.coordinates && geom.coordinates.length >= 2) {
    const lng = geom.coordinates[0], lat = geom.coordinates[1]
    if (isWithinTaiwan(lat, lng)) {
      return {
        lat, lng,
        district: String(data.town ?? data.district ?? ""),
        city: String(data.city ?? data.county ?? ""),
        displayName: [data.city, data.town, data.road, data.num].filter(Boolean).join(""),
        source: "nlsc",
      }
    }
  }

  // Fallback: raw x/y
  const rawX = parseFloat(String(data.x ?? data.X ?? ""))
  const rawY = parseFloat(String(data.y ?? data.Y ?? ""))
  if (!isFinite(rawX) || !isFinite(rawY)) return null

  if (isTWD97Range(rawX, rawY)) {
    const wgs = twd97ToWGS84(rawX, rawY)
    if (!isWithinTaiwan(wgs.lat, wgs.lng)) return null
    return {
      lat: wgs.lat, lng: wgs.lng,
      district: String(data.town ?? data.district ?? ""),
      city: String(data.city ?? data.county ?? ""),
      displayName: [data.city, data.town, data.road, data.num].filter(Boolean).join(""),
      source: "nlsc-converted",
    }
  }

  if (isWithinTaiwan(rawY, rawX)) {
    return {
      lat: rawY, lng: rawX,
      district: String(data.town ?? ""),
      city: String(data.city ?? ""),
      displayName: [data.city, data.town, data.road, data.num].filter(Boolean).join(""),
      source: "nlsc",
    }
  }
  return null
}

// ─── Strategy 2: Nominatim with Taiwan viewbox ────────────────────────────────

const TW_VIEWBOX = `${TW_BOUNDS.minLng},${TW_BOUNDS.minLat},${TW_BOUNDS.maxLng},${TW_BOUNDS.maxLat}`

async function tryNominatim(q: string, mode: "address" | "name" = "address") {
  const url = new URL("https://nominatim.openstreetmap.org/search")
  url.searchParams.set("q", q)
  url.searchParams.set("format", "json")
  url.searchParams.set("countrycodes", "tw")
  url.searchParams.set("limit", "5")
  url.searchParams.set("addressdetails", "1")
  url.searchParams.set("namedetails", "1")
  // Hard-constrain to Taiwan — prevents matching same road name elsewhere
  url.searchParams.set("viewbox", TW_VIEWBOX)
  url.searchParams.set("bounded", "1")

  if (mode === "name") {
    // For building/POI name search, include buildings and amenities
    url.searchParams.set("featureType", "building")
  }

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    },
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return null

  const results = await res.json()
  if (!Array.isArray(results) || results.length === 0) return null

  // Pick best match — prefer higher importance and results with address number
  const candidates = results
    .filter((r: { lat: string; lon: string }) =>
      isWithinTaiwan(parseFloat(r.lat), parseFloat(r.lon)))
    .sort((a: { importance: number; display_name: string }, b: { importance: number; display_name: string }) => {
      // Boost results that contain 號 (house number) in display_name
      const aHasNum = a.display_name.includes("號") ? 0.05 : 0
      const bHasNum = b.display_name.includes("號") ? 0.05 : 0
      return (b.importance + bHasNum) - (a.importance + aHasNum)
    })

  if (candidates.length === 0) return null

  const item = candidates[0]
  const lat = parseFloat(item.lat)
  const lng = parseFloat(item.lon)
  const addr = item.address ?? {}

  return {
    lat, lng,
    district: addr.suburb ?? addr.city_district ?? addr.borough ?? addr.township ?? "",
    city: addr.city ?? addr.town ?? addr.county ?? addr.state ?? "",
    displayName: item.namedetails?.name ?? item.display_name?.split(",")[0] ?? "",
    source: "nominatim",
  }
}

// ─── Strategy 3: Photon (photon.komoot.io) ───────────────────────────────────
// Alternative OSM-based geocoder, different ranking algorithm, no API key.
// Bounding box uses lon1,lat1,lon2,lat2 order.

async function tryPhoton(q: string) {
  const url = new URL("https://photon.komoot.io/api/")
  url.searchParams.set("q", q)
  url.searchParams.set("limit", "5")
  url.searchParams.set("lang", "zh")
  // bbox: lon_min,lat_min,lon_max,lat_max
  url.searchParams.set("bbox", `${TW_BOUNDS.minLng},${TW_BOUNDS.minLat},${TW_BOUNDS.maxLng},${TW_BOUNDS.maxLat}`)

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) return null

  const data = await res.json()
  const features: {
    geometry: { coordinates: [number, number] }
    properties: Record<string, string>
  }[] = data.features ?? []

  for (const f of features) {
    const [lng, lat] = f.geometry.coordinates
    if (!isWithinTaiwan(lat, lng)) continue
    const p = f.properties
    const name = p.name ?? p.street ?? ""
    const city = p.city ?? p.county ?? ""
    return { lat, lng, district: p.district ?? "", city, displayName: name, source: "photon" }
  }
  return null
}

// ─── Progressive address truncation ──────────────────────────────────────────

function addressVariants(q: string): string[] {
  const variants: string[] = [q]
  // Remove unit/floor suffix: 號X樓 → 號
  const noFloor = q.replace(/號\d+樓.*$/, "號").trim()
  if (noFloor !== q) variants.push(noFloor)
  // Remove house number: keep up to street name
  const noNum = noFloor.replace(/\d+(?:之\d+)?號.*$/, "").trim()
  if (noNum && noNum !== noFloor) variants.push(noNum)
  // Remove lane/alley
  const noLane = noNum.replace(/\d+[弄巷].*$/, "").trim()
  if (noLane && noLane !== noNum) variants.push(noLane)
  return variants
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")?.trim()
  const mode = (searchParams.get("mode") ?? "address") as "address" | "name"

  if (!q || q.length < 2) {
    return NextResponse.json({ status: "failed", reason: "query too short" }, { status: 400 })
  }

  const variants = mode === "name" ? [q] : addressVariants(q)

  // 1. NLSC (most accurate for Taiwan; may timeout outside TW network)
  for (const variant of variants) {
    try {
      const result = await tryNLSC(variant)
      if (result) return NextResponse.json({ ...result, raw: q, status: "success" })
    } catch { /* timeout or unreachable — fall through */ }
  }

  // 2. Photon (alternative OSM geocoder, different ranking than Nominatim)
  for (const variant of variants) {
    try {
      const result = await tryPhoton(variant)
      if (result) return NextResponse.json({ ...result, raw: q, status: "success" })
    } catch { /* fall through */ }
  }

  // 3. Nominatim
  for (const variant of variants) {
    try {
      const result = await tryNominatim(variant, mode)
      if (result) return NextResponse.json({ ...result, raw: q, status: "success" })
    } catch { /* fall through */ }
  }

  return NextResponse.json({
    status: "failed",
    reason: mode === "name"
      ? "找不到此建案名稱，請改用完整地址搜尋"
      : "找不到此地址，請確認格式為「縣市＋區＋路名＋門牌號」（例：台北市信義區松仁路100號）",
  })
}
