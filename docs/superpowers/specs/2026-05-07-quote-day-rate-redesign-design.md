# Quote Flow Redesign — Day-Rate Pricing + Google Maps

**Date:** 2026-05-07
**Status:** Approved (brainstorming complete, awaiting impl)
**Owner:** Makd
**Repo:** `general-drone-service/quote-page`

## Problem

The current quote engine uses a per-facade unit-price model: every facade gets `base + complexity + facade_surcharges + supply + project-wide` summed and multiplied by `floor × time × urgent`. This was lifted from the upstream LAOP project and never actually fit the day-driven cost reality of drone external-cleaning operations.

Side-effects of the mismatch:

- 14 fields collected per facade, but `regionExposure` / `crowdDensity` / `nearBaseStation` / `windChannelEffect` / `clearanceM` / `expectedDate` / `serviceType` were captured and **silently dropped** before reaching the engine.
- `wind_ms` was hardcoded to `4`, `riskLevel` to `R0`.
- Time engine and pricing engine ran in parallel as independent calculations of the same thing.
- No commute or lodging modelling — costs that dominate quotes for sites outside Greater Taipei.
- Map / address stack uses Leaflet + OSM Overpass + Nominatim, which are off-strategy (Google was the original intent).

## Goal

Replace the pricing model with a **productivity-driven day-rate** formula and migrate map/address from OSM to Google Maps Platform.

```
work_days  = ceil(total_area / daily_area)
labor      = work_days × daily_rate × (high_rise × time_window × urgent)  [capped, min-protected, discounted]
travel     = commute_fee + fuel_fee + lodging_fee   (not discounted)
final      = labor + travel
```

Customer-facing display **does not show the daily rate**; only `<n> 工作天` and the totals.

## Decisions Recorded From Brainstorming

| Topic | Decision |
|---|---|
| Daily rate | `40000` NTD/day (internal: cost 20000 × 2 markup; not exposed to customer) |
| Daily base area | `1500 m²/day` (then adjusted by all the coefficients below) |
| Per-facade aggregation | **Area-weighted average** across facades |
| Facade UI | All 14 fields kept; their effect moves from "unit price" to "daily area" |
| Multipliers kept | urgent (+33%), weekend (×1.2) / night (×1.5), high-rise (>20F / >30F), min order 30000, final discount 0.9, max multiplier 2.5 |
| LARM site fields | Now actually consumed (region exposure, crowd density, near base station, wind channel) — feed into productivity |
| `expectedDate` + `WeatherAdvisory` | Display only (advisory), no price impact |
| Commute origin | `台北市松山區光復北路11巷46號` (geocoded ≈ 25.0496, 121.5577 — re-geocode via Google at config time) |
| Commute fee | `來回時數 × 2000` per Distance Matrix lookup |
| Mode threshold | One-way drive ≤ 1.5h → daily mode; > 1.5h → lodging mode |
| Daily mode | `commute_fee × days + 1000 fuel × days`, no lodging |
| Lodging mode | `commute_fee × 1` (one round-trip) + `6000 × days` |
| Distance source | Google Distance Matrix API (live, with traffic) |
| Map | Google Maps JavaScript API (drop Leaflet) |
| Address search | Google Places API; **keep current "click button to search" UX** (not autocomplete) |
| Building polygon auto-detect | **Removed**. Step 2 starts with marker only; user manually draws |
| Coefficient editing | Stored in `pricing_params` JSONB, editable via existing `/admin/params` page |
| Migration strategy | Big-bang. No feature flag. Old `quotes` rows render with old fields based on `pricing_version` |
| Customer line item display | `4 工作天 = 160,000`, plus per-facade m² breakdown (no unit price column) |
| Final discount scope | Applies to labor only, not commute/lodging |

## Architecture

### File layout

```
src/lib/engines/
├── productivity-engine.ts   ← NEW
│   computeDailyArea(input, params) → { daily_area, breakdown }
├── time-engine.ts           ← REWRITE (slimmed)
│   estimateTime({ total_area, daily_area, expectedDate }) → TimeResult
├── pricing-engine.ts        ← REPLACE
│   generateQuote({ suggested_days, multipliers, commute }, params) → PricingResult
├── pricing-params.ts        ← REPLACE schema (see Schema section)
│   PricingParams + ProductivityParams now combined; PRICING_PARAMS_DEFAULT v2.0
└── commute-engine.ts        ← NEW (client thin call)
    estimateCommute(lat, lng, work_days) → CommuteResult

src/app/api/
├── commute/estimate/route.ts ← NEW (POST { lat, lng, work_days })
├── geocode/route.ts          ← REWRITE (Nominatim → Google Places Text Search)
└── overpass/                 ← DELETED entirely

src/app/components/
├── QuoteMap.tsx              ← REWRITE (Leaflet → Google Maps JS API; props interface unchanged)
├── QuoteStep1.tsx            ← UPDATE (remove overpass call, drop building polygon side-effects)
├── QuoteStep2.tsx            ← UPDATE (remove building polygon prefill; defaults to manual draw)
└── QuoteStep3.tsx            ← UPDATE (new dependency-ordered useEffect; new line item shape)

supabase/migrations/
├── 003_pricing_params_v2.sql ← INSERT v2.0 row, demote v1.0 is_active=false
└── 004_commute_cache.sql     ← NEW table
```

### Productivity Engine (the core new logic)

```ts
export interface ProductivityParams {
  daily_base_area: number                          // default 1500 m²/day
  building_type_coeff: Record<BuildingType, number>
  height_coeff: { max_floor: number; coeff: number }[]
  complexity_coeff: Record<Complexity, number>
  contamination_coeff: Record<Contamination, number>     // worst-of, not stacked
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

export function computeDailyArea(input: {
  buildingType: BuildingType
  floors: number
  facadeInputs: QuoteFacadeInput[]
  facadeAreas_m2: number[]              // for area-weighting (parallel to facadeInputs)
  rooftopAccess: RooftopAccess
  cleaningAgent: CleaningAgent
  regionExposure?: RegionExposure
  crowdDensity?: CrowdDensity
  nearBaseStation?: boolean
  windChannelEffect?: boolean
}, params: ProductivityParams): {
  daily_area: number
  breakdown: { factor: string; coeff: number; effective_area_after?: number }[]
}
```

**Algorithm:**

```
project_coeff = building_type_coeff[buildingType]
              × height_coeff(floors)
              × cleaning_agent_coeff[cleaningAgent]
              × rooftop_modifier(rooftopAccess)
                  // "Good"         → 1.0
                  // "Limited"      → facade_modifiers.rooftop_limited
                  // "NotAvailable" → facade_modifiers.rooftop_unavailable
              × site_coeff(regionExposure, crowdDensity, nearBaseStation, windChannelEffect)
                  // each present field multiplies in; missing fields default to 1.0

per_facade_coeff[i] = complexity_coeff[facade.complexity]
                    × contamination_coeff[worstOf(facade.dirtTypes)]
                    × Π(facade_modifiers when flag is true)

avg_facade_coeff = Σ(facadeAreas_m2[i] × per_facade_coeff[i]) / Σ(facadeAreas_m2[i])

daily_area = daily_base_area × project_coeff × avg_facade_coeff
```

`breakdown` array exposes every coefficient applied — used for admin debugging and an optional "為什麼這個案子要這麼多天" UI explainer.

### Pricing Engine

```ts
export interface PricingEngineInput {
  suggested_days: number              // from time-engine; ceil before reaching here
  multipliers: {
    floors: number                    // for high-rise lookup
    timeWindow: TimeWindow
    urgent: boolean
  }
  commute: CommuteResult
}

export function generateQuote(input, params): PricingResult {
  const days = Math.ceil(input.suggested_days)
  const labor_subtotal = days * params.daily_rate            // 4 × 40000 = 160000

  const m_floor    = lookup(input.multipliers.floors, params.floor_multiplier)
  const m_time     = params.time_window_multiplier[input.multipliers.timeWindow]
  const m_urgent   = input.multipliers.urgent ? params.urgent_multiplier : 1
  const combined   = m_floor * m_time * m_urgent

  const requires_review = combined > params.quote_max_multiplier
  const final_m  = Math.min(combined, params.quote_max_multiplier)
  const labor_with_mult = Math.round(labor_subtotal * final_m)

  const labor_after_min  = Math.max(labor_with_mult, params.min_order)
  const labor_after_disc = Math.round(labor_after_min * params.final_discount)

  const travel = input.commute.commute_fee
               + input.commute.fuel_fee
               + input.commute.lodging_fee

  const final_price = labor_after_disc + travel

  // line_items shape:
  //   "作業費用（4 工作天）" with per-facade subitems showing area only (no unit price)
  //   "通勤交通" + breakdown
  //   "食宿補貼" (lodging mode only)
  //   "最低案金保護" / "最終折扣" annotations
  ...
}
```

### Commute Engine

```ts
// Server route /api/commute/estimate
// 1. Lookup commute_cache by rounded (lat, lng) within 24h freshness
// 2. On miss: Google Distance Matrix API (origin = TAIPEI_HQ, dest = (lat, lng), departure_time = now)
// 3. one_way_hours = (duration_in_traffic.value || duration.value) / 3600
// 4. Switch on threshold (default 1.5h):
//    daily   → commute_fee = round(one_way_hours × 2 × fee_per_hour) × work_days
//              fuel_fee    = daily_fuel_fee × work_days
//              lodging_fee = 0
//    lodging → commute_fee = round(one_way_hours × 2 × fee_per_hour)   // one-time
//              fuel_fee    = 0
//              lodging_fee = lodging_per_day × work_days
// 5. Cache & return

interface CommuteResult {
  mode: "daily" | "lodging"
  one_way_hours: number
  commute_fee: number
  fuel_fee: number
  lodging_fee: number
  origin_address: string
  destination_address: string
  cached_at?: string
}
```

**Failure mode:** Google API failure / quota exceeded → return mock `{ mode: "daily", one_way_hours: 1, commute_fee: 4000 × work_days, fuel_fee: 1000 × work_days }` and surface a warning banner so the customer-facing UI displays "通勤費為估算值，實際以現勘為準."

## Map / Address Migration

| Concern | Implementation |
|---|---|
| Map SDK | `@googlemaps/js-api-loader` (imperative, not React wrapper) |
| Tile layer | `mapTypeId: "hybrid"` (Google's satellite + label) |
| Marker | `google.maps.Marker` with `draggable: true`, `dragend` listener |
| Polygon drawing | `google.maps.drawing.DrawingManager` with `polygoncomplete` event |
| Persisted shapes | `google.maps.Polygon` instances; edge labels via custom `OverlayView` |
| Geometry calculations | `google.maps.geometry.spherical.computeArea / computeLength` (drop the haversine helpers) |
| `QuoteMap.tsx` props interface | **Unchanged** — `QuoteStep1` / `QuoteStep2` consumers don't need changes |
| Address search | `POST https://places.googleapis.com/v1/places:searchText` (Place Search), keep "click button to search" UX |
| Building polygon | **Removed.** No more pre-drawn shape on Step 2 entry |

### Environment variables

```
GOOGLE_MAPS_BROWSER_KEY=    # restricted by HTTP referrer (NEXT_PUBLIC_-exposed)
GOOGLE_MAPS_SERVER_KEY=     # restricted by IP / API; server-only (commute + geocode)
```

### Removed

- `src/app/api/overpass/` (route + supporting code)
- `leaflet`, `@types/leaflet` from `package.json`
- All Overpass/buildingPolygon/buildingDimensions branches in `QuoteStep1.tsx:71-91`
- `buildingPolygon`, `buildingDimensions` from `QuotePage` state in `page.tsx`
  - `buildingName` is preserved but now sourced from Google Places `displayName`

## Step 3 Calculation Order

```ts
// New calculation order — sequential because pricing depends on time output
useEffect(() => {
  // 1. Daily area (sync, pure)
  const daily_area = computeDailyArea({
    buildingType, floors, facadeInputs,
    facadeAreas_m2: deriveFromAreaEstimate(),
    rooftopAccess, cleaningAgent,
    regionExposure, crowdDensity, nearBaseStation, windChannelEffect,
  }, productivityParams)

  // 2. Work days (sync, pure)
  const time = estimateTime({
    total_area: areaEstimate.project_total_m2 ?? areaEstimate.total_area_m2 * numBuildings,
    daily_area: daily_area.daily_area,
    expectedDate,
  })
  setTimeResult(time)

  // 3. Commute (async)
  estimateCommute(lat, lng, time.suggested_days).then(commute => {
    // 4. Final price (sync, pure)
    const quote = generateQuote({
      suggested_days: time.suggested_days,
      multipliers: { floors, timeWindow, urgent },
      commute,
    }, pricingParams)
    setPricing(quote)
  })
}, [/* deps */])
```

UI: while commute promise is in flight, show pricing skeleton; commute line item fades in on resolve.

## Schema Changes

### `pricing_params` v2.0 JSONB shape

```jsonc
{
  "daily_rate": 40000,
  "daily_base_area": 1500,

  "building_type_coeff": { "commercial": 1.0, "luxury": 1.0, "house": 0.85, "factory": 1.1, "solar": 1.3 },
  "height_coeff": [
    { "max_floor": 10,   "coeff": 1.00 },
    { "max_floor": 20,   "coeff": 0.95 },
    { "max_floor": 30,   "coeff": 0.85 },
    { "max_floor": 9999, "coeff": 0.70 }
  ],
  "complexity_coeff": { "light": 0.98, "medium": 0.9, "heavy": 0.7 },
  "contamination_coeff": { "dust": 1.0, "scale": 0.85, "mold": 0.9, "bird": 0.83, "exhaust": 0.82, "grease": 0.8 },
  "cleaning_agent_coeff": { "soft": 1.0, "standard": 0.95, "deep": 0.85 },
  "facade_modifiers": {
    "has_recesses": 0.85, "is_high_risk": 0.75, "adjacent_trees": 0.9,
    "water_self_supply": 0.85, "power_self_supply": 0.9,
    "rooftop_limited": 0.8, "rooftop_unavailable": 0.6
  },
  "site_modifiers": {
    "region_exposure": { "windward": 0.85, "leeward": 1.0, "coastal": 0.9, "rooftop_open": 0.95 },
    "crowd_density":   { "low": 1.0, "medium": 0.95, "high": 0.85 },
    "near_base_station": 0.95,
    "wind_channel_effect": 0.85
  },

  "commute_origin": { "lat": 25.0495732, "lng": 121.5576803, "address": "台北市松山區光復北路11巷46號" },
  "commute": {
    "fee_per_hour": 2000,
    "daily_fuel_fee": 1000,
    "lodging_per_day": 6000,
    "lodging_threshold_hours": 1.5
  },

  "floor_multiplier": [
    { "max_floor": 10,   "multiplier": 1.00 },
    { "max_floor": 20,   "multiplier": 1.05 },
    { "max_floor": 30,   "multiplier": 1.12 },
    { "max_floor": 9999, "multiplier": 1.25 }
  ],
  "time_window_multiplier": { "day": 1.0, "weekend": 1.2, "night": 1.5 },
  "urgent_multiplier": 1.33,
  "min_order": 30000,
  "quote_max_multiplier": 2.5,
  "final_discount": 0.9,

  "version": "v2.0"
}
```

### Migration `003_pricing_params_v2.sql`

```sql
-- Insert v2.0 row, demote v1.0
update public.pricing_params set is_active = false where is_active = true;

insert into public.pricing_params (version, params, notes, is_active, created_by)
values ('v2.0', $$<full v2.0 JSONB from "pricing_params v2.0 JSONB shape" section above>$$::jsonb,
        'Day-rate productivity model + commute/lodging', true, 'redesign-2026-05');
```

### Migration `004_commute_cache.sql`

```sql
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
  round(destination_lat, 4), round(destination_lng, 4)
);
create index idx_commute_cache_expires on public.commute_cache (expires_at);
```

### `quotes` table

No schema change. `pricing` and `time_result` are `jsonb`; new fields (`commute`, `daily_area`, `breakdown`) just slot in. Old rows with `pricing_version: "v1.0"` continue to render with old field shape (read path checks version).

## Backward Compatibility

- Existing `quotes` rows (v1.0) keep their `pricing_version: "v1.0"` and render via the existing PDF / LINE webhook path with old line item shape.
- LINE webhook bubble (`/api/line/webhook`) reads `pricing.final_price` which exists in both v1 and v2 — no change needed.
- PDF generator (`generateQuotePdf`) needs a small branch on `pricing_version` to pick layout; v1 path frozen.

## Out of Scope

- LARM v2.0 risk engine integration (types remain in `src/lib/types.ts` for reference)
- Multi-language / English UI
- LINE webhook Flex bubble redesign
- PDF template visual redesign (only line item content updates)
- Step 1 coordinate-paste correction panel
- Photo upload pipeline (the `supplyPhotos[]` / `photos[]` fields stay in the type but remain unimplemented)
- Real-time forecast accuracy training (`ForecastLogEntry` etc.)

## Testing

### Manual E2E (run before merging)

1. Taipei site (≤ 1.5h commute) → daily mode, fuel fee shows
2. Tainan site (> 1.5h) → lodging mode, lodging fee shows daily
3. Multi-building, mixed facade conditions → area-weighted productivity
4. Urgent + night + 25-floor → multipliers compose
5. Quote_max_multiplier trigger → manual review banner
6. Min_order trigger → labor floor at 30000

### Unit tests (recommended, not blocking)

- `productivity-engine.test.ts` — table-driven: given input + params, assert daily_area
- `pricing-engine.test.ts` — given suggested_days + multipliers + commute, assert final_price line items
- `commute-engine` route — mock Google Distance Matrix, assert mode switch at 1.5h boundary

## Open Items (deferred)

- Re-geocode commute origin via Google Geocoding API at config time (currently using Nominatim approximation)
- Tune productivity coefficients with real job data after launch (the v2.0 defaults are placeholders)
- Decide whether to surface the `breakdown` debug array in a customer-facing "為什麼這個天數" explainer
