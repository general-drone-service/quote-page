import { describe, it, expect } from "vitest"
import { computeDailyArea, PRODUCTIVITY_PARAMS_DEFAULT } from "./productivity-engine"
import type { QuoteFacadeInput } from "@/app/components/quote-defaults"

const baseFacade = (overrides: Partial<QuoteFacadeInput> = {}): QuoteFacadeInput => ({
  id: "test", buildingIndex: 0, buildingLabel: "", label: "1",
  dirtTypes: ["dust"], complexity: "light",
  hasRecesses: false, isHighRisk: false,
  hasAdjacentTrees: false, treeFloors: 0, cleanTreeFloors: false,
  waterSupply: "Provided", powerSupply: "Provided",
  powerVoltage: ["110V", "220V"], supplyPhotos: [], photos: [],
  ...overrides,
})

describe("computeDailyArea — baseline", () => {
  it("commercial 5F light/dust/standard/good rooftop = base × 0.95 × 0.98", () => {
    const result = computeDailyArea({
      buildingType: "commercial", floors: 5,
      facadeInputs: [baseFacade()],
      facadeAreas_m2: [100],
      rooftopAccess: "Good", cleaningAgent: "standard",
    })
    // 1500 × 1.0(commercial) × 1.0(<10F) × 0.95(standard agent) × 1.0(rooftop good)
    //      × 1.0(no site mods) × (0.98 × 1.0)(light × dust)
    // = 1500 × 0.95 × 0.98 = 1396.5
    expect(result.daily_area).toBeCloseTo(1396.5, 1)
  })
})

describe("computeDailyArea — area-weighted aggregation", () => {
  it("two facades with different complexity weight by area", () => {
    // 100㎡ light (0.98) + 300㎡ heavy (0.7) → weighted avg = (100×0.98 + 300×0.7) / 400 = 0.77
    const result = computeDailyArea({
      buildingType: "commercial", floors: 5,
      facadeInputs: [baseFacade(), baseFacade({ id: "f2", complexity: "heavy" })],
      facadeAreas_m2: [100, 300],
      rooftopAccess: "Good", cleaningAgent: "standard",
    })
    // 1500 × 1.0 × 1.0 × 0.95 × 1.0 × 0.77 = 1097.25
    expect(result.daily_area).toBeCloseTo(1097.25, 1)
  })
})

describe("computeDailyArea — modifiers", () => {
  it("rooftop NotAvailable applies 0.6 modifier", () => {
    const result = computeDailyArea({
      buildingType: "commercial", floors: 5,
      facadeInputs: [baseFacade()],
      facadeAreas_m2: [100],
      rooftopAccess: "NotAvailable", cleaningAgent: "standard",
    })
    // 1500 × 1.0 × 1.0 × 0.95 × 0.6 × 0.98 = 837.9
    expect(result.daily_area).toBeCloseTo(837.9, 1)
  })

  it("LARM site fields stack multiplicatively", () => {
    const result = computeDailyArea({
      buildingType: "commercial", floors: 5,
      facadeInputs: [baseFacade()],
      facadeAreas_m2: [100],
      rooftopAccess: "Good", cleaningAgent: "standard",
      regionExposure: "windward", crowdDensity: "high",
      nearBaseStation: true, windChannelEffect: true,
    })
    // 1500 × 1.0(commercial) × 1.0(<10F) × 0.95(standard) × 1.0(good rooftop)
    //      × 0.85(windward) × 0.85(high crowd) × 0.95(near base) × 0.85(wind channel)
    //      × 0.98(light × dust) = 814.7
    expect(result.daily_area).toBeCloseTo(814.7, 0)
  })
})
