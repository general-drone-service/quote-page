// ─── Enums ──────────────────────────────────────────────────────────────────

export type MissionType = "Cleaning" | "Inspection" | "Coating" | "Solar" | "Other"
export type BuildingType = "commercial" | "luxury" | "house" | "factory" | "solar"
export type AirspaceStatus = "OK" | "NeedPermit" | "NoFly"
export type WeatherType = "W0" | "W1" | "W2" | "W3" | "W4" | "W5"
export type RiskLevel = "R0" | "R1" | "R2" | "R3" | "R4"
export type Decision = "GO" | "CONDITIONAL" | "NO_GO"
export type FacadeMaterial = "tile" | "stone" | "glass" | "metal" | "paint" | "solar"
export type Complexity = "light" | "medium" | "heavy"
export type Contamination = "dust" | "scale" | "mold" | "grease" | "bird" | "exhaust"
export type CleaningAgent = "soft" | "standard" | "deep"
export type TimeWindow = "day" | "weekend" | "night"
export type RooftopAccess = "Good" | "Limited" | "NotAvailable"
export type Supply = "Provided" | "SelfSupply"
export type QualCheckResult = "pass" | "fail" | "warn"
export type HealthStatus = "ok" | "warn" | "block"

// ─── LARM v2.0 New Types ─────────────────────────────────────────────────────

/** SORA 2.5 population density classification for iGRC ground consequence */
export type PopulationDensityClass = "assembly" | "high_urban" | "residential" | "light" | "isolated"

/** SORA 2.5 M1-series ground risk mitigations */
export type SORAMitigation = "M1A" | "M1B" | "M1C"

/** Equipment block categories (封鎖級) — each +3 points */
export type EquipmentBlockCategory = "B1" | "B2" | "B3"

/** Equipment warn categories (警告級) — each +1.5 points */
export type EquipmentWarnCategory = "W1" | "W2" | "W3" | "W4" | "W5" | "W6"

// ─── LARM v1.0 Input Types ────────────────────────────────────────────────────

export type RegionExposure = "windward" | "leeward" | "coastal" | "rooftop_open"
export type CrowdDensity = "low" | "medium" | "high"
export type OperatorExperience = "junior" | "mid" | "senior"

/** Rolling 30-day weather statistics (regime context) */
export interface Weather30dInput {
  wind_mean_kmh: number
  wind_p90_kmh: number
  gust_p90_kmh: number | null
  rain_days_30: number           // days with ≥1 mm
  heavy_rain_days_30: number     // days with ≥20 mm
  instability_index: number      // 0..1
  predictability_score: number   // 0..1 (higher = more stable / predictable)
}

/** Today's forecast / real-time weather */
export interface WeatherTodayInput {
  wind_now_kmh: number
  wind_p10_kmh?: number          // Ensemble P10 wind (optimistic bound), km/h
  wind_p90_kmh?: number          // Ensemble P90 wind (conservative bound), km/h
  gust_now_kmh: number | null
  rain_prob_today_pct: number    // 0..100
  rain_mmph_forecast: number     // 1-hr rain rate (mm/h)
  thunder_risk: 0 | 1 | null
  forecast_confidence?: number   // 0..100 — ensemble member agreement (100 = all agree)
  wind_direction_deg?: number    // Wind direction in degrees (0=N, 90=E, 180=S, 270=W)
  edr?: number | null            // v2.0: Eddy Dissipation Rate (turbulence, 0–1+)
  local_hour?: number | null     // v2.0: local hour (0–23) for W4 time-of-day multiplier
  cwa_cross?: CWACrossValidation // CWA cross-validation data for this day
  jma_cross?: JMACrossValidation // JMA cross-validation data for this day
}

// ─── CWA Cross-Validation Types ──────────────────────────────────────────────

/** Per-day CWA forecast data from F-D0047 township-level forecast */
export interface CWAForecastDay {
  wind_speed_kmh: number | null     // WS: max wind speed (m/s → km/h)
  wind_direction: string | null     // WD: wind direction text (e.g. "偏北風")
  rain_prob_12h: number | null      // PoP12h: 12-hour rain probability (%)
  weather_desc: string | null       // Wx: weather phenomenon text
  min_temp_c: number | null         // MinT: min temperature (°C)
  max_temp_c: number | null         // MaxT: max temperature (°C)
}

/** Per-day divergence analysis between Open-Meteo and CWA */
export interface CrossValidationDivergence {
  wind_delta_kmh: number | null     // Open-Meteo wind - CWA wind (positive = OM higher)
  rain_prob_delta: number | null    // Open-Meteo rain% - CWA rain% (positive = OM higher)
  severity: "low" | "medium" | "high"  // Divergence severity level
  notes: string[]                   // Human-readable divergence explanations
}

/** Combined CWA cross-validation for a single forecast day */
export interface CWACrossValidation {
  cwa_forecast: CWAForecastDay
  divergence: CrossValidationDivergence
}

/** Real-time CWA observation from nearest weather station (O-A0003-001) */
export interface CWAObservation {
  station_name: string
  station_id: string
  observed_at: string               // ISO datetime
  wind_speed_kmh: number | null     // WDSD (m/s → km/h)
  wind_direction_deg: number | null // WDIR (degrees)
  gust_speed_kmh: number | null     // H_FX (m/s → km/h)
  temperature_c: number | null      // TEMP
  humidity_pct: number | null       // HUMD (0..1 → 0..100)
  precipitation_mm: number | null   // 24R: 24h accumulated rain (mm)
}

/** Top-level CWA cross-validation summary in API response */
export interface CWACrossValidationMeta {
  enabled: boolean
  observation: CWAObservation | null
  forecast_coverage: number          // How many forecast days have CWA data (0..14)
  max_divergence_severity: "low" | "medium" | "high" | "none"
  data_sources: string[]             // e.g. ["F-D0047-091", "O-A0003-001"]
}

/** Building and site characteristics */
export interface BuildingSiteInput {
  site_altitude_m: number
  building_floors: number | null
  building_height_m: number | null
  facade_complexity: Complexity
  clearance_m: number | null           // available working clearance from wall (m)
  near_hv_power: 0 | 1
  near_base_station: 0 | 1
  wind_channel_effect: 0 | 1
  rooftop_condition: "good" | "limited" | "not_available" | null
  crowd_density: CrowdDensity | null
  region_exposure: RegionExposure | null
  // v2.0: SORA 2.5 ground risk inputs
  population_density_class?: PopulationDensityClass
  sora_mitigations?: SORAMitigation[]
}

/** Operational context factors */
export interface OperationalContextInput {
  time_window: "day" | "night"
  weekend: 0 | 1
  urgent_days: number | null          // days until deadline (null = not urgent)
  road_closure_needed: 0 | 1
  multi_day_split: 0 | 1 | null
  operator_experience_level: OperatorExperience | null
  mission_days?: number               // total mission calendar days (for fatigue scoring)
}

/** Full LARM engine input */
export interface LARMInput {
  weather_30d: Weather30dInput
  weather_today: WeatherTodayInput
  building: BuildingSiteInput
  operational?: OperationalContextInput
  w_override?: WeatherType             // manual regime override (UI/mock)
  equipment?: Equipment[]              // assigned equipment for E-Score computation
  // v2.0 extensions
  recent_typhoon_count?: number | null // 3-year recent typhoon count (W5 climate trend)
  local_completion_adjustment?: number // local completion rate adjustment multiplier (default 1.0)
}

/** W regime classification result with confidence */
export interface WeatherRegimeResult {
  w_code: WeatherType
  confidence: number                  // 0..1 (lower when multiple rules compete)
  secondary_w: WeatherType | null     // runner-up regime when confidence < 1
}

// ─── LARM v1.0 Output Types ───────────────────────────────────────────────────

export interface RiskExplanation {
  factor: string
  value: string | number
  score: number
  note: string
}

export interface LARMVersions {
  larm_version: string
  weather_regime_params_version: string
  thresholds_version: string
}

// ─── Address ─────────────────────────────────────────────────────────────────

export interface AddressResult {
  raw: string
  lat: number
  lng: number
  altitude_m: number
  district: string
  city: string
  status: "success" | "failed"
}

// ─── Airspace ─────────────────────────────────────────────────────────────────

export interface AirspaceResult {
  status: AirspaceStatus
  reason?: string
  admin_days_added: number
  ruleset_version: string
}

// ─── Building ────────────────────────────────────────────────────────────────

export interface BuildingData {
  name?: string
  height_floors: number
  height_m: number
  building_type: BuildingType
  num_buildings?: number
  num_facades: number
  rooftop_access: RooftopAccess
  water_supply: Supply
  power_supply: Supply
  // LARM site inputs (captured in Step 3)
  region_exposure?: RegionExposure
  crowd_density?: CrowdDensity
  near_base_station?: 0 | 1
  wind_channel_effect?: 0 | 1
  clearance_m?: number
}

// ─── Facade ──────────────────────────────────────────────────────────────────

export interface FacadeData {
  id: string
  label: string // N / E / S / W or A / B / C
  area_m2: number
  material: FacadeMaterial
  complexity: Complexity
  road_closure: boolean
  tight_perimeter: boolean
  high_risk_env: boolean
  adjacent_trees: boolean     // 鄰樹：+5 NTD/㎡ (whole face)
  tree_area_m2: number        // m² covered by trees (0 if none)
  clean_tree_floors: boolean  // true → clean tree area at +10 NTD/㎡; false → exclude tree area
}

// ─── Weather ─────────────────────────────────────────────────────────────────

export interface WeatherDay {
  date: string // ISO
  weather_type: WeatherType    // LARM-computed W code (for display)
  risk_level: RiskLevel        // LARM-computed R level (for display / filtering)
  wind_ms: number              // display: wind_now_kmh / 3.6
  rain_prob: number            // 0-100; display: rain_prob_today_pct
  completion_prob: number      // 0-100; derived from LARM decision + buffer
  weather_today: WeatherTodayInput   // full LARM per-day input
}

// ─── Risk ─────────────────────────────────────────────────────────────────────

export interface RiskResult {
  // ── Backward-compatible fields ────────────────────────────────────────────
  weather_type: WeatherType       // = w_code
  risk_level: RiskLevel
  internal_grade: "A" | "B" | "C" | "D1" | "D2"  // v2.0: D split into D1/D2
  decision: Decision
  requires_approval: boolean
  controls: string[]
  ruleset_version: string
  evaluated_at: string

  // ── LARM v2.0 computed fields ─────────────────────────────────────────────
  w_code: WeatherType
  base_w: number                  // Base(W) score from regime (0..22)
  weather_now: number             // WeatherNow component (0..42, v1.1 was 0..50)
  g_score: number                 // Ground/Site score (0..20, replaces B_score)
  b_score: number                 // @deprecated alias for g_score (backward compat)
  o_score: number                 // Operational score (0..12, v1.1 was 0..15)
  e_score: number                 // Equipment score (0..8, v1.1 was 0..10)
  risk_score: number              // Final R_score (0..100)
  buffer_ratio: number            // Time buffer ratio (0.05..0.55, v1.1 was 0.05..0.40)
  explanations: RiskExplanation[] // Per-factor breakdown
  versions: LARMVersions

  // ── Regime + Decision extensions ──────────────────────────────────────────
  regime_confidence: number       // W regime classification confidence (0..1)
  secondary_w: WeatherType | null // Runner-up regime
  conditional_tier: "A" | "C" | "D1" | "D2" | null  // v2.0 CONDITIONAL sub-tier

  // ── v2.0 new detail fields ────────────────────────────────────────────────
  edr_adj?: number                // EDR turbulence adjustment (0..20)
  tke_proxy?: number              // TKE proxy add (0..3)
  ground_consequence?: number     // SORA GRC ground consequence (0..6)
}

// ─── Time Estimation ─────────────────────────────────────────────────────────

export interface TimeResult {
  baseline_productivity: number
  adjusted_productivity: number
  pure_operation_hours: number
  setup_minutes: number
  teardown_minutes: number
  rest_minutes: number
  buffer_minutes: number
  total_minutes: number
  suggested_days: number
  disruption_buffer_ratio: number
  time_model_version: string
  coefficient_snapshot: Record<string, number>
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

export interface PricingLineItem {
  code: string
  label: string
  unit_price?: number
  area_m2?: number
  subtotal: number
}

export interface PricingResult {
  line_items: PricingLineItem[]
  subtotal: number
  multiplier: number
  multiplier_breakdown: Record<string, number>
  total: number
  currency: string
  quote_code: string
  valid_until: string
  pricing_version: string
  // v2.0: multiplier cap protection
  requires_manual_review?: boolean
  manual_review_note?: string
}

// ─── Equipment (used by risk engine for E-score computation) ─────────────────

export interface Equipment {
  id: string
  name: string
  type: "drone" | "module" | "pump" | "hose" | "battery"
  serial: string
  health_status: HealthStatus
  last_calibrated: string // ISO date
  calibration_expires: string // ISO date
  last_maintenance: string // ISO date
  notes?: string
  // v2.0: specific block/warn categories
  block_category?: EquipmentBlockCategory
  warn_category?: EquipmentWarnCategory
}

// ─── Mission (aggregate) ──────────────────────────────────────────────────────

export type MissionStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "MISSION_READY"
  | "BLOCKED"
  | "COMPLETED"

export interface Mission {
  id: string
  status: MissionStatus
  created_at: string
  updated_at: string
  address?: AddressResult
  mission_type?: MissionType
  client_name?: string
  airspace?: AirspaceResult
  building?: BuildingData
  facades?: FacadeData[]
  selected_date?: string
  selected_dates?: string[]
  weather?: WeatherDay
  weather_30d?: Weather30dInput    // scenario 30d context; stored by Step 5 for Step 6
  risk?: RiskResult
  time_estimate?: TimeResult
  pricing?: PricingResult
}

// ─── Forecast Accuracy Training ──────────────────────────────────────────────

/** Single-day forecast record (stored in IndexedDB) */
export interface ForecastLogEntry {
  id: string                       // `${date}_${lead_days}_${location_key}`
  date: string                     // target date (YYYY-MM-DD)
  recorded_at: string              // ISO datetime when forecast was captured
  location_key: string             // "lat,lng" rounded to 0.01
  lead_days: number                // forecast lead time (1=tomorrow … 14)
  forecast: {
    wind_max_kmh: number
    wind_gust_kmh: number | null
    rain_prob_pct: number
    rain_sum_mm: number
    wind_p10_kmh: number | null
    wind_p90_kmh: number | null
    confidence: number | null
    source: "open-meteo" | "cwa" | "blended"
  }
  actual?: {
    wind_max_kmh: number
    wind_gust_kmh: number | null
    rain_sum_mm: number
    source: "archive" | "cwa-observation"
  }
  accuracy?: {
    wind_error_kmh: number         // forecast - actual (positive = overestimate)
    wind_abs_error_kmh: number     // |wind_error|
    rain_error_mm: number          // forecast - actual
    rain_hit: boolean              // whether rain/no-rain was predicted correctly (threshold ≥1mm)
  }
}

/** Per-bucket bias statistics */
export interface BiasStats {
  wind_bias_kmh: number            // mean error (positive = model overestimates)
  wind_mae_kmh: number             // Mean Absolute Error
  rain_bias_pct: number            // mean rain amount error (mm)
  rain_hit_rate: number            // fraction of correct rain/no-rain calls (0..1)
  rain_prob_bias?: number          // v2.0: mean rain probability bias (forecast% − actual_occurred×100)
  sample_count: number
}

/** Bias correction coefficients per location */
export interface ForecastBiasCorrection {
  location_key: string
  updated_at: string
  sample_count: number
  buckets: {
    lead_1_3: BiasStats
    lead_4_7: BiasStats
    lead_8_14: BiasStats
  }
}

/** Summary for Monitor dashboard */
export interface ForecastAccuracySummary {
  location_key: string
  period_days: number              // lookback window (30/60/90)
  overall_wind_mae: number
  overall_rain_hit_rate: number
  trend: "improving" | "stable" | "degrading"
  buckets: ForecastBiasCorrection["buckets"]
  daily_mae: Array<{ date: string; mae: number }>  // for sparkline chart
}

// ─── Seasonal Forecast (Copernicus CDS via Open-Meteo) ──────────────────────

/** Monthly seasonal forecast from ECMWF SEAS5 */
export interface SeasonalForecast {
  month: string                    // "2026-04"
  wind_max_p10: number             // km/h
  wind_max_p50: number
  wind_max_p90: number
  rain_sum_p10: number             // mm (monthly total)
  rain_sum_p50: number
  rain_sum_p90: number
  temp_max_p50: number             // °C
}

// ─── JMA Cross-Validation ───────────────────────────────────────────────────

/** Per-day JMA forecast data from Open-Meteo JMA API */
export interface JMAForecastDay {
  wind_max_kmh: number | null
  wind_gust_kmh: number | null
  rain_sum_mm: number | null
  source_model: "jma_gsm" | "jma_msm"
}

/** JMA cross-validation for a single forecast day */
export interface JMACrossValidation {
  jma_forecast: JMAForecastDay
  divergence: CrossValidationDivergence  // reuses existing divergence type
}

// ─── Wizard state ─────────────────────────────────────────────────────────────

export interface WizardState {
  currentStep: number
  mission: Partial<Mission>
}
