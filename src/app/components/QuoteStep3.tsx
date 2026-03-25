"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import type { AirspaceResult, PricingResult, TimeResult, Contamination, FacadeData } from "@/lib/types"
import { generateQuote } from "@/lib/engines/pricing-engine"
import { estimateTime } from "@/lib/engines/time-engine"
import type { QuoteFormData, AreaEstimate } from "./quote-defaults"
import {
  buildFacadesFromInputs, buildFacades,
  allContaminationTypes, aggregateSupply,
  mapServiceToMissionType, mapTimeSlot,
  getWeatherRisk,
} from "./quote-defaults"
import { saveQuote } from "@/lib/stores/quote-store"

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
  "1":   "無加價",
  "1.1": "11-20F 加價",
  "1.3": "21-30F 加價",
  "1.5": ">30F 加價",
}

const BUILDING_LABELS: Record<string, string> = {
  commercial: "商辦大樓", luxury: "豪宅大樓",
  house: "透天厝", factory: "廠房", solar: "太陽能板",
}

export function QuoteStep3({
  formData, airspace, areaEstimate, buildingName,
  pricing, setPricing, timeResult, setTimeResult,
  onBack, onReset,
}: Props) {
  // ── LINE send state ───────────────────────────────────────────────────────
  const [lineSending, setLineSending] = useState(false)
  const [lineSent, setLineSent] = useState(false)
  const [lineError, setLineError] = useState<string | null>(null)

  const handleGetQuoteViaLine = useCallback(async () => {
    if (!pricing || !timeResult) return
    setLineSending(true)
    setLineError(null)

    try {
      const numBuildings = formData.numBuildings ?? 1
      const totalArea = areaEstimate.project_total_m2 ?? (areaEstimate.total_area_m2 * numBuildings)

      // Save locally first
      saveQuote({
        quote_code:    pricing.quote_code,
        client_name:   formData.clientName,
        address:       formData.address,
        building_name: buildingName || undefined,
        floors:        formData.floors,
        total_area_m2: totalArea,
        total_ntd:     pricing.total,
        suggested_days: timeResult.suggested_days,
      })

      // Generate PDF & save to server
      const res = await fetch("/api/quote/generate-and-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pricing,
          timeResult,
          formData: {
            clientName: formData.clientName,
            address: formData.address,
            buildingType: formData.buildingType,
            floors: formData.floors,
            numBuildings: formData.numBuildings,
            serviceType: formData.serviceType,
            timeSlot: formData.timeSlot,
            expectedDate: formData.expectedDate,
            urgent: formData.urgent,
          },
          areaEstimate: {
            source: areaEstimate.source,
            total_area_m2: areaEstimate.total_area_m2,
            project_total_m2: areaEstimate.project_total_m2,
            num_facades: areaEstimate.num_facades,
          },
          buildingName,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "伺服器錯誤" }))
        throw new Error((err as { error?: string }).error ?? "伺服器錯誤")
      }

      const { quoteCode } = (await res.json()) as { quoteCode: string }

      // Open LINE with pre-filled message
      const lineMessage = encodeURIComponent(`我要報價單 ${quoteCode}`)
      window.open(
        `https://line.me/R/oaMessage/@058xfgns/?${lineMessage}`,
        "_blank",
      )

      setLineSent(true)
    } catch (err) {
      setLineError(err instanceof Error ? err.message : "發送失敗，請重試")
    } finally {
      setLineSending(false)
    }
  }, [pricing, timeResult, formData, areaEstimate, buildingName])

  useEffect(() => {
    const hasPerFacade = formData.facadeInputs && formData.facadeInputs.length > 0
    const facades = hasPerFacade
      ? buildFacadesFromInputs(formData.facadeInputs!, areaEstimate, formData.buildingType)
      : buildFacades(areaEstimate, formData.buildingType)

    const contamination = hasPerFacade
      ? allContaminationTypes(formData.facadeInputs!)
      : (["dust"] as Contamination[])

    const timeWindow = mapTimeSlot(formData.timeSlot)
    const waterSupply = hasPerFacade ? aggregateSupply(formData.facadeInputs!, "water") : "Provided"
    const powerSupply = hasPerFacade ? aggregateSupply(formData.facadeInputs!, "power") : "Provided"
    const rooftopAccess = formData.rooftopAccess ?? "Good"
    const cleaningAgent = formData.cleaningAgent ?? "standard"

    setPricing(generateQuote({
      buildingType: formData.buildingType,
      floors: formData.floors,
      facades,
      contamination,
      cleaningAgent,
      timeWindow,
      waterSupply,
      powerSupply,
      rooftopAccess,
      urgent: formData.urgent,
    }))

    setTimeResult(estimateTime({
      missionType: mapServiceToMissionType(formData.serviceType),
      buildingType: formData.buildingType,
      floors: formData.floors,
      wind_ms: 4,
      facades,
      contamination,
      timeWindow,
      riskLevel: "R0",
      waterSupply,
      powerSupply,
      rooftopAccess,
    }))
  }, [formData, areaEstimate, setPricing, setTimeResult])

  // Compute per-facade geometry for display (width, height, area)
  const facadeGeometry = useMemo(() => {
    const hasPerFacade = formData.facadeInputs && formData.facadeInputs.length > 0
    const facades: FacadeData[] = hasPerFacade
      ? buildFacadesFromInputs(formData.facadeInputs!, areaEstimate, formData.buildingType)
      : buildFacades(areaEstimate, formData.buildingType)
    const height = areaEstimate.building_height_m
    return facades.map((f) => ({
      id: f.id,
      label: f.label,
      height_m: height,
      width_m: height > 0 ? Math.round((f.area_m2 / height) * 10) / 10 : 0,
      area_m2: f.area_m2,
    }))
  }, [formData, areaEstimate])

  if (!pricing || !timeResult) {
    return <div className="text-center py-12 text-zinc-500">計算中...</div>
  }

  const numBuildings = formData.numBuildings ?? 1
  // project_total_m2 is set when buildings have different sizes; otherwise multiply
  const totalArea = areaEstimate.project_total_m2 ?? (areaEstimate.total_area_m2 * numBuildings)

  // Group line items by building for display
  type BldgGroup = { name: string; area: number; subtotal: number; facades: number }
  const bldgGroups: BldgGroup[] = []
  const extraItems: typeof pricing.line_items = []
  for (const item of pricing.line_items) {
    if (item.code.startsWith("FACE-")) {
      // code format: "FACE-{buildingIdx}-{facadeIdx}"
      const bIdx = parseInt(item.code.slice(5).split("-")[0])
      while (bldgGroups.length <= bIdx) bldgGroups.push({ name: "", area: 0, subtotal: 0, facades: 0 })
      const grp = bldgGroups[bIdx]
      grp.name = numBuildings > 1
        ? `棟 ${["A","B","C","D","E","F"][bIdx] ?? bIdx + 1}`
        : "施作費用"
      grp.area += item.area_m2 ?? 0
      grp.subtotal += item.subtotal
      grp.facades++
    } else {
      extraItems.push(item)
    }
  }

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
              value={`${BUILDING_LABELS[formData.buildingType] ?? formData.buildingType} ${formData.floors}F（${(formData.floors * 3.5).toFixed(1)}m）`}
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
                  {formData.facadeInputs.map((f, idx) => {
                    const geo = facadeGeometry[idx]
                    return (
                      <tr key={f.id} className="border-b border-zinc-100">
                        <td className="py-2 font-semibold text-zinc-800">
                          {f.buildingLabel ? `${f.buildingLabel}棟-${f.label}` : f.label}
                        </td>
                        <td className="text-right py-2 text-zinc-600">
                          {geo ? `${geo.height_m}m` : "—"}
                        </td>
                        <td className="text-right py-2 text-zinc-600">
                          {geo ? `${geo.width_m}m` : "—"}
                        </td>
                        <td className="text-right py-2 text-zinc-700 font-medium">
                          {geo ? `${geo.area_m2.toLocaleString()} ㎡` : "—"}
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
              {bldgGroups.filter(Boolean).map((grp, idx) => (
                <tr key={`bldg-${idx}`} className="border-b border-zinc-100">
                  <td className="py-2">
                    {grp.name}
                    <span className="text-xs text-zinc-400 ml-1">（{grp.facades} 面）</span>
                  </td>
                  <td className="text-right py-2 text-zinc-600">
                    {grp.area.toLocaleString()} ㎡
                  </td>
                  <td className="text-right py-2 text-zinc-500 text-xs">
                    {grp.area > 0 && Number.isFinite(grp.subtotal) ? `${Math.round(grp.subtotal / grp.area)} NTD/㎡` : "—"}
                  </td>
                  <td className="text-right py-2 font-medium">
                    {Number.isFinite(grp.subtotal) ? `${grp.subtotal.toLocaleString()} NTD` : "— NTD"}
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
              <p className="text-3xl font-bold">NTD {pricing.total.toLocaleString()}</p>
            </div>
            <div className="text-right">
              <p className="text-blue-200 text-sm">預估工期</p>
              <p className="text-2xl font-bold">{timeResult.suggested_days} 天</p>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="px-6 py-3 bg-amber-50 border-t border-amber-200 text-sm text-amber-800">
          ⚠️ 本報價為快速估算，正式報價需現場勘查確認。
          面積估算基於{SOURCE_LABELS[areaEstimate.source]}，誤差範圍約 ±15%。
        </div>
      </div>

      {/* LINE CTA — get quote via LINE */}
      <div className="no-print border-2 border-[#06C755] rounded-xl overflow-hidden">
        {/* First-time customer discount highlight */}
        <div className="relative bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-400 px-6 py-4 text-center">
          <div className="absolute inset-0 bg-[repeating-linear-gradient(120deg,transparent,transparent_8px,rgba(255,255,255,0.1)_8px,rgba(255,255,255,0.1)_16px)]" />
          <p className="relative text-lg font-extrabold text-amber-900 tracking-wide">
            首次合作客戶最低享九折優惠！
          </p>
        </div>

        {lineSent ? (
          <div className="px-6 py-5 bg-green-50 text-center space-y-3">
            <div className="text-3xl">✅</div>
            <p className="text-sm font-semibold text-green-800">
              報價單已生成，LINE 已開啟！
            </p>
            <p className="text-xs text-green-700">
              請在 LINE 中送出訊息，即可立即收到報價單 PDF。
            </p>
            <p className="text-xs text-zinc-500 mt-2">
              報價編號：<span className="font-mono font-medium">{pricing.quote_code}</span>
            </p>
            <button
              onClick={() => setLineSent(false)}
              className="text-xs text-green-600 hover:text-green-800 underline mt-2"
            >
              重新發送
            </button>
          </div>
        ) : (
          <div className="px-6 py-6 space-y-5">
            {/* Title */}
            <div className="text-center space-y-1">
              <p className="text-base font-semibold text-zinc-900">
                透過 LINE 取得完整報價單 PDF
              </p>
              <p className="text-xs text-zinc-500">
                點擊下方按鈕，系統將自動生成報價單並透過 LINE 官方帳號發送給您
              </p>
            </div>

            {/* Main CTA button */}
            <div className="flex justify-center">
              <button
                onClick={handleGetQuoteViaLine}
                disabled={lineSending}
                className="flex items-center gap-3 px-8 py-3.5 rounded-xl font-semibold text-white text-base transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait"
                style={{ backgroundColor: "#06C755" }}
              >
                {lineSending ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    生成報價單中...
                  </>
                ) : (
                  <>
                    {/* LINE icon */}
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                    </svg>
                    透過 LINE 取得報價單
                  </>
                )}
              </button>
            </div>

            {/* Error */}
            {lineError && (
              <div className="text-center">
                <p className="text-sm text-red-600">{lineError}</p>
                <button
                  onClick={handleGetQuoteViaLine}
                  className="text-xs text-red-500 hover:text-red-700 underline mt-1"
                >
                  重試
                </button>
              </div>
            )}

          </div>
        )}
      </div>

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

