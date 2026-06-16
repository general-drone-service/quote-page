/**
 * Ad attribution — landing URL search string → ad_leads payload.
 * Pure, no browser/framework deps. Canonical tested copy is
 * internal-tools/operation/gds-ads/lib/attribution.mjs — keep logic identical.
 */

const SAFE_UTM_RE = /[^a-z0-9_-]/g

export type Platform = "google" | "meta"

export interface AdParams {
  platform: Platform | null
  gclid: string | null
  fbclid: string | null
  utm_source: string | null
  utm_campaign: string | null
}

export interface AdLead extends AdParams {
  platform: Platform
  landing_path: string | null
  contact: Record<string, unknown> | null
}

function cleanUtm(v: string | null): string | null {
  if (!v) return null
  const s = v.toLowerCase().replace(SAFE_UTM_RE, "").slice(0, 100)
  return s || null
}
function capId(v: string | null): string | null {
  return v ? v.slice(0, 255) : null
}

/** Parse raw click/utm params from a URL search string ("?a=b" or "a=b"). */
export function parseAdParams(search: string): AdParams {
  const raw = typeof search === "string" ? search : ""
  const params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw)

  const gclid = capId(params.get("gclid"))
  const fbclid = capId(params.get("fbclid"))
  const utm_source = cleanUtm(params.get("utm_source"))
  const utm_campaign = cleanUtm(params.get("utm_campaign"))

  let platform: Platform | null = gclid ? "google" : fbclid ? "meta" : null
  if (!platform && utm_source) {
    if (/google|gads|googleads/.test(utm_source)) platform = "google"
    else if (/meta|facebook|^fb|^ig|instagram/.test(utm_source)) platform = "meta"
  }

  return { platform, gclid, fbclid, utm_source, utm_campaign }
}

/**
 * Build the ad_leads insert payload, or null when traffic isn't attributable to
 * a paid platform (caller skips the ad_leads write — organic quote).
 */
export function buildAdLead(
  search: string,
  landing_path?: string | null,
  contact?: Record<string, unknown> | null,
): AdLead | null {
  const a = parseAdParams(search)
  if (!a.platform) return null
  return {
    platform: a.platform,
    gclid: a.gclid,
    fbclid: a.fbclid,
    utm_source: a.utm_source,
    utm_campaign: a.utm_campaign,
    landing_path: landing_path || null,
    contact: contact || null,
  }
}
