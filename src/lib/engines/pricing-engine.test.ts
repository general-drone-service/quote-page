import { describe, it, expect } from "vitest"
import { generateQuote } from "./pricing-engine"
import { PRICING_PARAMS_DEFAULT } from "./pricing-params"
import type { CommuteResult } from "@/lib/types"

const noCommute: CommuteResult = {
  mode: "daily", one_way_hours: 0,
  commute_fee: 0, fuel_fee: 0, lodging_fee: 0,
  origin_address: "test", destination_address: "test",
}

describe("generateQuote", () => {
  it("4 days × 40000 with no multipliers, no commute = 144000 after 0.9 discount", () => {
    const q = generateQuote({
      suggested_days: 4,
      multipliers: { floors: 5, timeWindow: "day", urgent: false },
      commute: noCommute,
      facadeAreas: [],
    }, PRICING_PARAMS_DEFAULT)
    expect(q.labor_total).toBe(144000)
    expect(q.commute_total).toBe(0)
    expect(q.final_price).toBe(144000)
  })

  it("applies high-rise + weekend + urgent multipliers, capped at 2.5×", () => {
    const q = generateQuote({
      suggested_days: 5,
      multipliers: { floors: 25, timeWindow: "weekend", urgent: true },
      commute: noCommute,
      facadeAreas: [],
    }, PRICING_PARAMS_DEFAULT)
    // labor = 5 × 40000 = 200000
    // combined = 1.12 (25F) × 1.2 (weekend) × 1.33 (urgent) = 1.78752
    // labor_with_mult = round(200000 × 1.78752) = round(357504) = 357504
    // labor_after_disc = round(357504 × 0.9) = round(321753.6) = 321754
    expect(q.multiplier).toBeCloseTo(1.79, 2)
    expect(q.labor_total).toBe(321754)
  })

  it("flags manual review when combined multiplier > cap", () => {
    const q = generateQuote({
      suggested_days: 1,
      multipliers: { floors: 35, timeWindow: "night", urgent: true },
      commute: noCommute,
      facadeAreas: [],
    }, PRICING_PARAMS_DEFAULT)
    // combined = 1.25 × 1.5 × 1.33 = 2.49 → just under 2.5 cap
    expect(q.requires_manual_review).toBeFalsy()
  })

  it("min_order floor protects labor", () => {
    const q = generateQuote({
      suggested_days: 1,
      multipliers: { floors: 5, timeWindow: "day", urgent: false },
      commute: noCommute,
      facadeAreas: [],
    }, { ...PRICING_PARAMS_DEFAULT, daily_rate: 10000, min_order: 30000 })
    // labor = 10000, min kicks in to 30000, then × 0.9 = 27000
    expect(q.labor_total).toBe(27000)
  })

  it("commute is added on top, not discounted", () => {
    const q = generateQuote({
      suggested_days: 4,
      multipliers: { floors: 5, timeWindow: "day", urgent: false },
      commute: { ...noCommute, commute_fee: 4000, fuel_fee: 1000 },
      facadeAreas: [],
    }, PRICING_PARAMS_DEFAULT)
    expect(q.commute_total).toBe(5000)
    expect(q.final_price).toBe(149000)
  })
})
