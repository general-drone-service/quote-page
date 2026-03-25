// ─── Static Taiwan Airspace Zone Engine ──────────────────────────────────────
//
// Strategy: Bundle static zone definitions (airports + restricted areas) and
// use haversine distance for point-in-zone checks.
//
// Why static vs. live ArcGIS query:
//   - dronegis.caa.gov.tw is geofenced (returns 503 from non-Taiwan IPs)
//   - Taiwan CAA has no public GeoJSON/REST API
//   - Static zones are zero-cost, zero-runtime-dependency, always available
//   - Zone data sourced from ICAO AIP Taiwan / CAA announcements
//
// ruleset_version: "v1.1-static" (update when zone data changes)

import type { AirspaceResult } from "@/lib/types"

// ─── Zone definitions ─────────────────────────────────────────────────────────

interface AirZone {
  id: string
  name: string
  lat: number
  lng: number
  radius_km: number
  status: "NoFly" | "NeedPermit"
  reason: string
  admin_days: number
}

// Taiwan airports and restricted areas
// Source: ICAO AIP Taiwan + CAA Drone Zone Announcements (民用航空法 §99-13)
export const TAIWAN_AIRSPACE_ZONES: AirZone[] = [
  // ── International airports (NoFly within core radius) ──────────────────────
  {
    id: "RCTP",
    name: "桃園國際機場",
    lat: 25.0782, lng: 121.2327,
    radius_km: 8,
    status: "NoFly",
    reason: "位於桃園國際機場禁飛區（距跑道中心線 < 8km），任務不可生成",
    admin_days: 0,
  },
  {
    id: "RCKH",
    name: "高雄國際機場",
    lat: 22.5774, lng: 120.3489,
    radius_km: 8,
    status: "NoFly",
    reason: "位於高雄國際機場禁飛區（距跑道中心線 < 8km），任務不可生成",
    admin_days: 0,
  },

  // ── Domestic/regional airports (NeedPermit) ────────────────────────────────
  {
    id: "RCSS",
    name: "台北松山機場",
    lat: 25.0698, lng: 121.5516,
    radius_km: 5,
    status: "NeedPermit",
    reason: "位於松山機場管制空域 5km 範圍內，須向 CAA 提出 LAANC 申請",
    admin_days: 3,
  },
  {
    id: "RCMQ",
    name: "台中清泉崗機場",
    lat: 24.2646, lng: 120.6213,
    radius_km: 5,
    status: "NeedPermit",
    reason: "位於台中機場管制空域 5km 範圍內，須向 CAA 提出 LAANC 申請",
    admin_days: 3,
  },
  {
    id: "RCFG",
    name: "花蓮機場",
    lat: 23.9739, lng: 121.6168,
    radius_km: 5,
    status: "NeedPermit",
    reason: "位於花蓮機場管制空域 5km 範圍內，須向 CAA 提出 LAANC 申請",
    admin_days: 3,
  },
  {
    id: "RCNN",
    name: "台南機場",
    lat: 22.9503, lng: 120.2057,
    radius_km: 5,
    status: "NeedPermit",
    reason: "位於台南機場管制空域 5km 範圍內，須向 CAA 提出 LAANC 申請",
    admin_days: 3,
  },
  {
    id: "RCKU",
    name: "嘉義機場",
    lat: 23.4615, lng: 120.3932,
    radius_km: 5,
    status: "NeedPermit",
    reason: "位於嘉義機場管制空域 5km 範圍內，須向 CAA 提出 LAANC 申請",
    admin_days: 3,
  },
  {
    id: "RCBS",
    name: "屏東北機場",
    lat: 22.7023, lng: 120.4613,
    radius_km: 5,
    status: "NeedPermit",
    reason: "位於屏東機場管制空域 5km 範圍內，須向 CAA 提出 LAANC 申請",
    admin_days: 3,
  },
  {
    id: "RCGI",
    name: "金門機場",
    lat: 24.4278, lng: 118.3594,
    radius_km: 5,
    status: "NeedPermit",
    reason: "位於金門機場管制空域 5km 範圍內，須向 CAA 提出 LAANC 申請",
    admin_days: 5,
  },
  {
    id: "RCMT",
    name: "馬公機場（澎湖）",
    lat: 23.5697, lng: 119.6278,
    radius_km: 5,
    status: "NeedPermit",
    reason: "位於馬公機場管制空域 5km 範圍內，須向 CAA 提出 LAANC 申請",
    admin_days: 5,
  },
  {
    id: "RCLY",
    name: "蘭嶼機場",
    lat: 22.0279, lng: 121.5353,
    radius_km: 3,
    status: "NeedPermit",
    reason: "位於蘭嶼機場管制空域 3km 範圍內，須向 CAA 提出 LAANC 申請",
    admin_days: 5,
  },
  {
    id: "RCQC",
    name: "望安機場",
    lat: 23.3673, lng: 119.5128,
    radius_km: 3,
    status: "NeedPermit",
    reason: "位於望安機場管制空域 3km 範圍內，須向 CAA 提出 LAANC 申請",
    admin_days: 5,
  },
]

// ─── Haversine distance ───────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLng = (lng2 - lng1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Main query function ──────────────────────────────────────────────────────

export interface AirspaceQueryResult extends AirspaceResult {
  matched_zone?: string
  distance_km?: number
}

export function queryAirspaceByCoords(lat: number, lng: number): AirspaceQueryResult {
  // NoFly zones take highest priority — check all first
  for (const zone of TAIWAN_AIRSPACE_ZONES) {
    const dist = haversineKm(lat, lng, zone.lat, zone.lng)
    if (dist <= zone.radius_km && zone.status === "NoFly") {
      return {
        status: "NoFly",
        reason: zone.reason,
        admin_days_added: zone.admin_days,
        ruleset_version: "v1.1-static",
        matched_zone: zone.name,
        distance_km: Math.round(dist * 10) / 10,
      }
    }
  }

  // Then NeedPermit zones (pick the one with highest admin_days if multiple match)
  let bestPermit: (AirZone & { dist: number }) | null = null
  for (const zone of TAIWAN_AIRSPACE_ZONES) {
    const dist = haversineKm(lat, lng, zone.lat, zone.lng)
    if (dist <= zone.radius_km && zone.status === "NeedPermit") {
      if (!bestPermit || zone.admin_days > bestPermit.admin_days) {
        bestPermit = { ...zone, dist }
      }
    }
  }

  if (bestPermit) {
    return {
      status: "NeedPermit",
      reason: bestPermit.reason,
      admin_days_added: bestPermit.admin_days,
      ruleset_version: "v1.1-static",
      matched_zone: bestPermit.name,
      distance_km: Math.round(bestPermit.dist * 10) / 10,
    }
  }

  return {
    status: "OK",
    admin_days_added: 0,
    ruleset_version: "v1.1-static",
  }
}
