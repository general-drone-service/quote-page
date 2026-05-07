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
  void params // for Task 2 implementation
  void input  // for Task 2 implementation
  // implemented in Task 2
  throw new Error("not implemented")
}
