"use client"

import { useState, useCallback } from "react"
import type { AirspaceResult } from "@/lib/types"
import type { QuoteFormData, BuildingDimensions } from "./quote-defaults"
import { SERVICE_OPTIONS, getWeatherRisk } from "./quote-defaults"
import { calcPolygonPerimeter } from "./quote-defaults"
import { QuoteMap } from "./QuoteMap"

interface Props {
  formData: Partial<QuoteFormData>
  updateForm: (patch: Partial<QuoteFormData>) => void
  airspace: AirspaceResult | null
  setAirspace: (a: AirspaceResult | null) => void
  setBuildingPerimeter: (p: number | null) => void
  setBuildingPolygon: (p: { lat: number; lon: number }[] | null) => void
  setBuildingDimensions: (d: BuildingDimensions | null) => void
  setBuildingName: (n: string | null) => void
  buildingName: string | null
  onNext: () => void
}

// ─── DMS / decimal coordinate parser ─────────────────────────────────────────
// Accepts:
//   DMS:     25°02'21.1"N 121°33'45.4"E
//   Decimal: 25.039194, 121.562611

function parseCoordinates(raw: string): { lat: number; lng: number } | null {
  const s = raw.trim()

  // DMS: 25°02'21.1"N 121°33'45.4"E  (° ' " optional variants)
  const dms = s.match(
    /(\d+)[°º]\s*(\d+)[''′]\s*([\d.]+)[""″]?\s*([NS])\s+(\d+)[°º]\s*(\d+)[''′]\s*([\d.]+)[""″]?\s*([EW])/i
  )
  if (dms) {
    const lat = (parseInt(dms[1]) + parseInt(dms[2]) / 60 + parseFloat(dms[3]) / 3600)
      * (dms[4].toUpperCase() === "S" ? -1 : 1)
    const lng = (parseInt(dms[5]) + parseInt(dms[6]) / 60 + parseFloat(dms[7]) / 3600)
      * (dms[8].toUpperCase() === "W" ? -1 : 1)
    if (isFinite(lat) && isFinite(lng)) return { lat, lng }
  }

  // Decimal: "25.039194, 121.562611" or "25.039194 121.562611"
  const dec = s.match(/^([-\d.]+)[,\s]+([-\d.]+)$/)
  if (dec) {
    const a = parseFloat(dec[1]), b = parseFloat(dec[2])
    if (isFinite(a) && isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180) {
      return { lat: a, lng: b }
    }
  }
  return null
}

export function QuoteStep1({
  formData, updateForm, airspace, setAirspace,
  setBuildingPerimeter, setBuildingPolygon, setBuildingDimensions,
  setBuildingName, buildingName, onNext,
}: Props) {
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeError, setGeocodeError] = useState("")
  const [searchInput, setSearchInput] = useState(formData.address ?? "")
  const [coordInput, setCoordInput] = useState("")
  const [coordError, setCoordError] = useState("")
  const [posUpdating, setPosUpdating] = useState(false)
  const [locating, setLocating] = useState(false)

  // ── Re-fetch airspace + Overpass for any lat/lng ──────────────────────────
  const refetchForPosition = useCallback(async (lat: number, lng: number) => {
    setPosUpdating(true)
    try {
      const [airRes, ovRes] = await Promise.all([
        fetch(`/api/airspace/query?lat=${lat}&lng=${lng}`),
        fetch(`/api/overpass?lat=${lat}&lng=${lng}`),
      ])
      setAirspace(await airRes.json())

      const ov = await ovRes.json()
      if (ov.status === "found" && ov.geometry) {
        setBuildingPerimeter(calcPolygonPerimeter(ov.geometry))
        setBuildingPolygon(ov.geometry)
        if (ov.dimensions) setBuildingDimensions(ov.dimensions)
        if (ov.name) setBuildingName(ov.name)
      } else {
        // Cleared — no building polygon found at new position
        setBuildingPerimeter(null)
        setBuildingPolygon(null)
        setBuildingDimensions(null)
      }
    } catch { /* non-critical */ }
    finally { setPosUpdating(false) }
  }, [setAirspace, setBuildingPerimeter, setBuildingPolygon, setBuildingDimensions, setBuildingName])

  // ── Called by draggable marker or map click ───────────────────────────────
  const handlePositionChange = useCallback((lat: number, lng: number) => {
    updateForm({ lat, lng })
    refetchForPosition(lat, lng)
  }, [updateForm, refetchForPosition])

  // ── Address / name geocode (auto-detect mode on backend) ──────────────────
  const handleGeocode = useCallback(async () => {
    if (!searchInput.trim() || searchInput.trim().length < 2) return
    setGeocoding(true)
    setGeocodeError("")
    setAirspace(null)
    setBuildingPerimeter(null)
    setBuildingPolygon(null)
    setBuildingDimensions(null)
    setBuildingName(null)

    try {
      const geoRes = await fetch(
        `/api/geocode?q=${encodeURIComponent(searchInput)}`
      )
      const geo = await geoRes.json()
      if (geo.status !== "success") {
        setGeocodeError(geo.reason ?? "找不到此地址或建案名稱")
        setGeocoding(false)
        return
      }

      updateForm({ address: searchInput, lat: geo.lat, lng: geo.lng })
      if (geo.displayName) setBuildingName(geo.displayName)
      await refetchForPosition(geo.lat, geo.lng)
    } catch {
      setGeocodeError("網路錯誤，請稍後再試")
    } finally {
      setGeocoding(false)
    }
  }, [searchInput, updateForm, setBuildingName, refetchForPosition, setAirspace, setBuildingPerimeter, setBuildingPolygon, setBuildingDimensions])

  // ── My location (GPS) ────────────────────────────────────────────────────
  const handleMyLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      setGeocodeError("您的瀏覽器不支援定位功能")
      return
    }
    setLocating(true)
    setGeocodeError("")
    setAirspace(null)
    setBuildingPerimeter(null)
    setBuildingPolygon(null)
    setBuildingDimensions(null)
    setBuildingName(null)

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        if (lat < 21 || lat > 26 || lng < 118 || lng > 123) {
          setGeocodeError("目前位置不在台灣範圍內")
          setLocating(false)
          return
        }
        updateForm({ lat, lng, address: `${lat.toFixed(6)}, ${lng.toFixed(6)}` })
        setSearchInput(`${lat.toFixed(6)}, ${lng.toFixed(6)}`)
        await refetchForPosition(lat, lng)
        setLocating(false)
      },
      (err) => {
        setLocating(false)
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setGeocodeError("定位權限被拒絕，請在瀏覽器設定中允許存取位置")
            break
          case err.POSITION_UNAVAILABLE:
            setGeocodeError("無法取得位置資訊")
            break
          case err.TIMEOUT:
            setGeocodeError("定位逾時，請稍後再試")
            break
          default:
            setGeocodeError("定位失敗，請稍後再試")
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }, [updateForm, refetchForPosition, setAirspace, setBuildingPerimeter, setBuildingPolygon, setBuildingDimensions, setBuildingName])

  // ── Manual coordinate input ───────────────────────────────────────────────
  const handleCoordApply = useCallback(() => {
    setCoordError("")
    const parsed = parseCoordinates(coordInput)
    if (!parsed) {
      setCoordError("格式不正確，請輸入「25.039194, 121.562611」或「25°02′21.1″N 121°33′45.4″E」")
      return
    }
    if (parsed.lat < 21 || parsed.lat > 26 || parsed.lng < 118 || parsed.lng > 123) {
      setCoordError("座標不在台灣範圍內")
      return
    }
    updateForm({ lat: parsed.lat, lng: parsed.lng })
    refetchForPosition(parsed.lat, parsed.lng)
    setCoordInput("")
  }, [coordInput, updateForm, refetchForPosition])

  const isNoFly = airspace?.status === "NoFly"
  const canProceed = formData.lat && formData.lng && formData.clientName && !isNoFly

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-zinc-900">Step 1 — 基本資訊</h2>

      {/* Client name */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">客戶名稱</label>
        <input
          type="text"
          value={formData.clientName ?? ""}
          onChange={e => updateForm({ clientName: e.target.value })}
          placeholder="例：遠雄建設"
          className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>

      {/* Search input — auto-detect address vs building name */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">地址或建案名稱</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleGeocode()}
            placeholder="例：台北市信義區松仁路100號、台北101"
            className="flex-1 px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <button onClick={handleGeocode}
            disabled={geocoding || locating || searchInput.trim().length < 2}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-zinc-300 transition-colors whitespace-nowrap">
            {geocoding ? "定位中..." : "搜尋"}
          </button>
        </div>

        {/* My location button */}
        <button
          type="button"
          onClick={handleMyLocation}
          disabled={locating || geocoding}
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:text-zinc-400 disabled:border-zinc-200 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0ZM10 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" clipRule="evenodd" />
          </svg>
          {locating ? "定位中..." : "使用我的位置"}
        </button>

        {geocodeError && <p className="text-red-500 text-sm mt-1">{geocodeError}</p>}

        {/* Position confirmed */}
        {formData.lat && formData.lng && (
          <div className="mt-1 space-y-0.5">
            <div className="flex items-center gap-2">
              <p className="text-green-600 text-sm">
                已定位：{formData.lat.toFixed(5)}, {formData.lng.toFixed(5)}
              </p>
              {posUpdating && (
                <span className="text-xs text-zinc-400">重新查詢中...</span>
              )}
            </div>
            {buildingName && (
              <p className="text-blue-700 text-sm font-medium">識別建物：{buildingName}</p>
            )}
          </div>
        )}
      </div>

      {/* Map with draggable marker + correction panel */}
      {formData.lat && formData.lng && (
        <div className="space-y-3">
          <QuoteMap
            lat={formData.lat} lng={formData.lng}
            airspace={airspace}
            onPositionChange={handlePositionChange}
          />

          {/* Always-visible correction panel */}
          <PositionCorrectionPanel
            coordInput={coordInput}
            coordError={coordError}
            posUpdating={posUpdating}
            onInputChange={setCoordInput}
            onApply={handleCoordApply}
          />
        </div>
      )}

      {/* Airspace status */}
      {airspace && (
        <div className={`p-4 rounded-lg border ${
          isNoFly ? "bg-red-50 border-red-200" :
          airspace.status === "NeedPermit" ? "bg-yellow-50 border-yellow-200" :
          "bg-green-50 border-green-200"
        }`}>
          <div className="flex items-center gap-2">
            <span className="text-lg">
              {isNoFly ? "🚫" : airspace.status === "NeedPermit" ? "⚠️" : "✅"}
            </span>
            <span className="font-medium">
              {isNoFly ? "禁飛區 — 無法作業" :
               airspace.status === "NeedPermit"
                 ? `需申請空域許可（額外 ${airspace.admin_days_added} 天行政流程）`
                 : "空域狀態正常，可直接作業"}
            </span>
          </div>
          {airspace.reason && <p className="text-sm text-zinc-600 mt-1">{airspace.reason}</p>}
        </div>
      )}

      {/* Service type */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">服務項目</label>
        <select value={formData.serviceType ?? "cleaning"}
          onChange={e => updateForm({ serviceType: e.target.value as QuoteFormData["serviceType"] })}
          className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
          {SERVICE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Expected date + weather risk */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">預計施工日期</label>
        <input type="date"
          value={formData.expectedDate ?? ""}
          min={new Date().toISOString().split("T")[0]}
          onChange={e => {
            const dateStr = e.target.value
            if (!dateStr) { updateForm({ expectedDate: "" }); return }
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const selected = new Date(dateStr)
            const diffDays = Math.ceil((selected.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
            updateForm({ expectedDate: dateStr, urgent: diffDays <= 30 })
          }}
          className="w-full sm:w-auto px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
        />
        {/* Urgent auto-set notice */}
        {formData.expectedDate && (() => {
          const today = new Date(); today.setHours(0, 0, 0, 0)
          const diff = Math.ceil((new Date(formData.expectedDate).getTime() - today.getTime()) / 86400000)
          if (diff <= 30 && diff >= 0) return (
            <p className="text-orange-600 text-xs mt-1">
              ⚡ 施工日期在 30 日內（{diff} 天後），已自動標記為急件
            </p>
          )
          return null
        })()}
        {/* Airspace permit + insufficient lead time warning */}
        {airspace?.status === "NeedPermit" && formData.expectedDate && (() => {
          const today = new Date(); today.setHours(0, 0, 0, 0)
          const diff = Math.ceil((new Date(formData.expectedDate).getTime() - today.getTime()) / 86400000)
          if (diff < 14) return (
            <div className="mt-2 p-3 rounded-lg border bg-red-50 border-red-200 text-red-700 text-xs">
              🚨 空域申請需至少提前 <strong>兩週（14 天）</strong>辦理，目前距施工日僅 <strong>{diff} 天</strong>，請立即向主管機關申請空域許可，否則無法如期開工。
            </div>
          )
          return null
        })()}
        <WeatherRiskBadge date={formData.expectedDate} />
      </div>

      {/* Urgent */}
      <div className="flex items-center gap-2">
        <input type="checkbox" id="urgent"
          checked={formData.urgent ?? false}
          onChange={e => updateForm({ urgent: e.target.checked })}
          className="w-4 h-4 accent-blue-600"
        />
        <label htmlFor="urgent" className="text-sm text-zinc-700">
          急件（30 日內施作，加價 33%）
        </label>
      </div>

      {/* Next */}
      <div className="flex justify-end pt-4">
        <button onClick={onNext} disabled={!canProceed}
          className="w-full sm:w-auto px-6 py-3 sm:py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-zinc-300 disabled:text-zinc-500 transition-colors font-medium">
          下一步
        </button>
      </div>
    </div>
  )
}

// ─── Position correction panel ────────────────────────────────────────────────

function PositionCorrectionPanel({
  coordInput, coordError, posUpdating, onInputChange, onApply,
}: {
  coordInput: string
  coordError: string
  posUpdating: boolean
  onInputChange: (v: string) => void
  onApply: () => void
}) {
  return (
    <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-amber-600 text-sm font-semibold">📍 位置不正確？</span>
        {posUpdating && <span className="text-xs text-zinc-400">重新查詢中...</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-amber-800">
        {/* Method 1: drag */}
        <div className="bg-white rounded-lg border border-amber-200 p-3 space-y-1">
          <p className="font-semibold text-amber-700">方法 1 — 在地圖上直接修正</p>
          <p>在上方地圖上<strong>點選正確位置</strong>，或<strong>拖動藍色標記</strong>至建物正確位置</p>
        </div>

        {/* Method 2: Google Maps */}
        <div className="bg-white rounded-lg border border-amber-200 p-3 space-y-1">
          <p className="font-semibold text-amber-700">方法 2 — 從 Google 地圖複製座標</p>
          <ol className="space-y-0.5 list-decimal list-inside">
            <li>開啟 Google 地圖搜尋建物地址</li>
            <li>在建物位置上<strong>右鍵</strong>點選</li>
            <li>點選跳出選單最上方的<strong>座標數字</strong>（即可複製）</li>
            <li>將座標貼入下方欄位後按「套用」</li>
          </ol>
        </div>
      </div>

      {/* Coordinate paste input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={coordInput}
          onChange={e => onInputChange(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onApply()}
          placeholder="25.039194, 121.562611 ｜ 或 DMS：25°02′21.1″N 121°33′45.4″E"
          className="flex-1 px-3 py-2 text-sm border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none font-mono bg-white"
        />
        <button
          type="button"
          onClick={onApply}
          disabled={!coordInput.trim()}
          className="px-4 py-2 bg-amber-500 text-white text-sm rounded-lg hover:bg-amber-600 disabled:bg-zinc-300 transition-colors whitespace-nowrap font-medium"
        >
          套用座標
        </button>
      </div>
      {coordError && <p className="text-red-600 text-xs">{coordError}</p>}
    </div>
  )
}

// ─── Weather risk badge ───────────────────────────────────────────────────────

const RISK_STYLES: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  low:    { bg: "bg-green-50", border: "border-green-200", text: "text-green-800", badge: "bg-green-100 text-green-700" },
  medium: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", badge: "bg-amber-100 text-amber-700" },
  high:   { bg: "bg-red-50",   border: "border-red-200",   text: "text-red-800",   badge: "bg-red-100   text-red-700"   },
}
const RISK_LABELS: Record<string, string> = { low: "低風險", medium: "中度風險", high: "高風險" }

function WeatherRiskBadge({ date }: { date?: string }) {
  const risk = getWeatherRisk(date)
  const s = RISK_STYLES[risk.level]
  return (
    <div className={`mt-2 p-3 rounded-lg border ${s.bg} ${s.border}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span>{risk.icon}</span>
        <span className={`text-sm font-semibold ${s.text}`}>{risk.season}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.badge}`}>
          {RISK_LABELS[risk.level]}
        </span>
        {risk.bufferDays > 0 && (
          <span className="text-xs text-zinc-500 ml-auto">建議預留 +{risk.bufferDays} 天緩衝</span>
        )}
      </div>
      <ul className={`text-xs space-y-0.5 ${s.text} opacity-90`}>
        {risk.concerns.map(c => <li key={c}>• {c}</li>)}
      </ul>
      <p className={`text-xs mt-1.5 font-medium ${s.text}`}>{risk.advice}</p>
    </div>
  )
}
