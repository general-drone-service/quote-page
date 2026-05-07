# Quote Day-Rate Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-facade unit-price model with productivity-driven day-rate pricing, add commute/lodging engine, and migrate map/address from Leaflet+OSM to Google Maps Platform.

**Architecture:** Three pure engines (`productivity-engine` → `time-engine` → `pricing-engine`) chained sequentially in Step 3, with a server-side `commute-engine` calling Google Distance Matrix. Map and address search both swap to Google Maps JavaScript API + Places API. Coefficients live in the existing `pricing_params` JSONB table; `/admin/params` UI lets ops tune without redeploys.

**Tech Stack:** Next.js 16.1.6, React 19, TypeScript strict, Supabase, Google Maps Platform (`@googlemaps/js-api-loader`), vitest (new).

**Spec:** `docs/superpowers/specs/2026-05-07-quote-day-rate-redesign-design.md`

---

## File Structure

| Path | Action | Purpose |
|---|---|---|
| `vitest.config.ts` | Create | Vitest configuration (new — no test infra exists yet) |
| `src/lib/engines/productivity-engine.ts` | Create | `computeDailyArea()` pure function |
| `src/lib/engines/productivity-engine.test.ts` | Create | TDD tests for productivity engine |
| `src/lib/engines/time-engine.ts` | Rewrite | Slim down to `(area, daily_area) → days` |
| `src/lib/engines/time-engine.test.ts` | Create | TDD tests |
| `src/lib/engines/pricing-engine.ts` | Replace | Day-rate formula consuming time output |
| `src/lib/engines/pricing-engine.test.ts` | Create | TDD tests |
| `src/lib/engines/pricing-params.ts` | Replace schema | v2.0 `PricingParams` with productivity coefficients |
| `src/lib/engines/commute-engine.ts` | Create | Client wrapper for `/api/commute/estimate` |
| `src/app/api/commute/estimate/route.ts` | Create | Server route hitting Google Distance Matrix + cache |
| `src/app/api/geocode/route.ts` | Rewrite | Nominatim → Google Places Text Search |
| `src/app/api/overpass/route.ts` | Delete | No longer needed |
| `src/app/api/pricing-params/route.ts` | Update | Return v2.0 shape (already JSONB-based; minor) |
| `src/app/components/QuoteMap.tsx` | Rewrite | Leaflet → Google Maps JS API; props interface unchanged |
| `src/app/components/QuoteStep1.tsx` | Update | Remove overpass call + building polygon side-effects |
| `src/app/components/QuoteStep2.tsx` | Update | Remove building polygon prefill from Overpass; manual draw only |
| `src/app/components/QuoteStep3.tsx` | Update | New dependency-ordered useEffect; new line item shape |
| `src/app/page.tsx` | Update | Drop building polygon state |
| `src/app/admin/params/page.tsx` | Update | Add v2.0 productivity coefficient editors |
| `src/lib/pdf/generate-quote-pdf.ts` | Update | Branch on `pricing_version` for backward compat |
| `supabase/migrations/003_pricing_params_v2.sql` | Create | Insert v2.0 row, demote v1.0 |
| `supabase/migrations/004_commute_cache.sql` | Create | New cache table |
| `package.json` | Update | Add vitest, @googlemaps/js-api-loader; remove leaflet |
| `.env.example` | Update | Add `GOOGLE_MAPS_BROWSER_KEY` + `GOOGLE_MAPS_SERVER_KEY` |

---

## Task 0: Set Up Vitest Test Infrastructure

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

This repo has no test framework. Foundation work for the TDD tasks below.

- [ ] **Step 1: Add vitest dependency**

```bash
cd /Users/drone168-1/quote-page
npm install --save-dev vitest@^3.2 @vitest/ui
```

- [ ] **Step 2: Create vitest config**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
})
```

- [ ] **Step 3: Add test script**

Edit `package.json` `scripts`:

```json
{
  "scripts": {
    "dev": "next dev --port 3001",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 4: Sanity check — write a smoke test**

```ts
// src/lib/__smoke__.test.ts
import { describe, it, expect } from "vitest"
describe("smoke", () => {
  it("vitest works", () => { expect(1 + 1).toBe(2) })
})
```

- [ ] **Step 5: Run and verify pass**

```bash
npm test
```
Expected: `1 passed`. Then delete the smoke test file.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "test: add vitest infrastructure"
```

---

## Task 1: Productivity Engine — Types & Default Params

**Files:**
- Create: `src/lib/engines/productivity-engine.ts`

This task only adds types and the default params constant. No logic yet.

- [ ] **Step 1: Create types and defaults**

```ts
// src/lib/engines/productivity-engine.ts
import type {
  BuildingType, Complexity, Contamination, CleaningAgent,
  RegionExposure, CrowdDensity, RooftopAccess,
} from "@/lib/types"
import type { QuoteFacadeInput } from "@/app/components/quote-defaults"

export interface ProductivityParams {
  daily_base_area: number
  building_type_coeff: Record<BuildingType, number>
  height_coeff: { max_floor: number; coeff: number }[]
  complexity_coeff: Record<Complexity, number>
  contamination_coeff: Record<Contamination, number>
  cleaning_agent_coeff: Record<CleaningAgent, number>
  facade_modifiers: {
    has_recesses: number
    is_high_risk: number
    adjacent_trees: number
    water_self_supply: number
    power_self_supply: number
    rooftop_limited: number
    rooftop_unavailable: number
  }
  site_modifiers: {
    region_exposure: Record<RegionExposure, number>
    crowd_density: Record<CrowdDensity, number>
    near_base_station: number
    wind_channel_effect: number
  }
}

export const PRODUCTIVITY_PARAMS_DEFAULT: ProductivityParams = {
  daily_base_area: 1500,
  building_type_coeff: {
    commercial: 1.0, luxury: 1.0, house: 0.85, factory: 1.1, solar: 1.3,
  },
  height_coeff: [
    { max_floor: 10,   coeff: 1.00 },
    { max_floor: 20,   coeff: 0.95 },
    { max_floor: 30,   coeff: 0.85 },
    { max_floor: 9999, coeff: 0.70 },
  ],
  complexity_coeff: { light: 0.98, medium: 0.9, heavy: 0.7 },
  contamination_coeff: {
    dust: 1.0, scale: 0.85, mold: 0.9, bird: 0.83, exhaust: 0.82, grease: 0.8,
  },
  cleaning_agent_coeff: { soft: 1.0, standard: 0.95, deep: 0.85 },
  facade_modifiers: {
    has_recesses: 0.85,
    is_high_risk: 0.75,
    adjacent_trees: 0.9,
    water_self_supply: 0.85,
    power_self_supply: 0.9,
    rooftop_limited: 0.8,
    rooftop_unavailable: 0.6,
  },
  site_modifiers: {
    region_exposure: { windward: 0.85, leeward: 1.0, coastal: 0.9, rooftop_open: 0.95 },
    crowd_density:   { low: 1.0, medium: 0.95, high: 0.85 },
    near_base_station: 0.95,
    wind_channel_effect: 0.85,
  },
}

export interface ComputeDailyAreaInput {
  buildingType: BuildingType
  floors: number
  facadeInputs: QuoteFacadeInput[]
  facadeAreas_m2: number[]
  rooftopAccess: RooftopAccess
  cleaningAgent: CleaningAgent
  regionExposure?: RegionExposure
  crowdDensity?: CrowdDensity
  nearBaseStation?: boolean
  windChannelEffect?: boolean
}

export interface DailyAreaResult {
  daily_area: number
  breakdown: { factor: string; coeff: number }[]
}

export function computeDailyArea(
  input: ComputeDailyAreaInput,
  params: ProductivityParams = PRODUCTIVITY_PARAMS_DEFAULT,
): DailyAreaResult {
  // implemented in Task 2
  throw new Error("not implemented")
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/engines/productivity-engine.ts
git commit -m "feat(productivity): scaffold engine types and default params"
```

---

## Task 2: Productivity Engine — TDD Implementation

**Files:**
- Create: `src/lib/engines/productivity-engine.test.ts`
- Modify: `src/lib/engines/productivity-engine.ts`

- [ ] **Step 1: Write failing test for trivial baseline**

```ts
// src/lib/engines/productivity-engine.test.ts
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
  it("commercial 5F light/dust/standard/good rooftop = base × 0.98 (light complexity)", () => {
    const result = computeDailyArea({
      buildingType: "commercial", floors: 5,
      facadeInputs: [baseFacade()],
      facadeAreas_m2: [100],
      rooftopAccess: "Good", cleaningAgent: "standard",
    })
    // 1500 × 1.0(commercial) × 1.0(<10F) × 0.95(standard agent) × 1.0(rooftop good)
    //      × 1.0(no site mods) × (0.98 × 1.0)(light complexity × dust)
    // = 1500 × 0.95 × 0.98 = 1396.5
    expect(result.daily_area).toBeCloseTo(1396.5, 1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test productivity-engine
```
Expected: FAIL with "not implemented"

- [ ] **Step 3: Implement minimal version (single facade only)**

Replace the throw in `productivity-engine.ts`:

```ts
export function computeDailyArea(
  input: ComputeDailyAreaInput,
  params: ProductivityParams = PRODUCTIVITY_PARAMS_DEFAULT,
): DailyAreaResult {
  const breakdown: { factor: string; coeff: number }[] = []
  const apply = (factor: string, coeff: number) => {
    breakdown.push({ factor, coeff })
    return coeff
  }

  const buildingCoeff = apply(`buildingType:${input.buildingType}`,
    params.building_type_coeff[input.buildingType] ?? 1)

  const heightCoeff = apply(`height:${input.floors}F`,
    params.height_coeff.find(h => input.floors <= h.max_floor)?.coeff ?? 1)

  const cleaningAgentCoeff = apply(`cleaningAgent:${input.cleaningAgent}`,
    params.cleaning_agent_coeff[input.cleaningAgent] ?? 1)

  const rooftopCoeff = apply(`rooftop:${input.rooftopAccess}`,
    input.rooftopAccess === "Limited" ? params.facade_modifiers.rooftop_limited :
    input.rooftopAccess === "NotAvailable" ? params.facade_modifiers.rooftop_unavailable : 1)

  const siteRegion = input.regionExposure
    ? apply(`region:${input.regionExposure}`, params.site_modifiers.region_exposure[input.regionExposure])
    : 1
  const siteCrowd = input.crowdDensity
    ? apply(`crowd:${input.crowdDensity}`, params.site_modifiers.crowd_density[input.crowdDensity])
    : 1
  const siteBase = input.nearBaseStation
    ? apply("nearBaseStation", params.site_modifiers.near_base_station) : 1
  const siteWind = input.windChannelEffect
    ? apply("windChannelEffect", params.site_modifiers.wind_channel_effect) : 1

  // Per-facade coefficient (area-weighted average)
  const totalArea = input.facadeAreas_m2.reduce((s, a) => s + a, 0)
  const weightedCoeffSum = input.facadeInputs.reduce((sum, f, i) => {
    const area = input.facadeAreas_m2[i] ?? 0
    if (area === 0) return sum
    const complexityCoeff = params.complexity_coeff[f.complexity] ?? 1
    const worstDirt = worstDirtType(f.dirtTypes, params.contamination_coeff)
    const contaminationCoeff = params.contamination_coeff[worstDirt] ?? 1
    let m = complexityCoeff * contaminationCoeff
    if (f.hasRecesses)        m *= params.facade_modifiers.has_recesses
    if (f.isHighRisk)         m *= params.facade_modifiers.is_high_risk
    if (f.hasAdjacentTrees)   m *= params.facade_modifiers.adjacent_trees
    if (f.waterSupply === "SelfSupply") m *= params.facade_modifiers.water_self_supply
    if (f.powerSupply === "SelfSupply") m *= params.facade_modifiers.power_self_supply
    return sum + area * m
  }, 0)
  const avgFacadeCoeff = totalArea > 0 ? weightedCoeffSum / totalArea : 1
  apply("avgFacadeCoeff", avgFacadeCoeff)

  const dailyArea = params.daily_base_area
    * buildingCoeff * heightCoeff * cleaningAgentCoeff * rooftopCoeff
    * siteRegion * siteCrowd * siteBase * siteWind
    * avgFacadeCoeff

  return { daily_area: dailyArea, breakdown }
}

function worstDirtType(
  dirts: string[],
  coeffs: Record<string, number>,
): keyof typeof coeffs {
  // Lower coeff = worse (slower)
  return dirts.reduce((worst, curr) =>
    (coeffs[curr] ?? 1) < (coeffs[worst] ?? 1) ? curr : worst
  , dirts[0] ?? "dust") as keyof typeof coeffs
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm test productivity-engine
```
Expected: PASS

- [ ] **Step 5: Add tests for area-weighting and modifiers**

Append to `productivity-engine.test.ts`:

```ts
describe("computeDailyArea — area-weighted aggregation", () => {
  it("two facades with different complexity weight by area", () => {
    // 100㎡ light (0.98) + 300㎡ heavy (0.7) → weighted = (100×0.98 + 300×0.7) / 400 = 0.77
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
    // 1500 × 1.0 × 1.0 × 0.95 × 1.0 × 0.85 × 0.85 × 0.95 × 0.85 × 0.98 ≈ 814.7
    expect(result.daily_area).toBeCloseTo(814.7, 0)
  })
})
```

- [ ] **Step 6: Run all tests**

```bash
npm test productivity-engine
```
Expected: All 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/engines/productivity-engine.ts src/lib/engines/productivity-engine.test.ts
git commit -m "feat(productivity): implement area-weighted day area calculation"
```

---

## Task 3: Slim time-engine.ts

**Files:**
- Replace: `src/lib/engines/time-engine.ts`
- Create: `src/lib/engines/time-engine.test.ts`

The current `time-engine.ts` (~250 LoC) has its own productivity calculation duplicating what productivity-engine now does. Slim it to a thin wrapper.

- [ ] **Step 1: Write failing test**

```ts
// src/lib/engines/time-engine.test.ts
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
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test time-engine
```
Expected: FAIL (signature mismatch with old `estimateTime`)

- [ ] **Step 3: Replace `time-engine.ts` entirely**

```ts
// src/lib/engines/time-engine.ts
export interface TimeEngineInput {
  total_area: number    // m²
  daily_area: number    // m²/day from productivity-engine
}

export interface TimeResult {
  pure_operation_days: number   // exact, unrounded
  suggested_days: number        // ceil(pure_operation_days), min 1
  total_area: number
  daily_area: number
  time_model_version: string
}

export function estimateTime(input: TimeEngineInput): TimeResult {
  const safeDaily = Math.max(input.daily_area, 1)   // guard div-by-zero
  const exact = input.total_area / safeDaily
  const days = Math.max(1, Math.ceil(exact))
  return {
    pure_operation_days: exact,
    suggested_days: days,
    total_area: input.total_area,
    daily_area: input.daily_area,
    time_model_version: "v2.0",
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test time-engine
```
Expected: All 3 pass.

- [ ] **Step 5: Verify type compile**

```bash
npx tsc --noEmit
```
Expected: errors only in QuoteStep3.tsx (consumer hasn't been updated yet — fine, that's Task 14).

- [ ] **Step 6: Commit**

```bash
git add src/lib/engines/time-engine.ts src/lib/engines/time-engine.test.ts
git commit -m "feat(time): slim engine to (area, daily_area) → days"
```

---

## Task 4: Pricing Params v2.0 Schema

**Files:**
- Replace: `src/lib/engines/pricing-params.ts`

Rewrite `PricingParams` to drop unit-price fields and add productivity + commute config.

- [ ] **Step 1: Replace `pricing-params.ts` entirely**

```ts
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
  final_discount: 0.9,

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
```

- [ ] **Step 2: Verify compiles (will fail in pricing-engine.ts consumer — expected)**

```bash
npx tsc --noEmit
```
Expected: errors in `pricing-engine.ts` (we replace it next task).

- [ ] **Step 3: Commit**

```bash
git add src/lib/engines/pricing-params.ts
git commit -m "feat(pricing-params): v2.0 schema with productivity + commute config"
```

---

## Task 5: Pricing Engine — TDD Implementation

**Files:**
- Replace: `src/lib/engines/pricing-engine.ts`
- Create: `src/lib/engines/pricing-engine.test.ts`
- Modify: `src/lib/types.ts` (add `CommuteResult` import path or define here)

- [ ] **Step 1: Add `CommuteResult` to types**

In `src/lib/types.ts`, append before the existing `PricingResult` interface:

```ts
// ─── Commute / Lodging ────────────────────────────────────────────────────────

export type CommuteMode = "daily" | "lodging"

export interface CommuteResult {
  mode: CommuteMode
  one_way_hours: number
  commute_fee: number
  fuel_fee: number
  lodging_fee: number
  origin_address: string
  destination_address: string
  cached_at?: string
  warning?: string                  // populated when Google API failed and we returned an estimate
}
```

Then update the existing `PricingResult` (replace the whole block) to include commute breakdown:

```ts
export interface PricingResult {
  line_items: PricingLineItem[]
  subtotal: number                  // labor before multipliers
  multiplier: number
  multiplier_breakdown: Record<string, number>
  labor_total: number               // labor after multipliers + min_order + discount
  commute_total: number             // commute_fee + fuel_fee + lodging_fee
  total: number                     // labor_total + commute_total (= final_price)
  final_price: number
  currency: string
  quote_code: string
  valid_until: string
  pricing_version: string
  requires_manual_review?: boolean
  manual_review_note?: string
  commute?: CommuteResult           // attached for display
  suggested_days?: number           // attached for display
  daily_area?: number               // attached for display
}
```

- [ ] **Step 2: Write failing pricing-engine test**

```ts
// src/lib/engines/pricing-engine.test.ts
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
    // labor = 4 × 40000 = 160000
    // m_floor = 1.0 (5F ≤ 10)
    // labor_with_mult = 160000
    // labor_after_min = 160000 (> 30000)
    // labor_after_disc = 144000 (× 0.9)
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
    // combined = 1.12 (25F) × 1.2 (weekend) × 1.33 (urgent) = 1.788
    // labor_with_mult = round(200000 × 1.788) = 357600
    // labor_after_disc = round(357600 × 0.9) = 321840
    expect(q.multiplier).toBeCloseTo(1.79, 2)
    expect(q.labor_total).toBe(321840)
  })

  it("flags manual review when combined multiplier > cap", () => {
    const q = generateQuote({
      suggested_days: 1,
      multipliers: { floors: 35, timeWindow: "night", urgent: true },
      commute: noCommute,
      facadeAreas: [],
    }, PRICING_PARAMS_DEFAULT)
    // combined = 1.25 × 1.5 × 1.33 = 2.49 → just under 2.5 cap
    // 35F + night + urgent should not require review
    expect(q.requires_manual_review).toBeFalsy()
  })

  it("min_order floor protects labor", () => {
    const q = generateQuote({
      suggested_days: 1,
      multipliers: { floors: 5, timeWindow: "day", urgent: false },
      commute: noCommute,
      facadeAreas: [],
    }, { ...PRICING_PARAMS_DEFAULT, daily_rate: 10000, min_order: 30000 })
    // labor = 10000, but min_order kicks in to 30000, then × 0.9 = 27000
    expect(q.labor_total).toBe(27000)
  })

  it("commute is added on top, not discounted", () => {
    const q = generateQuote({
      suggested_days: 4,
      multipliers: { floors: 5, timeWindow: "day", urgent: false },
      commute: { ...noCommute, commute_fee: 4000, fuel_fee: 1000 },
      facadeAreas: [],
    }, PRICING_PARAMS_DEFAULT)
    // labor_after_disc = 144000 (as test 1)
    // commute_total = 5000 (raw)
    // final = 149000
    expect(q.commute_total).toBe(5000)
    expect(q.final_price).toBe(149000)
  })
})
```

- [ ] **Step 3: Run, verify fail**

```bash
npm test pricing-engine
```
Expected: FAIL (function signature mismatch)

- [ ] **Step 4: Replace `pricing-engine.ts` entirely**

```ts
// src/lib/engines/pricing-engine.ts
import type {
  TimeWindow, PricingResult, PricingLineItem, CommuteResult,
} from "@/lib/types"
import type { PricingParams } from "./pricing-params"
import { getPricingParams } from "./pricing-params"

export interface PricingEngineInput {
  suggested_days: number
  multipliers: {
    floors: number
    timeWindow: TimeWindow
    urgent: boolean
  }
  commute: CommuteResult
  /** Per-facade area breakdown for line-item display (no unit price column) */
  facadeAreas: { label: string; area_m2: number }[]
  daily_area?: number
}

export function generateQuote(
  input: PricingEngineInput,
  params: PricingParams = getPricingParams(),
): PricingResult {
  const days = Math.max(1, Math.ceil(input.suggested_days))
  const labor_subtotal = days * params.daily_rate

  const m_floor  = params.floor_multiplier.find(f => input.multipliers.floors <= f.max_floor)?.multiplier ?? 1
  const m_time   = params.time_window_multiplier[input.multipliers.timeWindow] ?? 1
  const m_urgent = input.multipliers.urgent ? params.urgent_multiplier : 1
  const combined = m_floor * m_time * m_urgent

  const requires_manual_review = combined > params.quote_max_multiplier
  const final_m = Math.min(combined, params.quote_max_multiplier)
  const labor_with_mult = Math.round(labor_subtotal * final_m)

  const labor_after_min  = Math.max(labor_with_mult, params.min_order)
  const labor_after_disc = Math.round(labor_after_min * params.final_discount)

  const commute_total = Math.round(
    input.commute.commute_fee + input.commute.fuel_fee + input.commute.lodging_fee
  )

  const final_price = labor_after_disc + commute_total

  // ── Line items ────────────────────────────────────────────────────────────
  const line_items: PricingLineItem[] = []

  // Per-facade area (display only — no unit price column for customer)
  for (const f of input.facadeAreas) {
    line_items.push({
      code: `FACE-${f.label}`,
      label: `立面 ${f.label}（${f.area_m2.toLocaleString()}㎡）`,
      area_m2: f.area_m2,
      subtotal: 0, // intentionally 0 — not summed; pure display
    })
  }
  line_items.push({
    code: "LABOR",
    label: `作業費用（${days} 工作天）`,
    subtotal: labor_subtotal,
  })

  if (input.commute.commute_fee > 0) {
    const breakdown = input.commute.mode === "daily"
      ? `每日來回 ${input.commute.one_way_hours.toFixed(1)}h × ${days}天`
      : `來回 ${(input.commute.one_way_hours * 2).toFixed(1)}h（一次性）`
    line_items.push({
      code: "COMMUTE",
      label: `通勤交通（${breakdown}）`,
      subtotal: input.commute.commute_fee,
    })
  }
  if (input.commute.fuel_fee > 0) {
    line_items.push({
      code: "FUEL",
      label: `油資（${days}天）`,
      subtotal: input.commute.fuel_fee,
    })
  }
  if (input.commute.lodging_fee > 0) {
    line_items.push({
      code: "LODGING",
      label: `食宿（${days}晚 × 6,000）`,
      subtotal: input.commute.lodging_fee,
    })
  }
  if (labor_with_mult < params.min_order) {
    line_items.push({
      code: "MIN-ORDER",
      label: "最低案金保護",
      subtotal: params.min_order - labor_with_mult,
    })
  }

  const today = new Date()
  const validUntil = new Date(today)
  validUntil.setDate(today.getDate() + 30)
  const quoteCode = `Q-${today.toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 900 + 100)}`

  return {
    line_items,
    subtotal: labor_subtotal,
    multiplier: Math.round(combined * 100) / 100,
    multiplier_breakdown: { floor: m_floor, time_window: m_time, urgent: m_urgent },
    labor_total: labor_after_disc,
    commute_total,
    total: final_price,
    final_price,
    currency: "NTD",
    quote_code: quoteCode,
    valid_until: validUntil.toISOString().split("T")[0],
    pricing_version: params.version,
    requires_manual_review: requires_manual_review || undefined,
    manual_review_note: requires_manual_review
      ? `複合加乘 ${combined.toFixed(2)}× 超過系統上限 ${params.quote_max_multiplier}×，請人工確認`
      : undefined,
    commute: input.commute,
    suggested_days: days,
    daily_area: input.daily_area,
  }
}
```

- [ ] **Step 5: Run, verify all pass**

```bash
npm test pricing-engine
```
Expected: all 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/engines/pricing-engine.ts src/lib/engines/pricing-engine.test.ts src/lib/types.ts
git commit -m "feat(pricing): day-rate engine consuming productivity output"
```

---

## Task 6: Commute Cache Migration

**Files:**
- Create: `supabase/migrations/004_commute_cache.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/004_commute_cache.sql
-- Cache for Google Distance Matrix results (24h TTL)

create table public.commute_cache (
  id              uuid primary key default gen_random_uuid(),
  destination_lat numeric not null,
  destination_lng numeric not null,
  one_way_hours   numeric not null,
  google_response jsonb not null,
  created_at      timestamptz default now(),
  expires_at      timestamptz default (now() + interval '24 hours')
);

create index idx_commute_cache_destination on public.commute_cache (
  round(destination_lat, 4),
  round(destination_lng, 4)
);
create index idx_commute_cache_expires on public.commute_cache (expires_at);
```

- [ ] **Step 2: Apply manually to Supabase**

Open Supabase Studio → SQL editor → paste & run.
(No CLI step here because this repo doesn't have `supabase` CLI configured.)

- [ ] **Step 3: Verify table exists**

In SQL editor: `select * from commute_cache limit 1;`
Expected: 0 rows, no error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/004_commute_cache.sql
git commit -m "feat(db): add commute_cache table for Google API result caching"
```

---

## Task 7: Pricing Params v2.0 Migration

**Files:**
- Create: `supabase/migrations/003_pricing_params_v2.sql`

- [ ] **Step 1: Write migration with full v2.0 JSONB**

```sql
-- supabase/migrations/003_pricing_params_v2.sql
-- Demote v1.0 and insert v2.0 day-rate productivity params

update public.pricing_params set is_active = false where is_active = true;

insert into public.pricing_params (version, params, notes, is_active, created_by)
values (
  'v2.0',
  '{
    "daily_rate": 40000,
    "daily_base_area": 1500,
    "building_type_coeff": {"commercial":1.0,"luxury":1.0,"house":0.85,"factory":1.1,"solar":1.3},
    "height_coeff": [
      {"max_floor":10,"coeff":1.00},
      {"max_floor":20,"coeff":0.95},
      {"max_floor":30,"coeff":0.85},
      {"max_floor":9999,"coeff":0.70}
    ],
    "complexity_coeff": {"light":0.98,"medium":0.9,"heavy":0.7},
    "contamination_coeff": {"dust":1.0,"scale":0.85,"mold":0.9,"bird":0.83,"exhaust":0.82,"grease":0.8},
    "cleaning_agent_coeff": {"soft":1.0,"standard":0.95,"deep":0.85},
    "facade_modifiers": {
      "has_recesses":0.85,"is_high_risk":0.75,"adjacent_trees":0.9,
      "water_self_supply":0.85,"power_self_supply":0.9,
      "rooftop_limited":0.8,"rooftop_unavailable":0.6
    },
    "site_modifiers": {
      "region_exposure": {"windward":0.85,"leeward":1.0,"coastal":0.9,"rooftop_open":0.95},
      "crowd_density":   {"low":1.0,"medium":0.95,"high":0.85},
      "near_base_station":0.95,
      "wind_channel_effect":0.85
    },
    "commute_origin": {"lat":25.0495732,"lng":121.5576803,"address":"台北市松山區光復北路11巷46號"},
    "commute": {"fee_per_hour":2000,"daily_fuel_fee":1000,"lodging_per_day":6000,"lodging_threshold_hours":1.5},
    "floor_multiplier": [
      {"max_floor":10,"multiplier":1.00},
      {"max_floor":20,"multiplier":1.05},
      {"max_floor":30,"multiplier":1.12},
      {"max_floor":9999,"multiplier":1.25}
    ],
    "time_window_multiplier": {"day":1.0,"weekend":1.2,"night":1.5},
    "urgent_multiplier": 1.33,
    "min_order": 30000,
    "quote_max_multiplier": 2.5,
    "final_discount": 0.9,
    "version": "v2.0"
  }'::jsonb,
  'Day-rate productivity model + commute/lodging (redesign 2026-05)',
  true,
  'redesign-2026-05'
);
```

- [ ] **Step 2: Apply to Supabase**

SQL editor → paste & run.

- [ ] **Step 3: Verify**

```sql
select version, is_active from pricing_params order by created_at;
```
Expected: 2 rows — v1.0 (false), v2.0 (true).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/003_pricing_params_v2.sql
git commit -m "feat(db): seed pricing_params v2.0 with day-rate config"
```

---

## Task 8: Commute API Route — Google Distance Matrix

**Files:**
- Create: `src/app/api/commute/estimate/route.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add env var to example**

Append to `.env.example`:

```
# Google Maps Platform
GOOGLE_MAPS_BROWSER_KEY=        # restricted by HTTP referrer; exposed to browser
GOOGLE_MAPS_SERVER_KEY=         # restricted by IP/API; server-only (Distance Matrix, Places)
```

- [ ] **Step 2: Write the route**

```ts
// src/app/api/commute/estimate/route.ts
import { NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase/client"
import { PRICING_PARAMS_DEFAULT } from "@/lib/engines/pricing-params"
import type { CommuteResult } from "@/lib/types"

export const runtime = "nodejs"

interface RequestBody {
  destination_lat: number
  destination_lng: number
  work_days: number
}

export async function POST(request: Request) {
  let body: RequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!isFinite(body.destination_lat) || !isFinite(body.destination_lng) || body.work_days < 1) {
    return NextResponse.json({ error: "Invalid coordinates or work_days" }, { status: 400 })
  }

  const params = PRICING_PARAMS_DEFAULT // for thresholds + origin (server reads defaults; admin overrides come via /api/pricing-params client cache, server here uses defaults)

  // ── Try cache (rounded to 4 decimal ≈ 11 m precision) ─────────────────────
  const supabase = getSupabaseAdmin()
  const latRounded = Math.round(body.destination_lat * 10000) / 10000
  const lngRounded = Math.round(body.destination_lng * 10000) / 10000

  const { data: cached } = await supabase
    .from("commute_cache")
    .select("one_way_hours, google_response, created_at")
    .gte("expires_at", new Date().toISOString())
    .filter("destination_lat", "gte", latRounded - 0.0001)
    .filter("destination_lat", "lte", latRounded + 0.0001)
    .filter("destination_lng", "gte", lngRounded - 0.0001)
    .filter("destination_lng", "lte", lngRounded + 0.0001)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  let one_way_hours: number
  let cached_at: string | undefined
  let warning: string | undefined

  if (cached) {
    one_way_hours = Number(cached.one_way_hours)
    cached_at = cached.created_at as string
  } else {
    // ── Hit Google Distance Matrix ──────────────────────────────────────────
    const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY
    if (!apiKey) {
      return mockResponse(body, params, "Missing GOOGLE_MAPS_SERVER_KEY")
    }

    const origin = `${params.commute_origin.lat},${params.commute_origin.lng}`
    const destination = `${body.destination_lat},${body.destination_lng}`
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json`
              + `?origins=${origin}&destinations=${destination}`
              + `&departure_time=now&traffic_model=best_guess&key=${apiKey}`

    let google: unknown
    try {
      const res = await fetch(url)
      google = await res.json()
    } catch (err) {
      console.error("Google Distance Matrix error:", err)
      return mockResponse(body, params, "Google API request failed")
    }

    const g = google as {
      status: string
      rows?: Array<{
        elements?: Array<{
          status: string
          duration?: { value: number }
          duration_in_traffic?: { value: number }
        }>
      }>
    }

    const element = g.rows?.[0]?.elements?.[0]
    if (g.status !== "OK" || !element || element.status !== "OK") {
      console.warn("Google Distance Matrix returned non-OK:", g.status, element?.status)
      return mockResponse(body, params, `Google API status: ${g.status}/${element?.status}`)
    }

    const seconds = element.duration_in_traffic?.value ?? element.duration?.value ?? 0
    one_way_hours = seconds / 3600

    // Persist
    await supabase.from("commute_cache").insert({
      destination_lat: latRounded,
      destination_lng: lngRounded,
      one_way_hours,
      google_response: g,
    })
  }

  // ── Compute fees ────────────────────────────────────────────────────────────
  const c = params.commute
  const isLodging = one_way_hours > c.lodging_threshold_hours

  const round_trip_fee = Math.round(one_way_hours * 2 * c.fee_per_hour)
  const result: CommuteResult = isLodging
    ? {
        mode: "lodging",
        one_way_hours,
        commute_fee: round_trip_fee,                  // one-time
        fuel_fee: 0,
        lodging_fee: c.lodging_per_day * body.work_days,
        origin_address: params.commute_origin.address,
        destination_address: `${body.destination_lat},${body.destination_lng}`,
        cached_at, warning,
      }
    : {
        mode: "daily",
        one_way_hours,
        commute_fee: round_trip_fee * body.work_days, // per day
        fuel_fee: c.daily_fuel_fee * body.work_days,
        lodging_fee: 0,
        origin_address: params.commute_origin.address,
        destination_address: `${body.destination_lat},${body.destination_lng}`,
        cached_at, warning,
      }

  return NextResponse.json(result)
}

function mockResponse(body: RequestBody, params: typeof PRICING_PARAMS_DEFAULT, warning: string) {
  // Fallback: assume 1hr one-way → daily mode estimate
  const c = params.commute
  const result: CommuteResult = {
    mode: "daily",
    one_way_hours: 1,
    commute_fee: 1 * 2 * c.fee_per_hour * body.work_days,
    fuel_fee: c.daily_fuel_fee * body.work_days,
    lodging_fee: 0,
    origin_address: params.commute_origin.address,
    destination_address: `${body.destination_lat},${body.destination_lng}`,
    warning,
  }
  return NextResponse.json(result)
}
```

- [ ] **Step 3: Test manually with curl (no Google key needed — fallback fires)**

Start dev server: `npm run dev`
Then:

```bash
curl -X POST http://localhost:3001/api/commute/estimate \
  -H "Content-Type: application/json" \
  -d '{"destination_lat":24.1477,"destination_lng":120.6736,"work_days":3}'
```
Expected JSON contains `"warning": "Missing GOOGLE_MAPS_SERVER_KEY"`, `"mode": "daily"`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/commute/estimate/route.ts .env.example
git commit -m "feat(commute): add Google Distance Matrix API route with cache + fallback"
```

---

## Task 9: Commute Engine Client Wrapper

**Files:**
- Create: `src/lib/engines/commute-engine.ts`

- [ ] **Step 1: Write the wrapper**

```ts
// src/lib/engines/commute-engine.ts
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
```

- [ ] **Step 2: Verify type compile**

```bash
npx tsc --noEmit
```
Expected: no new errors in this file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/engines/commute-engine.ts
git commit -m "feat(commute): client wrapper for /api/commute/estimate"
```

---

## Task 10: Google Maps SDK Setup

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Google Maps loader, remove Leaflet**

```bash
cd /Users/drone168-1/quote-page
npm install @googlemaps/js-api-loader
npm uninstall leaflet @types/leaflet
```

- [ ] **Step 2: Verify install**

```bash
grep -E '"(leaflet|@googlemaps)' package.json
```
Expected: `@googlemaps/js-api-loader` present, no `leaflet` lines.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: swap leaflet for @googlemaps/js-api-loader"
```

---

## Task 11: QuoteMap Rewrite — Google Maps JS API

**Files:**
- Replace: `src/app/components/QuoteMap.tsx`

This is the biggest UI task. Keep the props interface identical so consumers in QuoteStep1/2 don't need updates.

- [ ] **Step 1: Replace QuoteMap.tsx entirely**

```tsx
// src/app/components/QuoteMap.tsx
"use client"

import { useEffect, useRef } from "react"
import { Loader } from "@googlemaps/js-api-loader"
import type { AirspaceResult } from "@/lib/types"

export interface PersistedShape {
  vertices: [number, number][]
  label: string
  edgeLabels?: string[]
}

interface Props {
  lat: number
  lng: number
  airspace: AirspaceResult | null
  drawMode?: boolean
  drawLabel?: string
  persistedShapes?: PersistedShape[]
  onPolygonDraw?: (vertices: [number, number][], area_m2: number, perimeter_m: number) => void
  onDrawModeEnd?: () => void
  onPositionChange?: (lat: number, lng: number) => void
  mapContainerRef?: (el: HTMLDivElement | null) => void
}

let mapsLoaderPromise: Promise<typeof google> | null = null

function loadMaps(): Promise<typeof google> {
  if (mapsLoaderPromise) return mapsLoaderPromise
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? ""
  if (!apiKey) {
    console.warn("NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY not set; map will fail")
  }
  const loader = new Loader({
    apiKey,
    version: "weekly",
    libraries: ["geometry", "drawing"],
  })
  mapsLoaderPromise = loader.load()
  return mapsLoaderPromise
}

export function QuoteMap({
  lat, lng, airspace,
  drawMode, drawLabel, persistedShapes,
  onPolygonDraw, onDrawModeEnd, onPositionChange,
  mapContainerRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markerRef = useRef<google.maps.Marker | null>(null)
  const drawingManagerRef = useRef<google.maps.drawing.DrawingManager | null>(null)
  const persistedPolygonsRef = useRef<google.maps.Polygon[]>([])
  const persistedLabelsRef = useRef<google.maps.OverlayView[]>([])

  // ── Initialize map (once) ─────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    if (mapContainerRef) mapContainerRef(containerRef.current)
    let cancelled = false
    loadMaps().then(g => {
      if (cancelled || !containerRef.current) return
      const map = new g.maps.Map(containerRef.current, {
        center: { lat, lng },
        zoom: 19,
        mapTypeId: g.maps.MapTypeId.HYBRID,
        streetViewControl: false,
        mapTypeControl: false,
      })
      mapRef.current = map

      const marker = new g.maps.Marker({
        map, position: { lat, lng },
        draggable: !!onPositionChange,
      })
      markerRef.current = marker

      if (onPositionChange) {
        marker.addListener("dragend", () => {
          const p = marker.getPosition()
          if (p) onPositionChange(p.lat(), p.lng())
        })
        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (drawMode) return
          if (!e.latLng) return
          marker.setPosition(e.latLng)
          onPositionChange(e.latLng.lat(), e.latLng.lng())
        })
      }
    })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── React to lat/lng changes ──────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return
    const pos = { lat, lng }
    mapRef.current.setCenter(pos)
    markerRef.current.setPosition(pos)
  }, [lat, lng])

  // ── Drawing manager ───────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    loadMaps().then(g => {
      if (!drawMode) {
        drawingManagerRef.current?.setMap(null)
        drawingManagerRef.current = null
        return
      }
      const dm = new g.maps.drawing.DrawingManager({
        drawingMode: g.maps.drawing.OverlayType.POLYGON,
        drawingControl: false,
        polygonOptions: {
          fillColor: "#2563eb", fillOpacity: 0.2,
          strokeColor: "#2563eb", strokeWeight: 2,
          editable: false, draggable: false,
        },
      })
      dm.setMap(map)
      drawingManagerRef.current = dm

      const listener = dm.addListener("polygoncomplete", (poly: google.maps.Polygon) => {
        const path = poly.getPath()
        const verts: [number, number][] = []
        for (let i = 0; i < path.getLength(); i++) {
          const ll = path.getAt(i)
          verts.push([ll.lat(), ll.lng()])
        }
        const area_m2 = g.maps.geometry.spherical.computeArea(path)
        const perimeter_m = g.maps.geometry.spherical.computeLength(path)
        poly.setMap(null) // remove the temporary draw, persistedShapes will redraw
        onPolygonDraw?.(verts, area_m2, perimeter_m)
        onDrawModeEnd?.()
      })

      return () => { g.maps.event.removeListener(listener) }
    })
  }, [drawMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render persisted shapes ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // Clear previous
    persistedPolygonsRef.current.forEach(p => p.setMap(null))
    persistedLabelsRef.current.forEach(l => l.setMap(null))
    persistedPolygonsRef.current = []
    persistedLabelsRef.current = []

    if (!persistedShapes?.length) return

    loadMaps().then(g => {
      for (const shape of persistedShapes) {
        const path = shape.vertices.map(([lat, lng]) => ({ lat, lng }))
        const poly = new g.maps.Polygon({
          map, paths: path,
          fillColor: "#10b981", fillOpacity: 0.25,
          strokeColor: "#059669", strokeWeight: 2,
        })
        persistedPolygonsRef.current.push(poly)

        if (shape.edgeLabels) {
          for (let i = 0; i < shape.vertices.length; i++) {
            const a = shape.vertices[i]
            const b = shape.vertices[(i + 1) % shape.vertices.length]
            const mid = { lat: (a[0] + b[0]) / 2, lng: (a[1] + b[1]) / 2 }
            const label = createTextOverlay(g, map, mid, shape.edgeLabels[i] ?? `${i + 1}面`)
            persistedLabelsRef.current.push(label)
          }
        }
      }
    })
  }, [persistedShapes])

  return (
    <div ref={containerRef} className="w-full h-[400px] rounded-lg border border-zinc-300" />
  )
}

// ── Text overlay (edge label) ─────────────────────────────────────────────────

function createTextOverlay(
  g: typeof google,
  map: google.maps.Map,
  position: google.maps.LatLngLiteral,
  text: string,
): google.maps.OverlayView {
  class TextOverlay extends g.maps.OverlayView {
    private div: HTMLDivElement | null = null
    onAdd() {
      const div = document.createElement("div")
      div.style.position = "absolute"
      div.style.background = "white"
      div.style.padding = "2px 6px"
      div.style.borderRadius = "4px"
      div.style.fontSize = "12px"
      div.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)"
      div.style.pointerEvents = "none"
      div.textContent = text
      this.div = div
      this.getPanes()?.overlayLayer.appendChild(div)
    }
    draw() {
      if (!this.div) return
      const proj = this.getProjection()
      if (!proj) return
      const p = proj.fromLatLngToDivPixel(new g.maps.LatLng(position))
      if (!p) return
      this.div.style.left = `${p.x - 20}px`
      this.div.style.top  = `${p.y - 12}px`
    }
    onRemove() {
      this.div?.remove()
      this.div = null
    }
  }
  const overlay = new TextOverlay()
  overlay.setMap(map)
  return overlay
}

// Suppress unused import warnings
void airspace; void drawLabel
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: type errors only in unrelated files.

- [ ] **Step 3: Visual smoke test**

```bash
echo "NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=YOUR_KEY_HERE" >> .env.local
npm run dev
```
Open http://localhost:3001, type an address, hit search → expect map to load with hybrid satellite, marker visible, draggable.

- [ ] **Step 4: Commit**

```bash
git add src/app/components/QuoteMap.tsx
git commit -m "feat(map): rewrite QuoteMap with Google Maps JS API + Drawing Library"
```

---

## Task 12: Geocode API — Google Places

**Files:**
- Replace: `src/app/api/geocode/route.ts`

- [ ] **Step 1: Replace route**

```ts
// src/app/api/geocode/route.ts
import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")?.trim()
  if (!q || q.length < 2) {
    return NextResponse.json({ status: "failed", reason: "查詢字串太短" })
  }

  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) {
    return NextResponse.json({ status: "failed", reason: "Server Google API key 未設定" })
  }

  const body = {
    textQuery: q,
    languageCode: "zh-TW",
    regionCode: "TW",
    pageSize: 1,
  }

  let json: unknown
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.formattedAddress",
      },
      body: JSON.stringify(body),
    })
    json = await res.json()
  } catch (err) {
    console.error("Google Places error:", err)
    return NextResponse.json({ status: "failed", reason: "Google API 請求失敗" })
  }

  const j = json as {
    places?: Array<{
      id: string
      displayName?: { text: string }
      location?: { latitude: number; longitude: number }
      formattedAddress?: string
    }>
  }

  const place = j.places?.[0]
  if (!place || !place.location) {
    return NextResponse.json({ status: "failed", reason: "找不到此地址或建案名稱" })
  }

  return NextResponse.json({
    status: "success",
    lat: place.location.latitude,
    lng: place.location.longitude,
    displayName: place.displayName?.text ?? null,
    formattedAddress: place.formattedAddress ?? null,
    place_id: place.id,
  })
}
```

- [ ] **Step 2: Smoke test**

```bash
# With GOOGLE_MAPS_SERVER_KEY set in .env.local
npm run dev
curl 'http://localhost:3001/api/geocode?q=台北101' | jq
```
Expected: `{ status: "success", lat: 25.0..., lng: 121.5..., displayName: "Taipei 101" }` (or similar).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/geocode/route.ts
git commit -m "feat(geocode): swap Nominatim for Google Places Text Search"
```

---

## Task 13: Delete Overpass + Cleanup

**Files:**
- Delete: `src/app/api/overpass/route.ts` (and parent dir if empty)

- [ ] **Step 1: Delete the route**

```bash
rm -rf src/app/api/overpass
```

- [ ] **Step 2: Search for any remaining import references**

```bash
grep -rn "overpass" src/ --include="*.ts" --include="*.tsx"
```
Expected: only `QuoteStep1.tsx` should still reference it (cleaned in Task 14).

- [ ] **Step 3: Commit**

```bash
git add -A src/app/api/
git commit -m "chore(overpass): remove route — auto-detection of building polygon dropped"
```

---

## Task 14: QuoteStep1 — Drop Overpass + Use Google Place Name

**Files:**
- Modify: `src/app/components/QuoteStep1.tsx`

- [ ] **Step 1: Strip overpass call from `refetchForPosition`**

In `QuoteStep1.tsx`, replace the `refetchForPosition` callback (around line 68-91):

```ts
const refetchForPosition = useCallback(async (lat: number, lng: number) => {
  setPosUpdating(true)
  try {
    const airRes = await fetch(`/api/airspace/query?lat=${lat}&lng=${lng}`)
    setAirspace(await airRes.json())
  } catch { /* non-critical */ }
  finally { setPosUpdating(false) }
}, [setAirspace])
```

- [ ] **Step 2: Remove unused setters from props destructure and Props interface**

Update `Props` interface (top of file):

```ts
interface Props {
  formData: Partial<QuoteFormData>
  updateForm: (patch: Partial<QuoteFormData>) => void
  airspace: AirspaceResult | null
  setAirspace: (a: AirspaceResult | null) => void
  setBuildingName: (n: string | null) => void
  buildingName: string | null
  onNext: () => void
}
```

(Remove `setBuildingPerimeter`, `setBuildingPolygon`, `setBuildingDimensions`)

- [ ] **Step 3: Remove all `setBuildingPerimeter / setBuildingPolygon / setBuildingDimensions` calls in handlers**

In `handleGeocode`, `handleMyLocation`, and `handleCoordApply`, remove:
```ts
setBuildingPerimeter(null)
setBuildingPolygon(null)
setBuildingDimensions(null)
```

- [ ] **Step 4: In `handleGeocode`, use Google's `displayName` for building name**

The new `/api/geocode` returns `displayName`. Already used at line 122. No change needed.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: errors in `page.tsx` (consumer — fixed in Task 17).

- [ ] **Step 6: Commit**

```bash
git add src/app/components/QuoteStep1.tsx
git commit -m "refactor(step1): remove overpass building polygon detection"
```

---

## Task 15: QuoteStep2 — Manual Draw Only

**Files:**
- Modify: `src/app/components/QuoteStep2.tsx`

- [ ] **Step 1: Strip Overpass-derived prefill from estimate-area effect**

In `QuoteStep2.tsx`, find the area-estimate `useEffect` (around line 122-142). Update the priority chain to remove `buildingDimensions` and `buildingPerimeter` branches:

```ts
useEffect(() => {
  const hasDrawn = drawnPolygons.some(p => p != null)
  if (numBuildings > 1 && hasDrawn) {
    setAreaEstimate(estimateFromMultiPerimeters(
      drawnPolygons.map(p => p?.perimeter_m ?? null),
      numBuildings, floors, numFacades, perBuildingNumFacades, ho,
    ))
  } else if (drawnPolygons[0]) {
    setAreaEstimate(estimateFromPerimeter(drawnPolygons[0].perimeter_m, floors, numFacades, "manual-draw", ho))
  } else if (overrideWidth && Number(overrideWidth) > 0) {
    const w = Number(overrideWidth)
    setAreaEstimate(estimateFromPerimeter(w * numFacades, floors, numFacades, "manual-draw", ho))
  } else {
    setAreaEstimate(estimateFromDefaults(buildingType, floors, numFacades, ho))
  }
}, [floors, heightMode, effectiveHeight, numFacades, numBuildings, buildingType, overrideWidth, drawnPolygons, setAreaEstimate]) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 2: Update Props interface — remove `buildingPerimeter`, `buildingPolygon`, `buildingDimensions`**

```ts
interface Props {
  formData: Partial<QuoteFormData>
  updateForm: (patch: Partial<QuoteFormData>) => void
  areaEstimate: AreaEstimate | null
  setAreaEstimate: (a: AreaEstimate) => void
  onNext: () => void
  onBack: () => void
  mapContainerRef?: (el: HTMLDivElement | null) => void
}
```

- [ ] **Step 3: Remove `numFacades` auto-derive from `buildingPolygon`**

In the auto-derive useEffect (around line 80-99), remove the `else if (buildingPolygon && ...)` branch. The same for `perBuildingNumFacades` (around line 70-76):

```ts
const perBuildingNumFacades: number[] = Array.from({ length: numBuildings }, (_, b) => {
  const poly = drawnPolygons[b]
  if (poly && poly.vertices.length === 2) return 1
  if (poly && poly.vertices.length >= 3) return poly.vertices.length
  return numFacades
})
```

- [ ] **Step 4: Remove "建物尺寸 (Overpass)" display block**

Around line 546-553, delete the conditional block referencing `buildingDimensions`:

```tsx
// DELETE this block:
{buildingDimensions && buildingDimensions.width_m > 0 && !drawnPolygons.some(p => p != null) && (
  <p className="font-medium">
    建物尺寸：{buildingDimensions.width_m} × {buildingDimensions.depth_m} m
    ...
  </p>
)}
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: errors only in `page.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/QuoteStep2.tsx
git commit -m "refactor(step2): manual polygon draw only; remove buildingDimensions prefill"
```

---

## Task 16: page.tsx State Cleanup

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Remove building-polygon state + props**

In `src/app/page.tsx`, delete these lines (around line 36-39):

```ts
// DELETE:
const [buildingPerimeter, setBuildingPerimeter] = useState<number | null>(null)
const [buildingPolygon, setBuildingPolygon] = useState<{ lat: number; lon: number }[] | null>(null)
const [buildingDimensions, setBuildingDimensions] = useState<BuildingDimensions | null>(null)
```

- [ ] **Step 2: Remove ref-mirroring**

Delete (around line 49-56):

```ts
// DELETE:
const buildingPolygonRef = useRef(buildingPolygon)
useEffect(() => { buildingPolygonRef.current = buildingPolygon }, [buildingPolygon])
```

- [ ] **Step 3: Remove from `saveDraft` body**

In `saveDraft` body (around line 73-85), remove `building_polygon: buildingPolygonRef.current,`.

- [ ] **Step 4: Update `<QuoteStep1>` and `<QuoteStep2>` JSX — remove deleted props**

```tsx
// QuoteStep1: remove setBuildingPerimeter, setBuildingPolygon, setBuildingDimensions props
<QuoteStep1
  formData={formData}
  updateForm={updateForm}
  airspace={airspace}
  setAirspace={setAirspace}
  setBuildingName={setBuildingName}
  buildingName={buildingName}
  onNext={goNext}
/>

// QuoteStep2: remove buildingPerimeter, buildingPolygon, buildingDimensions props
<QuoteStep2
  formData={formData}
  updateForm={updateForm}
  areaEstimate={areaEstimate}
  setAreaEstimate={setAreaEstimate}
  onNext={goNext}
  onBack={goBack}
  mapContainerRef={mapContainerCb}
/>
```

- [ ] **Step 5: Reset block — remove deleted setters**

In `reset()` (around line 109-116), remove:
```ts
setBuildingPerimeter(null)
setBuildingPolygon(null)
setBuildingDimensions(null)
```

- [ ] **Step 6: Update import — drop `BuildingDimensions`**

```ts
// Top of file:
import type { QuoteFormData, AreaEstimate } from "./components/quote-defaults"
// (remove BuildingDimensions from this import)
```

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit
```
Expected: clean (or only QuoteStep3 errors, fixed next task).

- [ ] **Step 8: Commit**

```bash
git add src/app/page.tsx
git commit -m "refactor(page): drop building polygon state — manual draw only"
```

---

## Task 17: QuoteStep3 — Sequential Engine Wiring

**Files:**
- Modify: `src/app/components/QuoteStep3.tsx`

- [ ] **Step 1: Replace the calculation `useEffect` with sequential chain**

Replace the existing `useEffect` (around line 52-99):

```tsx
import { computeDailyArea } from "@/lib/engines/productivity-engine"
import { estimateTime } from "@/lib/engines/time-engine"
import { generateQuote } from "@/lib/engines/pricing-engine"
import { estimateCommute } from "@/lib/engines/commute-engine"
import { getPricingParams } from "@/lib/engines/pricing-params"

// ...

useEffect(() => {
  let cancelled = false
  ;(async () => {
    // Build per-facade areas for productivity weighting
    const facades = formData.facadeInputs ?? []
    const totalArea = areaEstimate.project_total_m2
      ?? (areaEstimate.total_area_m2 * (formData.numBuildings ?? 1))
    // Approximate: each facade gets equal share of totalArea (UI lacks exact per-facade widths)
    const facadeAreas_m2 = facades.length > 0
      ? facades.map(() => totalArea / facades.length)
      : []

    const params = getPricingParams()

    const effectiveFloors = formData.heightMode === "height" && formData.heightM
      ? Math.ceil(formData.heightM / 3.5)
      : formData.floors

    // 1. Daily area
    const { daily_area } = computeDailyArea({
      buildingType: formData.buildingType,
      floors: effectiveFloors,
      facadeInputs: facades,
      facadeAreas_m2,
      rooftopAccess: formData.rooftopAccess ?? "Good",
      cleaningAgent: formData.cleaningAgent ?? "standard",
      regionExposure: formData.regionExposure,
      crowdDensity: formData.crowdDensity,
      nearBaseStation: formData.nearBaseStation,
      windChannelEffect: formData.windChannelEffect,
    }, params)

    // 2. Work days
    const time = estimateTime({ total_area: totalArea, daily_area })
    if (cancelled) return
    setTimeResult(time)

    // 3. Commute (async)
    const commute = await estimateCommute(formData.lat, formData.lng, time.suggested_days)
    if (cancelled) return

    // 4. Final price
    const facadeAreaItems = facades.length > 0
      ? facades.map((f, i) => ({
          label: f.buildingLabel ? `${f.buildingLabel}棟-${f.label}` : f.label,
          area_m2: Math.round(facadeAreas_m2[i] ?? 0),
        }))
      : []

    const quote = generateQuote({
      suggested_days: time.suggested_days,
      multipliers: {
        floors: effectiveFloors,
        timeWindow: (formData.timeSlot ?? "day") as "day" | "weekend" | "night",
        urgent: formData.urgent ?? false,
      },
      commute,
      facadeAreas: facadeAreaItems,
      daily_area,
    }, params)
    if (cancelled) return
    setPricing(quote)
  })()
  return () => { cancelled = true }
}, [formData, areaEstimate, setPricing, setTimeResult])
```

- [ ] **Step 2: Remove old `buildFacades*`, `allContaminationTypes`, `aggregateSupply`, `mapTimeSlot` imports**

Drop these from the top of `QuoteStep3.tsx`:
```ts
// DELETE:
import {
  buildFacadesFromInputs, buildFacades,
  allContaminationTypes, aggregateSupply,
  mapServiceToMissionType, mapTimeSlot,
  getWeatherRisk,
} from "./quote-defaults"
```
Replace with:
```ts
import { getWeatherRisk } from "./quote-defaults"
```

- [ ] **Step 3: Replace `facadeGeometry` useMemo with line-item lookup**

Delete the `facadeGeometry` useMemo block (around line 102-115). Replace with a small lookup helper inside the component:

```tsx
// Replace useMemo block with:
const facadeAreaByLabel = useMemo(() => {
  const map = new Map<string, number>()
  if (!pricing) return map
  for (const item of pricing.line_items) {
    if (item.code.startsWith("FACE-") && item.area_m2 != null) {
      map.set(item.code.slice("FACE-".length), item.area_m2)
    }
  }
  return map
}, [pricing])

const heightForDisplay = areaEstimate.building_height_m
```

Then update the per-facade table JSX (around line 207-242). Replace each row's data cells:

```tsx
{formData.facadeInputs.map((f) => {
  const labelKey = f.buildingLabel ? `${f.buildingLabel}棟-${f.label}` : f.label
  const area = facadeAreaByLabel.get(labelKey) ?? 0
  const width = heightForDisplay > 0 ? Math.round((area / heightForDisplay) * 10) / 10 : 0
  return (
    <tr key={f.id} className="border-b border-zinc-100">
      <td className="py-2 font-semibold text-zinc-800">{labelKey}</td>
      <td className="text-right py-2 text-zinc-600">{heightForDisplay}m</td>
      <td className="text-right py-2 text-zinc-600">{width}m</td>
      <td className="text-right py-2 text-zinc-700 font-medium">
        {area.toLocaleString()} ㎡
      </td>
      <td className="py-2 pl-3 text-zinc-500">
        {/* keep the existing "狀況" tags block as-is */}
        ...
      </td>
    </tr>
  )
})}
```

(The `狀況` cell — the inner div with complexity / hasRecesses / isHighRisk / hasAdjacentTrees / waterSupply / powerSupply tags — stays exactly as it was.)

- [ ] **Step 4: Show commute warning banner when `commute.warning` present**

Add right after the Total block (around line 322-334):

```tsx
{pricing.commute?.warning && (
  <div className="mx-6 mb-4 px-4 py-3 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 text-sm">
    ⚠️ 通勤費為估算值（{pricing.commute.warning}）— 實際以現勘為準
  </div>
)}
```

- [ ] **Step 5: Type-check + lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/QuoteStep3.tsx
git commit -m "refactor(step3): sequential productivity → time → commute → pricing chain"
```

---

## Task 18: Update Admin Params UI for v2.0

**Files:**
- Modify: `src/app/admin/params/page.tsx`

The current admin page renders fields for v1.0. Add v2.0 sections. Keep existing fields editable for backward viewing of historical versions.

- [ ] **Step 1: Read current admin page**

```bash
sed -n '1,40p' src/app/admin/params/page.tsx
```
Familiarize with the form pattern.

- [ ] **Step 2: Add v2.0 section editors**

Append (or restructure) the params editor to surface these new groups under collapsible sections:

- `daily_rate` (single number input)
- `daily_base_area` (single number input)
- `building_type_coeff` (5 inputs: commercial/luxury/house/factory/solar)
- `height_coeff` (4-row table editor)
- `complexity_coeff` (3 inputs)
- `contamination_coeff` (6 inputs)
- `cleaning_agent_coeff` (3 inputs)
- `facade_modifiers` (7 inputs)
- `site_modifiers.region_exposure` (4 inputs)
- `site_modifiers.crowd_density` (3 inputs)
- `site_modifiers.near_base_station` / `wind_channel_effect` (2 inputs)
- `commute_origin` (lat/lng/address text)
- `commute` (4 inputs: fee_per_hour / daily_fuel_fee / lodging_per_day / lodging_threshold_hours)

Keep the existing top-level fields (`floor_multiplier`, `time_window_multiplier`, `urgent_multiplier`, `min_order`, `quote_max_multiplier`, `final_discount`) — they're still in v2.0.

Remove the v1.0-only sections (`base_price`, `complexity_surcharge`, `contamination_surcharge`, `cleaning_agent_surcharge`, `facade_surcharges`, `supply_surcharges`, `contamination_cap`).

**Concrete pattern for one section** (use as template for all coefficient `Record<K, number>` groups):

```tsx
<section className="border border-zinc-200 rounded-lg p-4">
  <h3 className="text-sm font-semibold text-zinc-700 mb-3">建物類型係數 building_type_coeff</h3>
  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
    {(Object.keys(params.building_type_coeff) as Array<keyof typeof params.building_type_coeff>).map(k => (
      <label key={k} className="text-xs">
        <span className="block text-zinc-500 mb-1">{k}</span>
        <input
          type="number" step="0.01" min="0"
          value={params.building_type_coeff[k]}
          onChange={e => setParams({
            ...params,
            building_type_coeff: { ...params.building_type_coeff, [k]: Number(e.target.value) },
          })}
          className="w-full px-2 py-1.5 border border-zinc-300 rounded text-sm"
        />
      </label>
    ))}
  </div>
</section>
```

For scalar fields (`daily_rate`, `daily_base_area`, individual `site_modifiers.near_base_station`, etc.), use a single labeled `<input type="number">`. For nested record sections (e.g. `site_modifiers.region_exposure`), nest the same pattern one level deeper.

- [ ] **Step 3: Manual smoke test**

```bash
npm run dev
# Visit http://localhost:3001/admin/params
```
Expected: all v2.0 fields visible with current values; saving creates a new version row in DB.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/params/page.tsx
git commit -m "feat(admin): v2.0 productivity + commute coefficient editors"
```

---

## Task 19: PDF Generator Backward-Compat Branch

**Files:**
- Modify: `src/lib/pdf/generate-quote-pdf.ts`

- [ ] **Step 1: Read current PDF generator**

```bash
sed -n '1,40p' src/lib/pdf/generate-quote-pdf.ts
```

- [ ] **Step 2: Add version branch at the top of the line-item rendering block**

Wherever the PDF renders the breakdown table, add:

```ts
const isV2 = pricing.pricing_version?.startsWith("v2")

if (isV2) {
  // New layout: facade areas (no unit price column), labor line, commute, lodging,
  // multipliers section, totals. Reuse the existing helpers.
  renderV2LineItems(pricing)   // implement using existing renderRow / renderTable utilities
} else {
  // Legacy v1: original per-facade unit price layout (untouched)
  renderV1LineItems(pricing)
}
```

The existing implementation becomes `renderV1LineItems`. The new `renderV2LineItems` adapts the tables to the v2 line item shape (no `unit_price` column for FACE-* items; commute/lodging/fuel as their own rows).

- [ ] **Step 3: Smoke test PDF generation**

```bash
# In dev: complete a quote, click "下載 PDF"
```
Expected: PDF generates without crash; layout matches new line items.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pdf/generate-quote-pdf.ts
git commit -m "feat(pdf): branch on pricing_version for v1/v2 layout"
```

---

## Task 20: Manual E2E Validation

**Files:** None modified.

This task is a checklist run against `npm run dev` with a real `GOOGLE_MAPS_BROWSER_KEY` + `GOOGLE_MAPS_SERVER_KEY` set in `.env.local`.

- [ ] **Step 1: Taipei case (daily commute mode)**

  Address: `台北市信義區松仁路100號` (Taipei 101 area)
  Building: 商辦, 15F, 4 facades light/dust
  Time: 白天, not urgent
  Expected:
  - Quote shows `4 工作天`-ish (depending on tuning)
  - Commute line says `每日來回ish hr × 4天`
  - No lodging line
  - Fuel resource line present

- [ ] **Step 2: Tainan case (lodging mode)**

  Address: `台南市中西區民生路二段100號`
  Same building config.
  Expected:
  - Commute line says `來回 ~7h（一次性）`
  - Lodging line shows `4晚 × 6,000 = 24,000`
  - No fuel line

- [ ] **Step 3: Multi-building, mixed conditions**

  3 buildings drawn manually. Mix complexities (light, medium, heavy) and contamination.
  Expected:
  - Step 2 face count auto-derives per building
  - Step 3 shows daily_area weighted toward the bigger building's complexity

- [ ] **Step 4: Multiplier composition**

  Building: 25F, weekend, urgent.
  Expected: combined multiplier ≈ 1.79; quote scales accordingly.

- [ ] **Step 5: Min-order trigger**

  Building: 商辦, 5F, single 50㎡ facade.
  Expected: labor floors at 30,000 before discount.

- [ ] **Step 6: Manual review trigger**

  Building: 35F, night, urgent.
  Expected: amber banner says "請人工確認", `requires_manual_review: true` in pricing.

- [ ] **Step 7: Google API failure simulation**

  Temporarily unset `GOOGLE_MAPS_SERVER_KEY` in `.env.local`, restart dev server.
  Expected: amber warning "通勤費為估算值" in Step 3, default daily mode estimate.

- [ ] **Step 8: Backward compat — old quote retrieval**

  In Supabase Studio, manually insert a v1.0 quote row (or use one already present from previous quotes).
  Visit `/quote/<old_quote_code>` (or the LINE webhook flow).
  Expected: PDF/preview renders with v1 layout, no crash.

- [ ] **Step 9: No commit needed for this task**

  This is a validation gate, not a code change.

---

## Final Checklist

- [ ] All 20 tasks committed
- [ ] `npm test` shows engine tests passing (productivity, time, pricing)
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] `npm run build` succeeds
- [ ] Manual E2E (Task 20) passes
- [ ] Migration 003 + 004 applied to Supabase
- [ ] `.env.local` has both Google keys; `.env.example` updated
- [ ] Open PR against `main`
