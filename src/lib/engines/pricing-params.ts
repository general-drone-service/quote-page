// ─── Pricing Parameters — Standalone Quote Module ────────────────────────────
//
// Version management via Supabase DB (pricing_params table).
// Server-side: reads from DB; client-side: fetched via /api/pricing-params.
// Falls back to PRICING_PARAMS_DEFAULT if DB is unavailable.

import type { BuildingType, Complexity, Contamination, CleaningAgent, TimeWindow } from "@/lib/types"

// ─── Interface ───────────────────────────────────────────────────────────────

export interface PricingParams {
  /** Base unit prices per building type (NTD/m²) */
  base_price: Record<BuildingType, number>

  /** Facade complexity surcharge (NTD/m²) */
  complexity_surcharge: Record<Complexity, number>

  /** Contamination type surcharge — stackable (NTD/m²) */
  contamination_surcharge: Record<Contamination, number>
  /** Max stacked contamination surcharge per m² */
  contamination_cap: number

  /** Cleaning agent surcharge (NTD/m²) */
  cleaning_agent_surcharge: Record<CleaningAgent, number>

  /** Per-facade condition surcharges (NTD/m²) */
  facade_surcharges: {
    road_closure: number
    tight_perimeter: number
    high_risk_env: number
    adjacent_trees: number
    tree_extra: number
  }

  /** Building-level supply surcharges (NTD/m²) */
  supply_surcharges: {
    water_self: number
    power_self: number
    rooftop_not_good: number
  }

  /** Floor multiplier thresholds */
  floor_multiplier: { max_floor: number; multiplier: number }[]

  /** Time window multiplier */
  time_window_multiplier: Record<TimeWindow, number>

  /** Urgent job multiplier (applied when deadline ≤ 30 days) */
  urgent_multiplier: number

  /** Minimum order amount (NTD) */
  min_order: number

  /** Maximum combined multiplier before manual review is triggered */
  quote_max_multiplier: number

  /** Final discount applied to total to produce official quote price (e.g. 0.9 = 90%) */
  final_discount: number

  /** Version tag */
  version: string
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const PRICING_PARAMS_DEFAULT: PricingParams = {
  base_price: {
    commercial: 13,
    luxury: 14,
    house: 200,
    factory: 22,
    solar: 9.5,
  },

  complexity_surcharge: {
    light: -1,
    medium: 5,
    heavy: 8,
  },

  contamination_surcharge: {
    dust: 0,
    scale: 3.5,
    bird: 1.5,
    mold: 1.5,
    exhaust: 2,
    grease: 5,
  },
  contamination_cap: 8,

  cleaning_agent_surcharge: {
    soft: -1,
    standard: 1,
    deep: 2.5,
  },

  facade_surcharges: {
    road_closure: 2,
    tight_perimeter: 3,
    high_risk_env: 3.5,
    adjacent_trees: 2.5,
    tree_extra: 5,
  },

  supply_surcharges: {
    water_self: 3.5,
    power_self: 3.5,
    rooftop_not_good: 6,
  },

  floor_multiplier: [
    { max_floor: 10,  multiplier: 1.0 },
    { max_floor: 20,  multiplier: 1.05 },
    { max_floor: 30,  multiplier: 1.12 },
    { max_floor: 9999, multiplier: 1.25 },
  ],

  time_window_multiplier: {
    day: 1.0,
    weekend: 1.2,
    night: 1.5,
  },

  urgent_multiplier: 1.33,

  min_order: 30000,

  quote_max_multiplier: 2.5,

  final_discount: 0.9,

  version: "v1.0",
}

// ─── Client-side cache ──────────────────────────────────────────────────────

let cachedParams: PricingParams | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Returns pricing params.
 * - Server-side: always returns defaults (use getServerPricingParams() for DB reads)
 * - Client-side: returns cached value fetched from /api/pricing-params
 */
export function getPricingParams(): PricingParams {
  if (typeof window === "undefined") return PRICING_PARAMS_DEFAULT

  // Return cached if fresh
  if (cachedParams && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedParams
  }

  // Trigger async refresh (non-blocking)
  refreshPricingParams()

  return cachedParams ?? PRICING_PARAMS_DEFAULT
}

/** Fetch latest params from API and cache */
export async function refreshPricingParams(): Promise<PricingParams> {
  try {
    const res = await fetch("/api/pricing-params")
    if (!res.ok) return cachedParams ?? PRICING_PARAMS_DEFAULT

    const data = await res.json() as { params: PricingParams }
    cachedParams = deepMergeParams(data.params)
    cacheTimestamp = Date.now()
    return cachedParams
  } catch {
    return cachedParams ?? PRICING_PARAMS_DEFAULT
  }
}

function deepMergeParams(p: Partial<PricingParams>): PricingParams {
  return {
    ...PRICING_PARAMS_DEFAULT,
    ...p,
    base_price: { ...PRICING_PARAMS_DEFAULT.base_price, ...p.base_price },
    complexity_surcharge: { ...PRICING_PARAMS_DEFAULT.complexity_surcharge, ...p.complexity_surcharge },
    contamination_surcharge: { ...PRICING_PARAMS_DEFAULT.contamination_surcharge, ...p.contamination_surcharge },
    cleaning_agent_surcharge: { ...PRICING_PARAMS_DEFAULT.cleaning_agent_surcharge, ...p.cleaning_agent_surcharge },
    facade_surcharges: { ...PRICING_PARAMS_DEFAULT.facade_surcharges, ...p.facade_surcharges },
    supply_surcharges: { ...PRICING_PARAMS_DEFAULT.supply_surcharges, ...p.supply_surcharges },
    time_window_multiplier: { ...PRICING_PARAMS_DEFAULT.time_window_multiplier, ...p.time_window_multiplier },
    floor_multiplier: p.floor_multiplier ?? PRICING_PARAMS_DEFAULT.floor_multiplier,
  }
}
