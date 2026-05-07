"use client"

import { useEffect, useMemo } from "react"
import type { AirspaceResult, PricingResult, TimeResult } from "@/lib/types"
import { computeDailyArea } from "@/lib/engines/productivity-engine"
import { estimateTime } from "@/lib/engines/time-engine"
import { generateQuote } from "@/lib/engines/pricing-engine"
import { estimateCommute } from "@/lib/engines/commute-engine"
import { getPricingParams } from "@/lib/engines/pricing-params"
import type { QuoteFormData, AreaEstimate } from "./quote-defaults"
import { getWeatherRisk } from "./quote-defaults"
import { LineQuoteCta } from "./LineQuoteCta"

interface Props {
  formData: QuoteFormData
  airspace: AirspaceResult | null
  areaEstimate: AreaEstimate
  buildingName: string | null
  pricing: PricingResult | null
  setPricing: (p: PricingResult) => void
  timeResult: TimeResult | null
  setTimeResult: (t: TimeResult) => void
  onBack: () => void
  onReset: () => void
}

const SOURCE_LABELS: Record<string, string> = {
  overpass: "地圖自動偵測",
  "manual-draw": "手動框選",
  default: "智慧預設值",
}

const FLOOR_MULTIPLIER_LABEL: Record<string, string> = {
  "1":    "無加價",
  "1.05": "11-20F 加價",
  "1.12": "21-30F 加價",
  "1.25": ">30F 加價",
}

const BUILDING_LABELS: Record<string, string> = {
  commercial: "商辦大樓", luxury: "住宅社區",
  house: "透天厝", factory: "廠房", solar: "太陽能板",
}

export function QuoteStep3({
  formData, airspace, areaEstimate, buildingName,
  pricing, setPricing, timeResult, setTimeResult,
  onBack, onReset,
}: Props) {
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const facades = formData.facadeInputs ?? []
      const totalArea = areaEstimate.project_total_m2
        ?? (areaEstimate.total_area_m2 * (formData.numBuildings ?? 1))
      // Approximate per-facade areas: each gets equal share of total
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

  // Map from FACE-<label> line items back to area_m2 for the facade table
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

  if (!pricing || !timeResult) {
    return <div className="text-center py-12 text-zinc-500">計算中...</div>
  }

  const numBuildings = formData.numBuildings ?? 1
  // project_total_m2 is set when buildings have different sizes; otherwise multiply
  const totalArea = areaEstimate.project_total_m2 ?? (areaEstimate.total_area_m2 * numBuildings)

  // Separate line items by type
  const faceItems = pricing.line_items.filter(item => item.code.startsWith("FACE-"))
  const extraItems = pricing.line_items.filter(item => !item.code.startsWith("FACE-"))

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-zinc-900 no-print">Step 3 — 報價結果</h2>

      <div id="quote-print-area" className="border border-zinc-300 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="bg-zinc-800 text-white px-4 sm:px-6 py-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-base sm:text-lg font-bold">GDS 低空作業 快速報價單</h3>
              <p className="text-zinc-400 text-xs sm:text-sm">Quick Quote — 估算報價，正式報價以現場勘查為準</p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-mono text-sm">{pricing.quote_code}</p>
              <p className="text-zinc-400 text-xs">有效至 {pricing.valid_until}</p>
            </div>
          </div>
        </div>

        {/* Info grid */}
        <div className="px-4 sm:px-6 py-4 bg-zinc-50 border-b border-zinc-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <InfoRow label="客戶" value={formData.clientName} />
            <InfoRow label="地址" value={formData.address} />
            {buildingName && (
              <InfoRow label="建物名稱" value={buildingName} />
            )}
            <InfoRow
              label="建物"
              value={formData.heightMode === "height" && formData.heightM
                ? `${BUILDING_LABELS[formData.buildingType] ?? formData.buildingType} ${formData.heightM}m（≈ ${Math.round(formData.heightM / 3.5)}F）`
                : `${BUILDING_LABELS[formData.buildingType] ?? formData.buildingType} ${formData.floors}F（${(formData.floors * 3.5).toFixed(1)}m）`}
            />
            {(formData.numBuildings ?? 1) > 1 && (
              <InfoRow label="棟數" value={`${formData.numBuildings} 棟`} />
            )}
            <InfoRow
              label="空域"
              value={
                !airspace || airspace.status === "OK" ? "✅ 可直接作業" :
                airspace.status === "NeedPermit" ? "⚠️ 需申請許可" : "🚫 禁飛區"
              }
            />
            {formData.regionExposure && <InfoRow label="環境曝露" value={formData.regionExposure === "windward" ? "迎風面" : formData.regionExposure === "leeward" ? "背風面" : formData.regionExposure === "coastal" ? "沿海" : "開闊屋頂"} />}
            {formData.crowdDensity && <InfoRow label="人流密度" value={formData.crowdDensity === "low" ? "低" : formData.crowdDensity === "medium" ? "中" : "高"} />}
            <InfoRow label="面積來源" value={SOURCE_LABELS[areaEstimate.source]} />
            <InfoRow
              label="施作總面積"
              value={
                areaEstimate.project_total_m2 != null
                  ? `${totalArea.toLocaleString()} ㎡（各棟實測合計）`
                  : numBuildings > 1
                    ? `${totalArea.toLocaleString()} ㎡（${areaEstimate.total_area_m2.toLocaleString()} ㎡ × ${numBuildings} 棟）`
                    : `${totalArea.toLocaleString()} ㎡`
              }
            />
            {formData.expectedDate && (
              <InfoRow label="預計施工日期" value={formData.expectedDate} />
            )}
          </div>
        </div>

        {/* Per-facade summary with dimensions */}
        {formData.facadeInputs && formData.facadeInputs.length > 0 && (
          <div className="px-4 sm:px-6 py-4 border-b border-zinc-200">
            <h4 className="text-sm font-semibold text-zinc-600 mb-3">各立面概況</h4>
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs min-w-[480px]">
                <thead>
                  <tr className="text-zinc-500 border-b">
                    <th className="text-left py-2 font-medium">立面</th>
                    <th className="text-right py-2 font-medium">高度</th>
                    <th className="text-right py-2 font-medium">寬度</th>
                    <th className="text-right py-2 font-medium">面積</th>
                    <th className="text-left py-2 pl-3 font-medium">狀況</th>
                  </tr>
                </thead>
                <tbody>
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
                          <div className="flex flex-wrap gap-1">
                            <span>{f.complexity === "light" ? "輕微" : f.complexity === "medium" ? "中等" : "複雜"}</span>
                            {f.hasRecesses && <span className="text-amber-600">· 內縮</span>}
                            {f.isHighRisk && <span className="text-red-600">· 高風險</span>}
                            {f.hasAdjacentTrees && (
                              <span className="text-green-700">
                                · 鄰樹{f.treeFloors > 0 ? ` ${f.treeFloors}F` : ""}
                                {f.treeFloors > 0 && !f.cleanTreeFloors ? "（不清洗）" : ""}
                              </span>
                            )}
                            {f.waterSupply === "SelfSupply" && <span className="text-orange-600">· 自備水</span>}
                            {f.powerSupply === "SelfSupply" && <span className="text-orange-600">· 自備電</span>}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Weather risk advisory */}
        <WeatherAdvisory date={formData.expectedDate} suggestedDays={timeResult.suggested_days} />

        {/* Line items — grouped by building */}
        <div className="px-4 sm:px-6 py-4">
          <h4 className="text-sm font-semibold text-zinc-600 mb-3">費用明細</h4>
          <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[360px]">
            <thead>
              <tr className="text-zinc-500 border-b">
                <th className="text-left py-2 font-medium">項目</th>
                <th className="text-right py-2 font-medium">施作面積</th>
                <th className="text-right py-2 font-medium">單價</th>
                <th className="text-right py-2 font-medium">小計</th>
              </tr>
            </thead>
            <tbody>
              {faceItems.map((item) => (
                <tr key={item.code} className="border-b border-zinc-100">
                  <td className="py-2">{item.label}</td>
                  <td className="text-right py-2 text-zinc-600">
                    {item.area_m2 != null ? `${item.area_m2.toLocaleString()} ㎡` : "—"}
                  </td>
                  <td className="text-right py-2 text-zinc-500 text-xs">
                    {item.unit_price != null ? `${item.unit_price} NTD/㎡` : "—"}
                  </td>
                  <td className="text-right py-2 font-medium">
                    {item.subtotal.toLocaleString()} NTD
                  </td>
                </tr>
              ))}
              {extraItems.map(item => (
                <tr key={item.code} className="border-b border-zinc-100">
                  <td className="py-2">{item.label}</td>
                  <td className="text-right py-2 text-zinc-600">—</td>
                  <td className="text-right py-2 text-zinc-500">—</td>
                  <td className="text-right py-2 font-medium">
                    {item.subtotal.toLocaleString()} NTD
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200">
                <td colSpan={3} className="py-2 text-right text-zinc-500">小計</td>
                <td className="text-right py-2 font-medium">{pricing.subtotal.toLocaleString()} NTD</td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>

        {/* Multipliers */}
        <div className="px-4 sm:px-6 py-4 bg-zinc-50 border-t border-zinc-200">
          <h4 className="text-sm font-semibold text-zinc-600 mb-3">調整係數</h4>
          <div className="space-y-1 text-sm">
            {Object.entries(pricing.multiplier_breakdown).map(([key, val]) => (
              <div key={key} className="flex justify-between">
                <span className="text-zinc-600">
                  {key === "floor"       ? `高樓加價（${FLOOR_MULTIPLIER_LABEL[String(val)] ?? ""}）` :
                   key === "time_window" ? "施工時段" :
                   key === "urgent"      ? "急件加價" : key}
                </span>
                <span className={val > 1 ? "text-orange-600 font-medium" : "text-zinc-500"}>
                  × {val.toFixed(2)}
                </span>
              </div>
            ))}
            <div className="flex justify-between pt-1 border-t border-zinc-300 font-medium">
              <span>合計倍率</span>
              <span>× {pricing.multiplier.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Total */}
        <div className="px-4 sm:px-6 py-5 bg-blue-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-200 text-sm">報價總額</p>
              <p className="text-3xl font-bold">NTD {pricing.final_price.toLocaleString()}</p>
            </div>
            <div className="text-right">
              <p className="text-blue-200 text-sm">預估工期</p>
              <p className="text-2xl font-bold">{timeResult.suggested_days} 天</p>
            </div>
          </div>
        </div>

        {/* Commute warning banner */}
        {pricing.commute?.warning && (
          <div className="mx-6 mb-4 px-4 py-3 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 text-sm">
            ⚠️ 通勤費為估算值（{pricing.commute.warning}）— 實際以現勘為準
          </div>
        )}

        {/* Disclaimer */}
        <div className="px-6 py-3 bg-amber-50 border-t border-amber-200 text-sm text-amber-800">
          ⚠️ 本報價為快速估算，正式報價需現場勘查確認。
          面積估算基於{SOURCE_LABELS[areaEstimate.source]}，誤差範圍約 ±15%。
        </div>
      </div>

      {/* LINE CTA — get quote via LINE */}
      <LineQuoteCta
        pricing={pricing}
        timeResult={timeResult}
        formData={formData}
        areaEstimate={areaEstimate}
        buildingName={buildingName}
      />

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2 no-print">
        <button
          onClick={onBack}
          className="px-5 py-3 sm:py-2.5 border border-zinc-300 text-zinc-700 rounded-lg hover:bg-zinc-50 transition-colors"
        >
          上一步
        </button>
        <button
          onClick={onReset}
          className="px-5 py-3 sm:py-2.5 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 transition-colors"
        >
          重新填寫
        </button>
      </div>
    </div>
  )
}

// ─── Weather advisory ─────────────────────────────────────────────────────────

const RISK_STYLES = {
  low:    { bg: "bg-green-50",  border: "border-green-200",  text: "text-green-800",  badge: "bg-green-100 text-green-700"  },
  medium: { bg: "bg-amber-50",  border: "border-amber-200",  text: "text-amber-800",  badge: "bg-amber-100 text-amber-700"  },
  high:   { bg: "bg-red-50",    border: "border-red-200",    text: "text-red-800",    badge: "bg-red-100   text-red-700"    },
}
const RISK_LABELS = { low: "低風險", medium: "中度風險", high: "高風險" }

function WeatherAdvisory({ date, suggestedDays }: { date?: string; suggestedDays: number }) {
  const risk = getWeatherRisk(date)
  const s = RISK_STYLES[risk.level]
  const totalDays = suggestedDays + risk.bufferDays

  return (
    <div className={`mx-6 mb-4 p-4 rounded-lg border ${s.bg} ${s.border}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">{risk.icon}</span>
        <span className={`text-sm font-semibold ${s.text}`}>天氣風險評估</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.badge}`}>
          {RISK_LABELS[risk.level]}
        </span>
        <span className={`text-xs ml-auto ${s.text} opacity-80`}>{risk.season}</span>
      </div>

      <div className={`text-xs space-y-0.5 ${s.text} opacity-90 mb-2`}>
        {risk.concerns.map(c => <p key={c}>• {c}</p>)}
      </div>

      <p className={`text-xs font-medium ${s.text}`}>{risk.advice}</p>

      {risk.bufferDays > 0 && (
        <div className={`mt-2 pt-2 border-t ${s.border} flex items-center justify-between text-xs ${s.text}`}>
          <span>含天氣緩衝估算工期</span>
          <span className="font-semibold">
            {suggestedDays} 天（施作）+ {risk.bufferDays} 天（緩衝）= {totalDays} 天
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-zinc-500">{label}：</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
