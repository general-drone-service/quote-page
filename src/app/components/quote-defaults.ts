// ─── Quick Quote: mapping tables, smart defaults, area estimation ────────────

import type {
  BuildingType, FacadeData, FacadeMaterial, Complexity,
  Contamination, TimeWindow, Supply, RooftopAccess, CleaningAgent,
  RegionExposure, CrowdDensity,
} from "@/lib/types"

// ─── Business-friendly labels → engine values ────────────────────────────────

export type ServiceType = "cleaning" | "coating" | "inspection"
export type TimeSlot = "day" | "weekend" | "night"
export type DirtType = "dust" | "scale" | "mold" | "grease" | "bird" | "exhaust"
export type { CleaningAgent }

// ─── Taiwan seasonal weather risk matrix ─────────────────────────────────────

export type WeatherRiskLevel = "low" | "medium" | "high"

export interface WeatherRisk {
  level: WeatherRiskLevel
  season: string           // season label
  icon: string
  concerns: string[]       // specific hazards for that period
  advice: string           // recommended action
  bufferDays: number       // suggested schedule buffer
}

// Month 1–12 → risk entry
const WEATHER_RISK_BY_MONTH: WeatherRisk[] = [
  // Jan
  { level: "low",    season: "冬季乾燥",   icon: "☀️", concerns: ["偶有東北季風強風"], advice: "施工最佳時段，可正常安排工期", bufferDays: 0 },
  // Feb
  { level: "low",    season: "冬末",       icon: "☀️", concerns: ["東北季風漸弱", "偶有霧氣"], advice: "施工條件佳，留意霧日能見度", bufferDays: 1 },
  // Mar
  { level: "medium", season: "梅雨前期",   icon: "🌦", concerns: ["降雨機率上升", "濕度高，塗料固化受影響"], advice: "建議預留 2 天緩衝，確認施工前 72h 無雨", bufferDays: 2 },
  // Apr
  { level: "medium", season: "梅雨初期",   icon: "🌧", concerns: ["間歇性降雨", "高濕度影響防水塗層效果"], advice: "密切追蹤降雨預報，排定備用工期", bufferDays: 2 },
  // May
  // May
  { level: "medium", season: "梅雨盛期",   icon: "🌧", concerns: ["連續降雨常見", "能見度低", "高濕度"], advice: "強烈建議預留 3 天緩衝，塗層施工宜避開", bufferDays: 3 },
  // Jun
  { level: "high",   season: "梅雨末 / 颱風季開始", icon: "⛈️", concerns: ["颱風路徑影響", "豪大雨", "強陣風 >10m/s"], advice: "高風險期，建議延後至 10 月後或增加 5 天緩衝", bufferDays: 5 },
  // Jul
  { level: "high",   season: "颱風季盛期", icon: "🌀", concerns: ["颱風頻率最高", "強風 >15m/s 停工", "大量降雨"], advice: "強烈建議避開，若必要請規劃緊急停工預案", bufferDays: 7 },
  // Aug
  { level: "high",   season: "颱風季盛期", icon: "🌀", concerns: ["颱風頻率高", "強對流雨", "高溫暴曬"], advice: "強烈建議避開，若必要請規劃緊急停工預案", bufferDays: 7 },
  // Sep
  { level: "high",   season: "颱風季末期", icon: "🌀", concerns: ["秋颱活躍", "強風 >12m/s", "東北季風加強"], advice: "風險仍高，預留 5 天緩衝，確認停工觸發條件", bufferDays: 5 },
  // Oct
  { level: "medium", season: "東北季風轉強", icon: "🌬", concerns: ["東北季風強化", "迎風面風速 >8m/s", "東北部降雨增多"], advice: "留意迎風面作業，預留 2 天緩衝", bufferDays: 2 },
  // Nov
  { level: "medium", season: "東北季風盛期", icon: "🌬", concerns: ["持續東北風", "北部 / 迎風面多雨", "低溫影響塗層"], advice: "南部施工條件尚可；北部需預留 3 天緩衝", bufferDays: 2 },
  // Dec
  { level: "low",    season: "冬季乾燥",   icon: "☀️", concerns: ["偶有強北風", "日夜溫差大"], advice: "施工最佳時段，注意低溫對塗料的最低施作溫度", bufferDays: 0 },
]

/**
 * Returns weather risk for a given date string (YYYY-MM-DD or Date).
 * Falls back to current month if no date provided.
 */
export function getWeatherRisk(dateStr?: string): WeatherRisk & { month: number } {
  const d = dateStr ? new Date(dateStr) : new Date()
  const month = d.getMonth() + 1 // 1-12
  return { ...WEATHER_RISK_BY_MONTH[month - 1], month }
}

export const SERVICE_OPTIONS: { value: ServiceType; label: string }[] = [
  { value: "cleaning", label: "外牆清洗" },
  { value: "coating", label: "外牆防水塗層" },
  { value: "inspection", label: "外牆檢測" },
]

export const BUILDING_TYPE_OPTIONS: { value: BuildingType; label: string }[] = [
  { value: "commercial", label: "商辦大樓" },
  { value: "luxury", label: "住宅社區" },
  { value: "house", label: "透天厝" },
  { value: "factory", label: "廠房" },
  { value: "solar", label: "太陽能板" },
]

export const DIRT_TYPE_OPTIONS: { value: DirtType; label: string; emoji: string; surcharge: number }[] = [
  { value: "dust",    label: "灰塵",      emoji: "💨", surcharge: 0  },
  { value: "scale",   label: "水垢",      emoji: "🟤", surcharge: 3.5 },
  { value: "mold",    label: "黑黴",      emoji: "🟢", surcharge: 1.5 },
  { value: "bird",    label: "鳥屎",      emoji: "🐦", surcharge: 1.5 },
  { value: "exhaust", label: "排煙汙垢",  emoji: "🏭", surcharge: 2  },
  { value: "grease",  label: "機械油汙",  emoji: "⚫", surcharge: 5  },
]

export const CLEANING_AGENT_OPTIONS: { value: CleaningAgent; label: string }[] = [
  { value: "soft",     label: "柔洗（快速噴洗）" },
  { value: "standard", label: "淨洗（高壓水洗）" },
  { value: "deep",     label: "精洗（中性清潔劑）" },
]

export const COMPLEXITY_OPTIONS: { value: Complexity; label: string; desc: string }[] = [
  { value: "light",  label: "輕微", desc: "少量凸出 / 平整外牆" },
  { value: "medium", label: "中等", desc: "窗框、線條較多" },
  { value: "heavy",  label: "複雜", desc: "大量裝飾/格柵" },
]

export const TIME_SLOT_OPTIONS: { value: TimeSlot; label: string }[] = [
  { value: "day",     label: "一般白天" },
  { value: "weekend", label: "週末 / 假日" },
  { value: "night",   label: "夜間施工" },
]

// ─── Per-facade input (what the sales form collects) ─────────────────────────

export type PowerVoltage = "110V" | "220V"

export interface QuoteFacadeInput {
  id: string
  buildingIndex: number        // 0-based; which building this facade belongs to
  buildingLabel: string        // "A", "B" … when numBuildings > 1, else ""
  label: string                // A / B / C / D (within the building)
  dirtTypes: DirtType[]        // multi-select
  complexity: Complexity
  hasRecesses: boolean         // 有內縮 / 露台 / 天井 (+6)
  isHighRisk: boolean          // 緊鄰特殊風險環境 (+7)
  hasAdjacentTrees: boolean    // 鄰樹：+5 whole-face; +10 tree-covered floors if cleaned
  treeFloors: number           // floors covered by trees (0 if hasAdjacentTrees is false)
  cleanTreeFloors: boolean     // true → clean tree floors at +10; false → exclude from scope
  waterSupply: Supply          // 用水：業主提供 or 自備
  powerSupply: Supply          // 用電：業主提供 or 自備 (derived from powerVoltage)
  powerVoltage: PowerVoltage[] // which voltages are available ([] = 自備)
  supplyPhotos: { name: string; url: string }[]  // water/power access photos
  photos: { name: string; url: string }[]        // general facade photos
}

// ─── Building MBR dimensions (from Overpass polygon analysis) ─────────────────

export interface BuildingDimensions {
  width_m: number     // longer side
  depth_m: number     // shorter side
  sides_m: number[]   // [w, d, w, d] for rectangular building
  angle_deg: number
  name?: string | null
  address?: string | null
}

// ─── Form data (full) ────────────────────────────────────────────────────────

export interface QuoteFormData {
  clientName: string
  address: string
  lat: number
  lng: number
  serviceType: ServiceType
  urgent: boolean
  buildingType: BuildingType
  floors: number
  heightMode: "floors" | "height"  // input mode: floor count or direct height
  heightM?: number                 // direct height in meters (when heightMode === "height")
  numBuildings: number          // how many buildings on the same project site
  numFacades: number            // facades per building (default / single-building)
  numFacadesPerBuilding?: number[]  // per-building face counts (from polygon vertices)
  timeSlot: TimeSlot
  cleaningAgent: CleaningAgent  // project-wide cleaning agent type
  rooftopAccess: RooftopAccess  // building-level rooftop condition
  facadeInputs: QuoteFacadeInput[]
  expectedDate?: string         // YYYY-MM-DD; drives weather risk advisory
  // ── LARM site fields (synced with LAOP Step3Building) ────────────────────
  regionExposure?: RegionExposure  // 環境曝露類型
  crowdDensity?: CrowdDensity      // 周圍人流密度
  nearBaseStation?: boolean        // 附近基地台
  windChannelEffect?: boolean      // 風道效應
  clearanceM?: number              // 工作間距（公尺）
  // ── Customer contact info (required before PDF download) ──────────────────
  contactPerson?: string        // 聯絡人
  phone?: string                // 電話號碼
  email?: string                // 信箱
}

// ─── Mapping tables ─────────────────────────────────────────────────────────

const DEFAULT_MATERIAL: Record<BuildingType, FacadeMaterial> = {
  commercial: "glass", luxury: "stone", house: "tile", factory: "metal", solar: "solar",
}

// ─── Default building dimensions ────────────────────────────────────────────

const BUILDING_DIMENSIONS: Record<BuildingType, { width_m: number; depth_m: number }> = {
  commercial: { width_m: 25, depth_m: 25 },
  luxury:     { width_m: 20, depth_m: 20 },
  house:      { width_m: 5,  depth_m: 15 },
  factory:    { width_m: 50, depth_m: 30 },
  solar:      { width_m: 10, depth_m: 5  },
}

// ─── Area estimation ─────────────────────────────────────────────────────────

export type AreaSource = "overpass" | "manual-draw" | "default"

export interface AreaEstimate {
  source: AreaSource
  perimeter_m: number
  facade_width_m: number          // average (for display)
  building_height_m: number
  facade_area_m2: number          // average per-facade area (one building)
  total_area_m2: number           // one building total
  num_facades: number
  /** Per-building face counts when buildings have different polygon shapes */
  perBuildingNumFacades?: number[]
  facadeWidths_m?: number[]       // per-facade widths for one building (MBR)
  /** Per-building facade widths when buildings differ in size [buildingIdx][facadeIdx] */
  perBuildingFacadeWidths?: number[][]
  /** Per-building surface area totals */
  perBuildingTotals_m2?: number[]
  /** Per-building perimeters in meters */
  perBuildingPerimeters_m?: number[]
  /** Actual project total when buildings have different sizes; omit when all equal */
  project_total_m2?: number
}

const FLOOR_HEIGHT_M = 3.5

export function estimateFromPerimeter(
  perimeter_m: number,
  floors: number,
  numFacades: number,
  source: AreaSource = "overpass",
  heightOverride_m?: number,
): AreaEstimate {
  const facadeWidth = Math.round(perimeter_m / numFacades)
  const height = heightOverride_m ?? floors * FLOOR_HEIGHT_M
  const facadeArea = Math.round(facadeWidth * height)
  return {
    source,
    perimeter_m: Math.round(perimeter_m),
    facade_width_m: facadeWidth,
    building_height_m: height,
    facade_area_m2: facadeArea,
    total_area_m2: facadeArea * numFacades,
    num_facades: numFacades,
  }
}

/** Use actual MBR width × depth from polygon analysis — most accurate */
export function estimateFromDimensions(
  dims: BuildingDimensions,
  floors: number,
  numFacades: number,
  heightOverride_m?: number,
): AreaEstimate {
  const height = heightOverride_m ?? floors * FLOOR_HEIGHT_M
  // Assign side widths to each requested facade (repeating w,d,w,d pattern)
  const facadeWidths = Array.from({ length: numFacades }, (_, i) => {
    // sides_m is [w, d, w, d] for a rect; cycle if fewer sides defined
    return dims.sides_m[i % dims.sides_m.length] ?? dims.width_m
  })
  const totalArea = Math.round(facadeWidths.reduce((s, w) => s + w * height, 0))
  const avgWidth = Math.round(facadeWidths.reduce((s, w) => s + w, 0) / numFacades)
  const perimeter = 2 * (dims.width_m + dims.depth_m)
  return {
    source: "overpass",
    perimeter_m: Math.round(perimeter),
    facade_width_m: avgWidth,
    building_height_m: height,
    facade_area_m2: Math.round(totalArea / numFacades),
    total_area_m2: totalArea,
    num_facades: numFacades,
    facadeWidths_m: facadeWidths,
  }
}

export function estimateFromDefaults(
  buildingType: BuildingType,
  floors: number,
  numFacades: number,
  heightOverride_m?: number,
): AreaEstimate {
  const dims = BUILDING_DIMENSIONS[buildingType]
  const perimeter = 2 * (dims.width_m + dims.depth_m)
  return estimateFromPerimeter(perimeter, floors, numFacades, "default", heightOverride_m)
}

export function estimateFromRect(
  width_m: number,
  depth_m: number,
  floors: number,
  numFacades: number,
  heightOverride_m?: number,
): AreaEstimate {
  const perimeter = 2 * (width_m + depth_m)
  return estimateFromPerimeter(perimeter, floors, numFacades, "manual-draw", heightOverride_m)
}

/** Per-building rectangle bounds (from map draw) */
export interface DrawnRectBounds {
  w: number; d: number
  sw: [number, number]; ne: [number, number]
}

/**
 * Multi-building area estimate where each building may have different dimensions.
 * `total_area_m2` = per-building average; `project_total_m2` = sum of all buildings.
 */
export function estimateFromMultiRects(
  rects: (DrawnRectBounds | null)[],
  numBuildings: number,
  floors: number,
  numFacades: number,
  heightOverride_m?: number,
): AreaEstimate {
  const height = heightOverride_m ?? floors * FLOOR_HEIGHT_M
  const fallback = rects.find(r => r !== null) ?? null
  const perBuildingFacadeWidths: number[][] = []
  const perBuildingTotals: number[] = []
  const perBuildingPerims: number[] = []
  let totalProjectArea = 0

  for (let b = 0; b < numBuildings; b++) {
    const rect = rects[b] ?? fallback
    if (rect) {
      const sides = [rect.w, rect.d, rect.w, rect.d]
      const facadeWidths = Array.from({ length: numFacades }, (_, i) => sides[i % 4])
      perBuildingFacadeWidths.push(facadeWidths)
      const buildingArea = facadeWidths.reduce((s, w) => s + w * height, 0)
      totalProjectArea += buildingArea
      perBuildingTotals.push(Math.round(buildingArea))
      perBuildingPerims.push(Math.round(2 * (rect.w + rect.d)))
    } else {
      perBuildingFacadeWidths.push([])
      perBuildingTotals.push(0)
      perBuildingPerims.push(0)
    }
  }

  const avgBuildingArea = numBuildings > 0 ? totalProjectArea / numBuildings : 0
  const allWidths = perBuildingFacadeWidths.flat().filter(w => w > 0)
  const avgWidth = allWidths.length > 0
    ? Math.round(allWidths.reduce((s, w) => s + w, 0) / allWidths.length)
    : 0

  return {
    source: "manual-draw",
    perimeter_m: Math.round(avgWidth * numFacades * 2),
    facade_width_m: avgWidth,
    building_height_m: height,
    facade_area_m2: Math.round(avgBuildingArea / numFacades),
    total_area_m2: Math.round(avgBuildingArea),
    num_facades: numFacades,
    perBuildingFacadeWidths,
    perBuildingTotals_m2: perBuildingTotals,
    perBuildingPerimeters_m: perBuildingPerims,
    project_total_m2: Math.round(totalProjectArea),
  }
}

// ─── Default facade inputs ───────────────────────────────────────────────────

const BUILDING_LABELS = ["A", "B", "C", "D", "E", "F"]

/** Generate numbered face label: "1面", "2面", ... */
function faceLabel(index: number): string {
  return `${index + 1}面`
}

export function buildDefaultFacadeInputs(
  numFacades: number,
  numBuildings: number = 1,
  perBuildingNumFacades?: number[],
): QuoteFacadeInput[] {
  const result: QuoteFacadeInput[] = []
  for (let b = 0; b < numBuildings; b++) {
    const buildingLabel = numBuildings > 1 ? (BUILDING_LABELS[b] ?? String(b + 1)) : ""
    const facadeCount = perBuildingNumFacades?.[b] ?? numFacades
    for (let i = 0; i < facadeCount; i++) {
      result.push({
        id: `${b}-${i}`,
        buildingIndex: b,
        buildingLabel,
        label: faceLabel(i),
        dirtTypes: ["dust"] as DirtType[],
        complexity: "light" as Complexity,
        hasRecesses: false,
        isHighRisk: false,
        hasAdjacentTrees: false,
        treeFloors: 0,
        cleanTreeFloors: true,
        waterSupply: "Provided" as Supply,
        powerSupply: "Provided" as Supply,
        powerVoltage: ["110V", "220V"] as PowerVoltage[],
        supplyPhotos: [],
        photos: [],
      })
    }
  }
  return result
}

// ─── Contamination: derive from multi-select dirt types ──────────────────────

const DIRT_TO_CONTAMINATION: Record<DirtType, Contamination> = {
  dust: "dust", scale: "scale", mold: "mold", bird: "bird",
  exhaust: "exhaust", grease: "grease",
}

/** All unique contamination types across all facades — used for pricing (stackable) */
export function allContaminationTypes(facadeInputs: QuoteFacadeInput[]): Contamination[] {
  const set = new Set<Contamination>()
  for (const f of facadeInputs) {
    for (const d of f.dirtTypes) set.add(DIRT_TO_CONTAMINATION[d])
  }
  return set.size > 0 ? Array.from(set) : ["dust"]
}

/** Worst (most time-impacting) contamination — used for time estimation */
export function worstContamination(facadeInputs: QuoteFacadeInput[]): Contamination {
  const priority: Contamination[] = ["grease", "exhaust", "bird", "scale", "mold", "dust"]
  const types = allContaminationTypes(facadeInputs)
  return priority.find(p => types.includes(p)) ?? "dust"
}

/** If ANY facade needs self-supply, use SelfSupply (conservative) */
export function aggregateSupply(facadeInputs: QuoteFacadeInput[], type: "water" | "power"): Supply {
  const field = type === "water" ? "waterSupply" : "powerSupply"
  return facadeInputs.some(f => f[field] === "SelfSupply") ? "SelfSupply" : "Provided"
}

// ─── Build FacadeData[] for engine input ─────────────────────────────────────

export function buildFacadesFromInputs(
  facadeInputs: QuoteFacadeInput[],
  estimate: AreaEstimate,
  buildingType: BuildingType,
): FacadeData[] {
  const material = DEFAULT_MATERIAL[buildingType]
  const height = estimate.building_height_m
  // Track per-building facade index for variable face counts
  const buildingFacadeCounter: Record<number, number> = {}
  return facadeInputs.map((input) => {
    const buildingIdx = input.buildingIndex
    const facadeIdxInBuilding = buildingFacadeCounter[buildingIdx] ?? 0
    buildingFacadeCounter[buildingIdx] = facadeIdxInBuilding + 1
    // Per-building widths (multi-rect draw) take priority over shared MBR widths
    const width_m =
      estimate.perBuildingFacadeWidths?.[buildingIdx]?.[facadeIdxInBuilding] ??
      estimate.facadeWidths_m?.[facadeIdxInBuilding] ??
      (height > 0 ? estimate.facade_area_m2 / height : 0)
    const area_m2 = Math.round(width_m * height)
    const displayLabel = input.buildingLabel ? `棟${input.buildingLabel}-${input.label}` : input.label
    const tree_area_m2 = input.hasAdjacentTrees && input.treeFloors > 0
      ? Math.min(Math.round(width_m * input.treeFloors * FLOOR_HEIGHT_M), area_m2)
      : 0
    return {
      id: input.id,
      label: displayLabel,
      area_m2,
      material,
      complexity: input.complexity,
      road_closure: false,
      tight_perimeter: input.hasRecesses,
      high_risk_env: input.isHighRisk,
      adjacent_trees: input.hasAdjacentTrees,
      tree_area_m2,
      clean_tree_floors: input.cleanTreeFloors,
    }
  })
}

/** Fallback: build facades from estimate when no per-facade inputs exist */
export function buildFacades(
  estimate: AreaEstimate,
  buildingType: BuildingType,
): FacadeData[] {
  const material = DEFAULT_MATERIAL[buildingType]
  return Array.from({ length: estimate.num_facades }, (_, i) => ({
    id: String(i + 1),
    label: faceLabel(i),
    area_m2: estimate.facade_area_m2,
    material,
    complexity: "light" as Complexity,
    road_closure: false,
    tight_perimeter: false,
    high_risk_env: false,
    adjacent_trees: false,
    tree_area_m2: 0,
    clean_tree_floors: true,
  }))
}

// ─── Engine input mapping ────────────────────────────────────────────────────

export function mapServiceToMissionType(s: ServiceType) {
  const map = { cleaning: "Cleaning", coating: "Coating", inspection: "Inspection" } as const
  return map[s]
}

export function mapTimeSlot(t: TimeSlot): TimeWindow {
  return t as TimeWindow
}

// ─── Overpass polygon perimeter ──────────────────────────────────────────────

export function calcPolygonPerimeter(points: { lat: number; lon: number }[]): number {
  if (points.length < 3) return 0
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    total += haversineM(a.lat, a.lon, b.lat, b.lon)
  }
  return total
}

/** Polygon area in m² using shoelace in local metric coords */
export function calcPolygonArea(vertices: [number, number][]): number {
  if (vertices.length < 3) return 0
  const refLat = vertices[0][0]
  const refLng = vertices[0][1]
  const mLat = 111320
  const mLng = 111320 * Math.cos(refLat * Math.PI / 180)
  const pts = vertices.map(([lat, lng]) => [(lng - refLng) * mLng, (lat - refLat) * mLat])
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]
  }
  return Math.abs(area) / 2
}

/** Perimeter of a lat/lng polygon (vertices as [lat, lng] pairs) */
export function calcLatLngPerimeter(vertices: [number, number][]): number {
  if (vertices.length < 2) return 0
  let total = 0
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]
    total += haversineM(a[0], a[1], b[0], b[1])
  }
  return total
}

/** Estimate from multi-building drawn polygons (each with its own perimeter & face count) */
export function estimateFromMultiPerimeters(
  perimeters_m: (number | null)[],
  numBuildings: number,
  floors: number,
  numFacades: number,
  perBuildingNumFacades?: number[],
  heightOverride_m?: number,
): AreaEstimate {
  const height = heightOverride_m ?? floors * FLOOR_HEIGHT_M
  const fallback = perimeters_m.find(p => p != null) ?? 80
  const perBuildingFacadeWidths: number[][] = []
  const resolvedPerBuildingNumFacades: number[] = []
  const perBuildingTotals: number[] = []
  const perBuildingPerims: number[] = []
  let totalProjectArea = 0

  for (let b = 0; b < numBuildings; b++) {
    const perim = perimeters_m[b] ?? fallback
    const bFacades = perBuildingNumFacades?.[b] ?? numFacades
    resolvedPerBuildingNumFacades.push(bFacades)
    const widths = Array.from({ length: bFacades }, () => Math.round(perim / bFacades))
    perBuildingFacadeWidths.push(widths)
    const buildingArea = perim * height
    totalProjectArea += buildingArea
    perBuildingTotals.push(Math.round(buildingArea))
    perBuildingPerims.push(Math.round(perim))
  }

  const validPerims = perimeters_m.filter((p): p is number => p != null)
  const avgPerim = validPerims.length > 0
    ? validPerims.reduce((s, p) => s + p, 0) / validPerims.length
    : fallback
  const avgWidth = Math.round(avgPerim / numFacades)

  return {
    source: "manual-draw",
    perimeter_m: Math.round(avgPerim),
    facade_width_m: avgWidth,
    building_height_m: height,
    facade_area_m2: Math.round(avgWidth * height),
    total_area_m2: Math.round(avgPerim * height),
    num_facades: numFacades,
    perBuildingNumFacades: resolvedPerBuildingNumFacades,
    perBuildingFacadeWidths,
    perBuildingTotals_m2: perBuildingTotals,
    perBuildingPerimeters_m: perBuildingPerims,
    project_total_m2: Math.round(totalProjectArea),
  }
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLon = (lon2 - lon1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
