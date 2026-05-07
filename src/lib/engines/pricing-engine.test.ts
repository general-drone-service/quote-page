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
  it("4 days × 40000 with no multipliers, no commute = 168000 after 5% tax", () => {
    const q = generateQuote({
      suggested_days: 4,
      multipliers: { floors: 5, timeWindow: "day", urgent: false },
      commute: noCommute,
      facadeAreas: [],
    }, PRICING_PARAMS_DEFAULT)
    // labor = 4 × 40000 = 160000, no discount, tax = 8000, final = 168000
    expect(q.labor_total).toBe(160000)
    expect(q.commute_total).toBe(0)
    expect(q.tax_total).toBe(8000)
    expect(q.final_price).toBe(168000)
  })

  it("applies high-rise + weekend + urgent multipliers, capped at 2.5×", () => {
    const q = generateQuote({
      suggested_days: 5,
      multipliers: { floors: 25, timeWindow: "weekend", urgent: true },
      commute: noCommute,
      facadeAreas: [],
    }, PRICING_PARAMS_DEFAULT)
    // labor = 5 × 40000 = 200000
    // combined = 1.12 × 1.2 × 1.33 = 1.78752
    // labor_with_mult = round(200000 × 1.78752) = 357504
    // tax = round(357504 × 0.05) = 17875, final = 375379
    expect(q.multiplier).toBeCloseTo(1.79, 2)
    expect(q.labor_total).toBe(357504)
    expect(q.tax_total).toBe(17875)
    expect(q.final_price).toBe(375379)
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
    // labor = 10000, min kicks in to 30000, tax = 1500, final = 31500
    expect(q.labor_total).toBe(30000)
    expect(q.tax_total).toBe(1500)
    expect(q.final_price).toBe(31500)
  })

  it("commute is taxable along with labor", () => {
    const q = generateQuote({
      suggested_days: 4,
      multipliers: { floors: 5, timeWindow: "day", urgent: false },
      commute: { ...noCommute, commute_fee: 4000, fuel_fee: 1000 },
      facadeAreas: [],
    }, PRICING_PARAMS_DEFAULT)
    // labor 160000, commute 5000, pre_tax 165000, tax round(165000×0.05)=8250, final 173250
    expect(q.commute_total).toBe(5000)
    expect(q.tax_total).toBe(8250)
    expect(q.final_price).toBe(173250)
  })
})
