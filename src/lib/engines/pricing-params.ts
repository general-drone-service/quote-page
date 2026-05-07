// src/lib/engines/pricing-params.ts
import type { TimeWindow } from "@/lib/types"
import type { ProductivityParams } from "./productivity-engine"
import { PRODUCTIVITY_PARAMS_DEFAULT } from "./productivity-engine"

export interface CommuteConfig {
  fee_per_hour: number
  daily_fuel_fee: number
  lodging_per_day: number
  lodging_threshold_hours: number
}

export interface CommuteOrigin {
  lat: number
  lng: number
  address: string
}

export interface PricingParams extends ProductivityParams {
  daily_rate: number

  floor_multiplier: { max_floor: number; multiplier: number }[]
  time_window_multiplier: Record<TimeWindow, number>
  urgent_multiplier: number
  min_order: number
  quote_max_multiplier: number
  final_discount: number
  tax_rate: number

  commute_origin: CommuteOrigin
  commute: CommuteConfig

  version: string
}

export const PRICING_PARAMS_DEFAULT: PricingParams = {
  ...PRODUCTIVITY_PARAMS_DEFAULT,

  daily_rate: 40000,

  floor_multiplier: [
    { max_floor: 10,   multiplier: 1.00 },
    { max_floor: 20,   multiplier: 1.05 },
    { max_floor: 30,   multiplier: 1.12 },
    { max_floor: 9999, multiplier: 1.25 },
  ],
  time_window_multiplier: { day: 1.0, weekend: 1.2, night: 1.5 },
  urgent_multiplier: 1.33,
  min_order: 30000,
  quote_max_multiplier: 2.5,
  final_discount: 1.0,
  tax_rate: 0.05,

  commute_origin: {
    lat: 25.0495732,
    lng: 121.5576803,
    address: "台北市松山區光復北路11巷46號",
  },
  commute: {
    fee_per_hour: 2000,
    daily_fuel_fee: 1000,
    lodging_per_day: 6000,
    lodging_threshold_hours: 1.5,
  },

  version: "v2.0",
}

// Client-side cache (mirrors pre-v2 behavior)
let cachedParams: PricingParams | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000

export function getPricingParams(): PricingParams {
  if (typeof window === "undefined") return PRICING_PARAMS_DEFAULT
  if (cachedParams && Date.now() - cacheTimestamp < CACHE_TTL_MS) return cachedParams
  void refreshPricingParams()
  return cachedParams ?? PRICING_PARAMS_DEFAULT
}

export async function refreshPricingParams(): Promise<PricingParams> {
  try {
    const res = await fetch("/api/pricing-params")
    if (!res.ok) return cachedParams ?? PRICING_PARAMS_DEFAULT
    const data = await res.json() as { params: Partial<PricingParams> }
    cachedParams = mergeParams(data.params)
    cacheTimestamp = Date.now()
    return cachedParams
  } catch {
    return cachedParams ?? PRICING_PARAMS_DEFAULT
  }
}

function mergeParams(p: Partial<PricingParams>): PricingParams {
  return {
    ...PRICING_PARAMS_DEFAULT,
    ...p,
    building_type_coeff:    { ...PRICING_PARAMS_DEFAULT.building_type_coeff, ...p.building_type_coeff },
    complexity_coeff:       { ...PRICING_PARAMS_DEFAULT.complexity_coeff, ...p.complexity_coeff },
    contamination_coeff:    { ...PRICING_PARAMS_DEFAULT.contamination_coeff, ...p.contamination_coeff },
    cleaning_agent_coeff:   { ...PRICING_PARAMS_DEFAULT.cleaning_agent_coeff, ...p.cleaning_agent_coeff },
    facade_modifiers:       { ...PRICING_PARAMS_DEFAULT.facade_modifiers, ...p.facade_modifiers },
    site_modifiers: {
      ...PRICING_PARAMS_DEFAULT.site_modifiers,
      ...p.site_modifiers,
      region_exposure: { ...PRICING_PARAMS_DEFAULT.site_modifiers.region_exposure, ...(p.site_modifiers?.region_exposure ?? {}) },
      crowd_density:   { ...PRICING_PARAMS_DEFAULT.site_modifiers.crowd_density,   ...(p.site_modifiers?.crowd_density ?? {}) },
    },
    height_coeff:           p.height_coeff ?? PRICING_PARAMS_DEFAULT.height_coeff,
    floor_multiplier:       p.floor_multiplier ?? PRICING_PARAMS_DEFAULT.floor_multiplier,
    time_window_multiplier: { ...PRICING_PARAMS_DEFAULT.time_window_multiplier, ...p.time_window_multiplier },
    commute_origin:         { ...PRICING_PARAMS_DEFAULT.commute_origin, ...p.commute_origin },
    commute:                { ...PRICING_PARAMS_DEFAULT.commute, ...p.commute },
  }
}
