/**
 * First-touch ad-attribution cookie. The quote flow is a 3-step wizard, so the
 * gclid/fbclid that arrived in the landing URL must survive until the user
 * submits. We stash it in a 90-day cookie on entry and read it at submit time.
 * Client-only (touches document/window).
 */
export const AD_COOKIE = "gds_ad_first_touch"
const AD_PARAM_KEYS = ["gclid", "fbclid", "utm_source", "utm_campaign"]

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"))
  return m ? decodeURIComponent(m[1]) : null
}

/** On entry: persist the landing ad params, first-touch wins (don't overwrite). */
export function captureFirstTouch(): void {
  if (typeof window === "undefined") return
  if (readCookie(AD_COOKIE)) return
  const search = window.location.search
  const params = new URLSearchParams(search)
  if (!AD_PARAM_KEYS.some((k) => params.get(k))) return
  const payload = JSON.stringify({ search, path: window.location.pathname })
  document.cookie = `${AD_COOKIE}=${encodeURIComponent(payload)}; path=/; max-age=${60 * 60 * 24 * 90}; samesite=lax`
}

/** At submit: return the first-touch ad params (cookie), else current URL. */
export function readAdFirstTouch(): { search: string; path: string } {
  if (typeof window === "undefined") return { search: "", path: "" }
  const existing = readCookie(AD_COOKIE)
  if (existing) {
    try {
      const p = JSON.parse(existing)
      return { search: p.search || "", path: p.path || "" }
    } catch {
      // fall through on corrupt cookie
    }
  }
  return { search: window.location.search || "", path: window.location.pathname || "" }
}
