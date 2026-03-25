import type {
  BuildingType, Complexity, Contamination,
  TimeWindow, Supply, FacadeData, PricingResult, PricingLineItem,
  CleaningAgent, RooftopAccess,
} from "@/lib/types"
import { getPricingParams, type PricingParams } from "./pricing-params"

// ─── Main function ────────────────────────────────────────────────────────────

export interface PricingEngineInput {
  buildingType: BuildingType
  floors: number
  facades: FacadeData[]
  contamination: Contamination[]      // stackable; surcharges summed, capped
  cleaningAgent: CleaningAgent        // project-wide cleaning agent type
  timeWindow: TimeWindow
  waterSupply: Supply
  powerSupply: Supply
  rooftopAccess: RooftopAccess
  urgent: boolean
}

export function generateQuote(input: PricingEngineInput, params?: PricingParams): PricingResult {
  const P = params ?? getPricingParams()
  const {
    buildingType, floors, facades, contamination, cleaningAgent,
    timeWindow, waterSupply, powerSupply, rooftopAccess, urgent,
  } = input

  const basePrice = P.base_price[buildingType] ?? 0

  // ── Section C: project-wide unit price adders (same for every face) ──────
  const contaminationSurcharge = Math.min(
    contamination.reduce((sum, c) => sum + (P.contamination_surcharge[c] ?? 0), 0),
    P.contamination_cap ?? 15,
  )
  const cleaningAgentSurcharge = P.cleaning_agent_surcharge[cleaningAgent] ?? 0
  const projectWideSurcharge = contaminationSurcharge + cleaningAgentSurcharge

  // ── Section B: building-level per-face adders (same value for every face) ─
  const waterSurcharge   = waterSupply   === "SelfSupply" ? (P.supply_surcharges.water_self  ?? 0) : 0
  const powerSurcharge   = powerSupply   === "SelfSupply" ? (P.supply_surcharges.power_self  ?? 0) : 0
  const rooftopSurcharge = rooftopAccess !== "Good"       ? (P.supply_surcharges.rooftop_not_good ?? 0) : 0

  const lineItems: PricingLineItem[] = []
  let subtotal = 0

  for (const facade of facades) {
    const complexitySurcharge = P.complexity_surcharge[facade.complexity] ?? 0
    const roadSurcharge       = facade.road_closure    ? (P.facade_surcharges.road_closure    ?? 0) : 0
    const tightSurcharge      = facade.tight_perimeter ? (P.facade_surcharges.tight_perimeter ?? 0) : 0
    const riskEnvSurcharge    = facade.high_risk_env   ? (P.facade_surcharges.high_risk_env   ?? 0) : 0
    const treeSurcharge       = facade.adjacent_trees  ? (P.facade_surcharges.adjacent_trees  ?? 0) : 0

    const unitPrice =
      basePrice +
      complexitySurcharge +
      roadSurcharge +
      tightSurcharge +
      riskEnvSurcharge +
      treeSurcharge +
      waterSurcharge +
      powerSurcharge +
      rooftopSurcharge +
      projectWideSurcharge

    // ── Tree-floor area handling ────────────────────────────────────────────
    let effectiveArea: number
    let facetSubtotal: number
    let itemLabel: string

    if (facade.adjacent_trees && facade.tree_area_m2 > 0) {
      if (facade.clean_tree_floors) {
        const normalArea = facade.area_m2 - facade.tree_area_m2
        facetSubtotal =
          normalArea * unitPrice +
          facade.tree_area_m2 * (unitPrice + P.facade_surcharges.tree_extra)
        effectiveArea = facade.area_m2
        itemLabel = `立面 ${facade.label}（${facade.area_m2}㎡，含鄰樹${facade.tree_area_m2}㎡×+${P.facade_surcharges.tree_extra}）`
      } else {
        effectiveArea = facade.area_m2 - facade.tree_area_m2
        facetSubtotal = effectiveArea * unitPrice
        itemLabel = `立面 ${facade.label}（${effectiveArea}㎡，鄰樹${facade.tree_area_m2}㎡不計）`
      }
    } else {
      effectiveArea = facade.area_m2
      facetSubtotal = effectiveArea * unitPrice
      itemLabel = `立面 ${facade.label}（${facade.area_m2}㎡）`
    }

    subtotal += facetSubtotal
    lineItems.push({
      code: `FACE-${facade.id}`,
      label: itemLabel,
      unit_price: effectiveArea > 0 ? Math.round(facetSubtotal / effectiveArea) : unitPrice,
      area_m2: effectiveArea,
      subtotal: facetSubtotal,
    })
  }

  // Ensure minimum order
  if (subtotal < P.min_order) {
    const topup = P.min_order - subtotal
    lineItems.push({ code: "MIN-ORDER", label: "最低作業費用補差", subtotal: topup })
    subtotal = P.min_order
  }

  // ── Section D: multipliers ─────────────────────────────────────────────
  const mFloor  = P.floor_multiplier.find(f => floors <= f.max_floor)?.multiplier ?? 1.0
  const mTime   = P.time_window_multiplier[timeWindow]
  const mUrgent = urgent ? P.urgent_multiplier : 1.0

  const combinedMultiplier = mFloor * mTime * mUrgent

  // Multiplier cap protection
  const maxMult = P.quote_max_multiplier ?? 2.5
  const requiresManualReview = combinedMultiplier > maxMult
  const multiplier = Math.min(maxMult, combinedMultiplier)
  const total = Math.round(subtotal * multiplier)

  const today = new Date()
  const validUntil = new Date(today)
  validUntil.setDate(today.getDate() + 30)
  const quoteCode = `Q-${today.toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 900 + 100)}`

  return {
    line_items: lineItems,
    subtotal: Math.round(subtotal),
    multiplier: Math.round(multiplier * 100) / 100,
    multiplier_breakdown: {
      floor: mFloor,
      time_window: mTime,
      urgent: mUrgent,
    },
    total,
    currency: "NTD",
    quote_code: quoteCode,
    valid_until: validUntil.toISOString().split("T")[0],
    pricing_version: P.version,
    requires_manual_review: requiresManualReview || undefined,
    manual_review_note: requiresManualReview
      ? `複合加乘 ${combinedMultiplier.toFixed(2)}× 超過系統上限 ${maxMult}×，請人工確認報價`
      : undefined,
  }
}
