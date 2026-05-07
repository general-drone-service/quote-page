import { describe, it, expect } from "vitest"
import { estimateTime } from "./time-engine"

describe("estimateTime", () => {
  it("ceils area / daily_area to integer days", () => {
    const r = estimateTime({ total_area: 5400, daily_area: 1470 })
    expect(r.suggested_days).toBe(4)            // 5400 / 1470 = 3.67 → 4
    expect(r.pure_operation_days).toBeCloseTo(3.67, 2)
  })

  it("returns minimum 1 day even for tiny areas", () => {
    const r = estimateTime({ total_area: 50, daily_area: 1500 })
    expect(r.suggested_days).toBe(1)
  })

  it("guards against zero daily_area", () => {
    const r = estimateTime({ total_area: 1000, daily_area: 0 })
    expect(r.suggested_days).toBeGreaterThan(0)
    expect(Number.isFinite(r.suggested_days)).toBe(true)
  })
})
