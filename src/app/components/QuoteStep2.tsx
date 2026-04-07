"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import type { RooftopAccess } from "@/lib/types"
import type { QuoteFormData, AreaEstimate, QuoteFacadeInput, BuildingDimensions, CleaningAgent } from "./quote-defaults"
import {
  BUILDING_TYPE_OPTIONS, TIME_SLOT_OPTIONS, CLEANING_AGENT_OPTIONS,
  estimateFromPerimeter, estimateFromDefaults, estimateFromDimensions,
  estimateFromMultiPerimeters,
  buildDefaultFacadeInputs,
} from "./quote-defaults"
import { QuoteMap } from "./QuoteMap"
import type { PersistedShape } from "./QuoteMap"
import { QuoteFacadeEditor } from "./QuoteFacadeEditor"
import { ExamplePopover } from "./ExamplePopover"
import { CLEANING_AGENT_EXAMPLES } from "./example-popover-data"

interface Props {
  formData: Partial<QuoteFormData>
  updateForm: (patch: Partial<QuoteFormData>) => void
  buildingPerimeter: number | null
  buildingPolygon: { lat: number; lon: number }[] | null
  buildingDimensions: BuildingDimensions | null
  areaEstimate: AreaEstimate | null
  setAreaEstimate: (a: AreaEstimate) => void
  onNext: () => void
  onBack: () => void
  /** Callback ref for map container — used for screenshot capture */
  mapContainerRef?: (el: HTMLDivElement | null) => void
}

// Local type for a completed drawn polygon
interface DrawnPolygon {
  vertices: [number, number][]
  area_m2: number
  perimeter_m: number
}

const SOURCE_LABELS: Record<string, string> = {
  overpass: "地圖自動偵測（MBR）",
  "manual-draw": "手動繪製",
  default: "智慧預設值",
}

const BUILDING_LABELS = ["A", "B", "C", "D", "E", "F"]

export function QuoteStep2({
  formData, updateForm, buildingPerimeter, buildingPolygon,
  buildingDimensions, areaEstimate, setAreaEstimate, onNext, onBack,
  mapContainerRef,
}: Props) {
  const floors = formData.floors ?? 10
  const heightMode = formData.heightMode ?? "floors"
  const heightM = formData.heightM ?? floors * 3.5
  const effectiveHeight = heightMode === "height" ? heightM : floors * 3.5
  const numFacades = formData.numFacades ?? 4
  const numBuildings = formData.numBuildings ?? 1
  const buildingType = formData.buildingType ?? "commercial"
  const [overrideWidth, setOverrideWidth] = useState<string>("")
  const [drawMode, setDrawMode] = useState(false)

  // Per-building drawn polygons (one slot per building index)
  const [drawnPolygons, setDrawnPolygons] = useState<(DrawnPolygon | null)[]>([])
  const [drawTarget, setDrawTarget] = useState(0)
  const drawTargetRef = useRef(drawTarget)
  useEffect(() => { drawTargetRef.current = drawTarget }, [drawTarget])

  // Per-building face counts from polygon vertices
  const perBuildingNumFacades: number[] = Array.from({ length: numBuildings }, (_, b) => {
    const poly = drawnPolygons[b]
    if (poly && poly.vertices.length >= 3) return poly.vertices.length
    if (b === 0 && buildingPolygon && buildingPolygon.length >= 3) return buildingPolygon.length
    return numFacades
  })

  // Auto-derive numFacades from polygon vertices (single-building or first building)
  useEffect(() => {
    const drawnPoly = drawnPolygons[0]
    if (drawnPoly && drawnPoly.vertices.length >= 3) {
      updateForm({ numFacades: drawnPoly.vertices.length })
    } else if (buildingPolygon && buildingPolygon.length >= 3) {
      updateForm({ numFacades: buildingPolygon.length })
    }
    // Update per-building face counts
    if (numBuildings > 1) {
      const counts = Array.from({ length: numBuildings }, (_, b) => {
        const poly = drawnPolygons[b]
        if (poly && poly.vertices.length >= 3) return poly.vertices.length
        return numFacades
      })
      updateForm({ numFacadesPerBuilding: counts })
    }
  }, [drawnPolygons, buildingPolygon, numBuildings]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep facade inputs in sync with per-building face counts
  useEffect(() => {
    const totalFacades = numBuildings > 1
      ? perBuildingNumFacades.reduce((s, n) => s + n, 0)
      : numFacades * numBuildings
    const existing = formData.facadeInputs ?? []
    if (existing.length !== totalFacades) {
      const defaults = buildDefaultFacadeInputs(
        numFacades, numBuildings,
        numBuildings > 1 ? perBuildingNumFacades : undefined,
      )
      // Preserve existing facade data by matching buildingIndex + facade position
      const merged = defaults.map((d) => {
        const match = existing.find(e => e.buildingIndex === d.buildingIndex && e.label === d.label)
        return match ? { ...match, id: d.id, buildingLabel: d.buildingLabel } : d
      })
      updateForm({ facadeInputs: merged })
    }
  }, [numFacades, numBuildings, drawnPolygons]) // eslint-disable-line react-hooks/exhaustive-deps

  // Recalculate area estimate whenever inputs change
  const ho = heightMode === "height" ? effectiveHeight : undefined
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
    } else if (buildingDimensions && buildingDimensions.width_m > 0) {
      setAreaEstimate(estimateFromDimensions(buildingDimensions, floors, numFacades, ho))
    } else if (buildingPerimeter && buildingPerimeter > 0) {
      setAreaEstimate(estimateFromPerimeter(buildingPerimeter, floors, numFacades, "overpass", ho))
    } else {
      setAreaEstimate(estimateFromDefaults(buildingType, floors, numFacades, ho))
    }
  }, [floors, heightMode, effectiveHeight, numFacades, numBuildings, buildingType, buildingPerimeter, buildingDimensions, overrideWidth, drawnPolygons, setAreaEstimate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stable callback — uses ref to avoid map re-init when drawTarget changes
  const handlePolygonDraw = useCallback((
    vertices: [number, number][],
    area_m2: number,
    perimeter_m: number,
  ) => {
    const idx = drawTargetRef.current
    setDrawnPolygons(prev => {
      const next = Array.from(
        { length: Math.max(prev.length, idx + 1) },
        (_, i) => prev[i] ?? null,
      )
      next[idx] = { vertices, area_m2, perimeter_m }
      return next
    })
    setOverrideWidth("")
  }, [])

  const handleDrawModeEnd = useCallback(() => setDrawMode(false), [])

  const clearPolygon = useCallback((idx: number) => {
    setDrawnPolygons(prev => { const next = [...prev]; next[idx] = null; return next })
  }, [])

  const handleFacadesChange = useCallback((facades: QuoteFacadeInput[]) => {
    updateForm({ facadeInputs: facades })
  }, [updateForm])

  // Cleaning agent popover state
  const [agentPopover, setAgentPopover] = useState<{ value: string; el: HTMLElement } | null>(null)
  const closeAgentPopover = useCallback(() => setAgentPopover(null), [])

  // Build persisted shapes for map display (with per-edge face labels)
  const persistedShapes: PersistedShape[] = []
  drawnPolygons.forEach((p, i) => {
    if (!p) return
    const bLabel = numBuildings > 1 ? (BUILDING_LABELS[i] ?? String(i + 1)) : ""
    const edgeLabels = p.vertices.map((_, ei) =>
      bLabel ? `${bLabel}棟-${ei + 1}面` : `${ei + 1}面`
    )
    persistedShapes.push({
      vertices: p.vertices,
      label: numBuildings > 1 ? `棟${bLabel}` : "已繪範圍",
      edgeLabels,
    })
  })

  const drawLabel = numBuildings > 1 && drawMode
    ? `棟${BUILDING_LABELS[drawTarget] ?? drawTarget + 1}`
    : undefined

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-semibold text-zinc-900">Step 2 — 建物概況</h2>

      {/* ── Section 1: Building basics + map ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: building fields */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">棟數</label>
            <input
              type="number"
              value={numBuildings}
              onChange={e => updateForm({ numBuildings: Math.max(1, Math.min(20, parseInt(e.target.value) || 1)) })}
              min={1} max={20}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">建物類型</label>
            <select
              value={buildingType}
              onChange={e => updateForm({ buildingType: e.target.value as QuoteFormData["buildingType"] })}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {BUILDING_TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">建物高度</label>
            <div className="flex gap-1 mb-2">
              <button type="button"
                onClick={() => updateForm({ heightMode: "floors" })}
                className={`flex-1 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                  heightMode === "floors"
                    ? "bg-blue-50 border-blue-400 text-blue-700 font-medium"
                    : "border-zinc-300 text-zinc-600 hover:border-blue-300"
                }`}
              >
                樓層數
              </button>
              <button type="button"
                onClick={() => updateForm({ heightMode: "height", heightM: effectiveHeight })}
                className={`flex-1 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                  heightMode === "height"
                    ? "bg-blue-50 border-blue-400 text-blue-700 font-medium"
                    : "border-zinc-300 text-zinc-600 hover:border-blue-300"
                }`}
              >
                直接輸入高度
              </button>
            </div>
            {heightMode === "floors" ? (
              <div className="flex items-center gap-2">
                <input type="number" value={floors}
                  onChange={e => updateForm({ floors: Math.max(1, parseInt(e.target.value) || 1) })}
                  min={1} max={100}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <span className="text-sm text-zinc-500 whitespace-nowrap">F（{effectiveHeight.toFixed(1)}m）</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input type="number" value={heightM}
                  onChange={e => updateForm({ heightM: Math.max(1, parseFloat(e.target.value) || 1) })}
                  min={1} max={500} step={0.5}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <span className="text-sm text-zinc-500 whitespace-nowrap">m（≈ {Math.round(heightM / 3.5)}F）</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              立面數量
              <span className="text-xs font-normal text-zinc-400 ml-1">（依建物範圍自動偵測）</span>
            </label>
            {numBuildings > 1 ? (
              <div className="flex flex-wrap gap-2">
                {perBuildingNumFacades.map((count, b) => (
                  <span key={b} className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm font-medium text-blue-800">
                    {BUILDING_LABELS[b] ?? b + 1}棟 = {count}面
                  </span>
                ))}
              </div>
            ) : (
              <div className="px-3 py-2 bg-zinc-100 border border-zinc-200 rounded-lg text-sm text-zinc-700 font-medium">
                {numFacades} 面
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">施工時段</label>
            <select value={formData.timeSlot ?? "day"}
              onChange={e => updateForm({ timeSlot: e.target.value as QuoteFormData["timeSlot"] })}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {TIME_SLOT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              清潔方式
              <span className="text-xs font-normal text-zinc-400 ml-1">（整案）</span>
            </label>
            <div className="flex flex-col gap-2">
              {CLEANING_AGENT_OPTIONS.map(o => {
                const active = (formData.cleaningAgent ?? "standard") === o.value
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => updateForm({ cleaningAgent: o.value as CleaningAgent })}
                    onPointerEnter={e => { if (e.pointerType === "mouse") setAgentPopover({ value: o.value, el: e.currentTarget }) }}
                    onPointerLeave={e => { if (e.pointerType === "mouse") setAgentPopover(null) }}
                    onPointerDown={e => {
                      if (e.pointerType === "touch") {
                        setAgentPopover(prev => prev?.value === o.value ? null : { value: o.value, el: e.currentTarget })
                      }
                    }}
                    className={`px-3 py-2 rounded-lg text-sm border text-left transition-colors ${
                      active
                        ? "bg-blue-600 text-white border-blue-600 font-medium"
                        : "bg-white text-zinc-600 border-zinc-300 hover:border-blue-400"
                    }`}
                  >
                    {o.label}
                  </button>
                )
              })}
            </div>
            {agentPopover && CLEANING_AGENT_EXAMPLES[agentPopover.value] && (
              <ExamplePopover
                anchorEl={agentPopover.el}
                open
                onClose={closeAgentPopover}
                info={CLEANING_AGENT_EXAMPLES[agentPopover.value]}
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              屋頂吊掛條件
              <span className="text-xs font-normal text-zinc-400 ml-1">（影響所有立面）</span>
            </label>
            <select
              value={formData.rooftopAccess ?? "Good"}
              onChange={e => updateForm({ rooftopAccess: e.target.value as RooftopAccess })}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="Good">良好（女兒牆佳）</option>
              <option value="Limited">受限（女兒牆深/寬）</option>
              <option value="NotAvailable">不可使用</option>
            </select>
          </div>

          {/* LARM site inputs — synced with LAOP Step3Building */}
          <div className="pt-3 border-t border-zinc-200">
            <p className="text-xs font-semibold text-zinc-500 mb-3 uppercase tracking-wider">場址環境（LARM 風險評估）</p>

            <div className="space-y-3">
              <div>
                <label className="block text-sm text-zinc-600 mb-1">環境曝露類型</label>
                <select
                  value={formData.regionExposure ?? ""}
                  onChange={e => updateForm({ regionExposure: (e.target.value || undefined) as QuoteFormData["regionExposure"] })}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                >
                  <option value="">未指定</option>
                  <option value="windward">迎風面</option>
                  <option value="leeward">背風面</option>
                  <option value="coastal">沿海</option>
                  <option value="rooftop_open">開闊屋頂</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-zinc-600 mb-1">周圍人流密度</label>
                <div className="flex gap-2">
                  {(["low", "medium", "high"] as const).map(v => (
                    <button key={v} type="button"
                      onClick={() => updateForm({ crowdDensity: v })}
                      className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                        formData.crowdDensity === v
                          ? "bg-blue-50 border-blue-400 text-blue-700 font-medium"
                          : "border-zinc-300 text-zinc-600 hover:border-blue-300"
                      }`}
                    >
                      {v === "low" ? "低" : v === "medium" ? "中" : "高"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-zinc-600 cursor-pointer">
                  <input type="checkbox" checked={formData.nearBaseStation ?? false}
                    onChange={e => updateForm({ nearBaseStation: e.target.checked })}
                    className="rounded border-zinc-300" />
                  附近有基地台
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-600 cursor-pointer">
                  <input type="checkbox" checked={formData.windChannelEffect ?? false}
                    onChange={e => updateForm({ windChannelEffect: e.target.checked })}
                    className="rounded border-zinc-300" />
                  風道效應
                </label>
              </div>

              <div>
                <label className="block text-sm text-zinc-600 mb-1">工作間距（公尺）</label>
                <input type="number" value={formData.clearanceM ?? ""}
                  onChange={e => updateForm({ clearanceM: e.target.value ? parseFloat(e.target.value) : undefined })}
                  placeholder="例：3"
                  min={0} step={0.5}
                  className="w-28 px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: map + area estimation */}
        <div className="space-y-3">
          {formData.lat && formData.lng && (
            <>
              {/* ── Draw mode controls ── */}
              {numBuildings <= 1 ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setDrawTarget(0); setDrawMode(m => !m) }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border font-medium transition-colors ${
                        drawMode
                          ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                          : "bg-white text-zinc-600 border-zinc-300 hover:border-blue-400 hover:text-blue-600"
                      }`}
                    >
                      ✏️ {drawMode ? "繪製中 — 按此取消" : "點擊繪製建物範圍"}
                    </button>
                    {drawMode && (
                      <span className="text-xs text-zinc-500">點擊地圖逐點加入頂點，點擊起點（紅圓）閉合</span>
                    )}
                    {drawnPolygons[0] && !drawMode && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-lg font-medium">
                          {Math.round(drawnPolygons[0].area_m2).toLocaleString()} ㎡
                          <span className="font-normal ml-1 opacity-70">
                            · {drawnPolygons[0].vertices.length} 頂點
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => clearPolygon(0)}
                          className="text-xs text-zinc-400 hover:text-red-500 transition-colors"
                        >×</button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Multi-building — per-building draw buttons */
                <div className="space-y-2">
                  <p className="text-xs font-medium text-zinc-500">分別繪製各棟範圍：</p>
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: numBuildings }, (_, i) => {
                      const bLabel = BUILDING_LABELS[i] ?? String(i + 1)
                      const poly = drawnPolygons[i]
                      const isActive = drawMode && drawTarget === i
                      return (
                        <div key={i} className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (isActive) { setDrawMode(false) }
                              else { setDrawTarget(i); setDrawMode(true) }
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs border font-medium transition-colors ${
                              isActive
                                ? "bg-blue-600 text-white border-blue-600"
                                : poly
                                  ? "bg-green-50 text-green-700 border-green-400 hover:border-green-600"
                                  : "bg-white text-zinc-600 border-zinc-300 hover:border-blue-400"
                            }`}
                          >
                            ✏️ 棟{bLabel}
                            {isActive
                              ? " — 按此取消"
                              : poly
                                ? ` ${Math.round(poly.area_m2).toLocaleString()}㎡`
                                : "（未繪製）"}
                          </button>
                          {poly && !isActive && (
                            <button
                              type="button"
                              onClick={() => clearPolygon(i)}
                              className="text-xs text-zinc-400 hover:text-red-500 transition-colors"
                            >×</button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {drawMode && (
                    <span className="text-xs text-zinc-400">
                      點擊地圖逐點加入頂點，點擊起點閉合棟{BUILDING_LABELS[drawTarget] ?? drawTarget + 1}範圍
                    </span>
                  )}
                </div>
              )}

              <QuoteMap
                lat={formData.lat} lng={formData.lng}
                airspace={null}
                drawMode={drawMode}
                drawLabel={drawLabel}
                persistedShapes={persistedShapes}
                onPolygonDraw={handlePolygonDraw}
                onDrawModeEnd={handleDrawModeEnd}
                mapContainerRef={mapContainerRef}
              />
            </>
          )}

          {areaEstimate && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">📐</span>
                <span className="font-medium text-blue-900">面積估算</span>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                  {SOURCE_LABELS[areaEstimate.source]}
                </span>
              </div>
              <div className="space-y-1 text-sm text-blue-800">
                {buildingDimensions && buildingDimensions.width_m > 0 && !drawnPolygons.some(p => p != null) && (
                  <p className="font-medium">
                    建物尺寸：{buildingDimensions.width_m} × {buildingDimensions.depth_m} m
                    <span className="text-xs font-normal ml-1 opacity-70">
                      （方位 {buildingDimensions.angle_deg}°）
                    </span>
                  </p>
                )}
                {areaEstimate.perBuildingTotals_m2 && areaEstimate.perBuildingTotals_m2.length > 1 ? (
                  <>
                    <p>建物高度 = {heightMode === "height" ? `${areaEstimate.building_height_m}m` : `${floors}F × 3.5m = ${areaEstimate.building_height_m}m`}</p>
                    {areaEstimate.perBuildingTotals_m2.map((total, i) => {
                      const drawn = !!drawnPolygons[i]
                      return (
                        <p key={i} className={`flex justify-between${drawn ? "" : " opacity-50"}`}>
                          <span>
                            棟{BUILDING_LABELS[i] ?? i + 1}　周長 {areaEstimate.perBuildingPerimeters_m?.[i] ?? "—"} m × 高 {areaEstimate.building_height_m}m
                            {!drawn && <span className="text-xs ml-1">（未繪製）</span>}
                          </span>
                          <span>≈ {total.toLocaleString()} ㎡</span>
                        </p>
                      )
                    })}
                    <p className="font-semibold text-base pt-1 border-t border-blue-200 mt-1">
                      各棟合計 ≈ {areaEstimate.project_total_m2!.toLocaleString()} ㎡
                    </p>
                  </>
                ) : (
                  <>
                    {drawnPolygons[0] && (
                      <p className="text-xs text-blue-700 opacity-80">
                        多邊形周長 ≈ {Math.round(drawnPolygons[0].perimeter_m)} m
                      </p>
                    )}
                    {!areaEstimate.perBuildingFacadeWidths && areaEstimate.facadeWidths_m && areaEstimate.facadeWidths_m.length > 1 ? (
                      <div className="flex gap-2 flex-wrap">
                        {areaEstimate.facadeWidths_m.map((w, i) => (
                          <span key={i} className="text-xs bg-blue-100 px-2 py-0.5 rounded">
                            {i + 1}面：{w} m
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p>每面均寬 ≈ {areaEstimate.facade_width_m} m</p>
                    )}
                    <p>建物高度 = {heightMode === "height" ? `${areaEstimate.building_height_m}m` : `${floors}F × 3.5m = ${areaEstimate.building_height_m}m`}</p>
                    <p className="font-semibold text-base pt-1">
                      {areaEstimate.project_total_m2 != null ? (
                        <>各棟合計 ≈ {areaEstimate.project_total_m2.toLocaleString()} ㎡</>
                      ) : (
                        <>
                          單棟施作面積 ≈ {areaEstimate.total_area_m2.toLocaleString()} ㎡
                          {numBuildings > 1 && (
                            <span className="text-sm font-normal ml-1 opacity-80">
                              × {numBuildings} 棟 = {(areaEstimate.total_area_m2 * numBuildings).toLocaleString()} ㎡
                            </span>
                          )}
                        </>
                      )}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Manual width override — only when no polygon drawn */}
          {numBuildings <= 1 && !drawnPolygons[0] && (
            <div>
              <label className="block text-sm text-zinc-500 mb-1">手動輸入每面寬度（可選）</label>
              <div className="flex items-center gap-2">
                <input type="number" value={overrideWidth}
                  onChange={e => { setOverrideWidth(e.target.value) }}
                  placeholder={areaEstimate ? String(areaEstimate.facade_width_m) : ""}
                  min={1}
                  className="w-28 px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
                <span className="text-sm text-zinc-500">公尺</span>
                {overrideWidth && (
                  <button onClick={() => setOverrideWidth("")} className="text-xs text-blue-600 hover:underline">
                    恢復自動
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Section 2: Per-facade editor ── */}
      <div className="border-t border-zinc-200 pt-6">
        {formData.facadeInputs && formData.facadeInputs.length > 0 && (
          <QuoteFacadeEditor
            facades={formData.facadeInputs}
            facadeWidths_m={areaEstimate?.facadeWidths_m}
            numBuildings={numBuildings}
            onChange={handleFacadesChange}
          />
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-2 gap-3">
        <button onClick={onBack}
          className="flex-1 sm:flex-none px-6 py-3 sm:py-2.5 border border-zinc-300 text-zinc-700 rounded-lg hover:bg-zinc-50 transition-colors">
          上一步
        </button>
        <button onClick={onNext} disabled={!areaEstimate}
          className="flex-1 sm:flex-none px-6 py-3 sm:py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-zinc-300 disabled:text-zinc-500 transition-colors font-medium">
          產生報價
        </button>
      </div>
    </div>
  )
}
