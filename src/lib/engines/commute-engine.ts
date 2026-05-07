import type { CommuteResult } from "@/lib/types"

/**
 * Client-side fetcher for /api/commute/estimate.
 * Returns a fallback estimate (with `warning`) if the API call fails.
 */
export async function estimateCommute(
  destination_lat: number,
  destination_lng: number,
  work_days: number,
): Promise<CommuteResult> {
  try {
    const res = await fetch("/api/commute/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination_lat, destination_lng, work_days }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    return {
      mode: "daily",
      one_way_hours: 1,
      commute_fee: 4000 * work_days,
      fuel_fee: 1000 * work_days,
      lodging_fee: 0,
      origin_address: "台北市松山區光復北路11巷46號",
      destination_address: `${destination_lat},${destination_lng}`,
      warning: `通勤估算失敗: ${(err as Error).message}`,
    }
  }
}
