// src/lib/engines/pricing-engine.ts
import type {
  TimeWindow, PricingResult, PricingLineItem, CommuteResult,
} from "@/lib/types"
import type { PricingParams } from "./pricing-params"
import { getPricingParams } from "./pricing-params"

export type ServiceType = "cleaning" | "coating" | "inspection"

export interface PricingEngineInput {
  /** When "inspection", switches to flat-rate (35 NTD/m²) formula and
   *  single-trip commute. Defaults to "cleaning" if omitted. */
  serviceType?: ServiceType
  suggested_days: number
  multipliers: {
    floors: number
    timeWindow: TimeWindow
    urgent: boolean
  }
  commute: CommuteResult
  /** Per-facade area breakdown for line-item display (no unit price column) */
  facadeAreas: { label: string; area_m2: number }[]
  /** Total surface area in m². Required for inspection (rate × area). */
  total_area_m2?: number
  daily_area?: number
}

export function generateQuote(
  input: PricingEngineInput,
  params: PricingParams = getPricingParams(),
): PricingResult {
  if (input.serviceType === "inspection") {
    return generateInspectionQuote(input, params)
  }

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

  const pre_tax_total = labor_after_disc + commute_total
  const tax_total     = Math.round(pre_tax_total * params.tax_rate)
  const final_price   = pre_tax_total + tax_total

  // ── Line items ────────────────────────────────────────────────────────────
  const line_items: PricingLineItem[] = []

  // Per-facade area (display only — no unit price column)
  for (const f of input.facadeAreas) {
    line_items.push({
      code: `FACE-${f.label}`,
      label: `立面 ${f.label}（${f.area_m2.toLocaleString()}㎡）`,
      area_m2: f.area_m2,
      subtotal: 0,
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
    const perNight = Math.round(input.commute.lodging_fee / days)
    line_items.push({
      code: "LODGING",
      label: `食宿（${days}晚 × ${perNight.toLocaleString()}）`,
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
  if (tax_total > 0) {
    line_items.push({
      code: "TAX",
      label: `稅金（${(params.tax_rate * 100).toFixed(0)}%）`,
      subtotal: tax_total,
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
    tax_total,
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

// ── Inspection formula ────────────────────────────────────────────────────
//
// Flat rate × area, single round-trip commute (no per-day multiplication),
// no lodging, no per-multiplier surcharges. Customer-facing breakdown shows
// a "服務內容：3 年 3 次外牆巡檢" notice line because the contract bundles
// three visits over three years at this rate.

function generateInspectionQuote(
  input: PricingEngineInput,
  params: PricingParams,
): PricingResult {
  const totalArea = input.total_area_m2 ?? 0
  const labor_subtotal = Math.round(params.inspection_rate_per_m2 * totalArea)
  const labor_total    = Math.max(labor_subtotal, params.min_order)

  // Single round-trip commute + one day of fuel; no lodging regardless of distance
  const round_trip_fee = Math.round(input.commute.one_way_hours * 2 * params.commute.fee_per_hour)
  const commute_fee    = round_trip_fee
  const fuel_fee       = params.commute.daily_fuel_fee
  const lodging_fee    = 0
  const commute_total  = commute_fee + fuel_fee

  const pre_tax_total = labor_total + commute_total
  const tax_total     = Math.round(pre_tax_total * params.tax_rate)
  const final_price   = pre_tax_total + tax_total

  const line_items: PricingLineItem[] = [
    {
      code: "NOTE-INSPECTION",
      label: "服務內容：3 年 3 次外牆巡檢",
      subtotal: 0,
    },
    ...input.facadeAreas.map(f => ({
      code: `FACE-${f.label}`,
      label: `立面 ${f.label}（${f.area_m2.toLocaleString()}㎡）`,
      area_m2: f.area_m2,
      subtotal: 0,
    })),
    {
      code: "LABOR",
      label: `外牆巡檢（${params.inspection_rate_per_m2} NTD/㎡ × ${totalArea.toLocaleString()}㎡）`,
      subtotal: labor_subtotal,
    },
    {
      code: "COMMUTE",
      label: `通勤交通（單趟來回 ${(input.commute.one_way_hours * 2).toFixed(1)}h）`,
      subtotal: commute_fee,
    },
    {
      code: "FUEL",
      label: "油資（單日）",
      subtotal: fuel_fee,
    },
    ...(labor_subtotal < params.min_order ? [{
      code: "MIN-ORDER",
      label: "最低案金保護",
      subtotal: params.min_order - labor_subtotal,
    }] : []),
    ...(tax_total > 0 ? [{
      code: "TAX",
      label: `稅金（${(params.tax_rate * 100).toFixed(0)}%）`,
      subtotal: tax_total,
    }] : []),
  ]

  const today = new Date()
  const validUntil = new Date(today)
  validUntil.setDate(today.getDate() + 30)
  const quoteCode = `Q-${today.toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 900 + 100)}`

  const overrideCommute: CommuteResult = {
    ...input.commute,
    mode: "daily",
    commute_fee,
    fuel_fee,
    lodging_fee,
  }

  return {
    line_items,
    subtotal: labor_subtotal,
    multiplier: 1,
    multiplier_breakdown: { flat: 1 },
    labor_total,
    commute_total,
    tax_total,
    total: final_price,
    final_price,
    currency: "NTD",
    quote_code: quoteCode,
    valid_until: validUntil.toISOString().split("T")[0],
    pricing_version: params.version,
    commute: overrideCommute,
    suggested_days: 1,
    daily_area: undefined,
  }
}
