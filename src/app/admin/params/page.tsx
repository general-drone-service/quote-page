"use client"

import { useState, useEffect, useCallback } from "react"
import type { PricingParams } from "@/lib/engines/pricing-params"
import { PRICING_PARAMS_DEFAULT } from "@/lib/engines/pricing-params"

interface ParamVersion {
  version: string
  params: PricingParams
  notes: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
}

export default function PricingParamsAdmin() {
  const [versions, setVersions] = useState<ParamVersion[]>([])
  const [activeParams, setActiveParams] = useState<PricingParams>(PRICING_PARAMS_DEFAULT)
  const [activeVersion, setActiveVersion] = useState("v1.0")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── New version form ─────────────────────────────────────────────────────
  const [newVersion, setNewVersion] = useState("")
  const [newNotes, setNewNotes] = useState("")
  const [editParams, setEditParams] = useState("")
  const [saving, setSaving] = useState(false)

  const fetchParams = useCallback(async () => {
    try {
      const res = await fetch("/api/pricing-params")
      const data = await res.json()
      setActiveParams(data.params)
      setActiveVersion(data.version ?? data.params?.version ?? "v1.0")
      setEditParams(JSON.stringify(data.params, null, 2))

      // Fetch all versions
      const listRes = await fetch("/api/pricing-params/versions")
      if (listRes.ok) {
        const listData = await listRes.json()
        setVersions(listData.versions ?? [])
      }
    } catch {
      setError("無法載入參數")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchParams() }, [fetchParams])

  const handleSave = async () => {
    if (!newVersion.trim()) {
      setError("請輸入版本號")
      return
    }
    setSaving(true)
    setError(null)

    try {
      const params = JSON.parse(editParams) as PricingParams
      params.version = newVersion

      const res = await fetch("/api/pricing-params", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: newVersion,
          params,
          notes: newNotes || undefined,
          activate: true,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        setError((err as { error?: string }).error ?? "儲存失敗")
        return
      }

      setNewVersion("")
      setNewNotes("")
      fetchParams()
    } catch (err) {
      setError(err instanceof Error ? err.message : "JSON 格式錯誤")
    } finally {
      setSaving(false)
    }
  }

  const handleActivate = async (version: string) => {
    const res = await fetch("/api/pricing-params", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
    })
    if (res.ok) fetchParams()
  }

  if (loading) {
    return <div className="text-center py-12 text-zinc-500">載入中...</div>
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-zinc-900">報價參數管理</h2>
        <p className="text-sm text-zinc-500 mt-1">
          目前使用版本：<span className="font-mono font-medium text-blue-600">{activeVersion}</span>
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Version history */}
      {versions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-zinc-600 mb-3">版本歷史</h3>
          <div className="space-y-2">
            {versions.map(v => (
              <div key={v.version}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  v.is_active ? "border-blue-300 bg-blue-50" : "border-zinc-200"
                }`}>
                <div>
                  <span className="font-mono font-medium">{v.version}</span>
                  {v.is_active && (
                    <span className="ml-2 text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">
                      使用中
                    </span>
                  )}
                  {v.notes && <p className="text-xs text-zinc-500 mt-0.5">{v.notes}</p>}
                  <p className="text-xs text-zinc-400">
                    {new Date(v.created_at).toLocaleString("zh-TW")}
                    {v.created_by && ` · ${v.created_by}`}
                  </p>
                </div>
                {!v.is_active && (
                  <button
                    onClick={() => handleActivate(v.version)}
                    className="text-xs px-3 py-1.5 border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50"
                  >
                    啟用此版本
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-600">建立新版本</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-zinc-600 mb-1">版本號</label>
            <input
              type="text"
              value={newVersion}
              onChange={e => setNewVersion(e.target.value)}
              placeholder="例：v1.1"
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-zinc-600 mb-1">變更說明</label>
            <input
              type="text"
              value={newNotes}
              onChange={e => setNewNotes(e.target.value)}
              placeholder="例：調整商辦單價"
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm text-zinc-600 mb-1">參數 JSON</label>
          <textarea
            value={editParams}
            onChange={e => setEditParams(e.target.value)}
            rows={20}
            className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-xs font-mono"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !newVersion.trim()}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-zinc-300 font-medium"
        >
          {saving ? "儲存中..." : "儲存並啟用"}
        </button>
      </div>

      {/* Current params display */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-600 mb-3">目前生效參數一覽</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">

          <ParamCard title="基本費率 Basic rates">
            <div className="flex justify-between">
              <span className="text-zinc-500">日費率 daily_rate</span>
              <span className="font-medium">{activeParams.daily_rate.toLocaleString()} NTD/day</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">基礎面積 daily_base_area</span>
              <span className="font-medium">{activeParams.daily_base_area.toLocaleString()} m²/day</span>
            </div>
          </ParamCard>

          <ParamCard title="建物類型係數 building_type_coeff">
            {Object.entries(activeParams.building_type_coeff).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-zinc-500">{k}</span>
                <span className="font-medium">{v as number}</span>
              </div>
            ))}
          </ParamCard>

          <ParamCard title="樓高係數 height_coeff">
            {activeParams.height_coeff.map((row, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-zinc-500">≤{row.max_floor}F</span>
                <span className="font-medium">×{row.coeff}</span>
              </div>
            ))}
          </ParamCard>

          <ParamCard title="立面複雜度係數 complexity_coeff">
            {Object.entries(activeParams.complexity_coeff).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-zinc-500">{k}</span>
                <span className="font-medium">{v as number}</span>
              </div>
            ))}
          </ParamCard>

          <ParamCard title="污染係數 contamination_coeff">
            {Object.entries(activeParams.contamination_coeff).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-zinc-500">{k}</span>
                <span className="font-medium">{v as number}</span>
              </div>
            ))}
          </ParamCard>

          <ParamCard title="清潔劑係數 cleaning_agent_coeff">
            {Object.entries(activeParams.cleaning_agent_coeff).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-zinc-500">{k}</span>
                <span className="font-medium">{v as number}</span>
              </div>
            ))}
          </ParamCard>

          <ParamCard title="立面修正係數 facade_modifiers">
            {Object.entries(activeParams.facade_modifiers).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-zinc-500">{k}</span>
                <span className="font-medium">{v as number}</span>
              </div>
            ))}
          </ParamCard>

          <ParamCard title="場址修正 site_modifiers">
            <p className="text-xs text-zinc-400 uppercase tracking-wide mb-1">region_exposure</p>
            {Object.entries(activeParams.site_modifiers.region_exposure).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-zinc-500">{k}</span>
                <span className="font-medium">{v as number}</span>
              </div>
            ))}
            <p className="text-xs text-zinc-400 uppercase tracking-wide mt-2 mb-1">crowd_density</p>
            {Object.entries(activeParams.site_modifiers.crowd_density).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-zinc-500">{k}</span>
                <span className="font-medium">{v as number}</span>
              </div>
            ))}
            <div className="flex justify-between mt-2">
              <span className="text-zinc-500">near_base_station</span>
              <span className="font-medium">{activeParams.site_modifiers.near_base_station}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">wind_channel_effect</span>
              <span className="font-medium">{activeParams.site_modifiers.wind_channel_effect}</span>
            </div>
          </ParamCard>

          <ParamCard title="樓層加乘 floor_multiplier">
            {activeParams.floor_multiplier.map(f => (
              <div key={f.max_floor} className="flex justify-between">
                <span className="text-zinc-500">≤{f.max_floor}F</span>
                <span className="font-medium">×{f.multiplier}</span>
              </div>
            ))}
          </ParamCard>

          <ParamCard title="時段加乘 time_window_multiplier">
            {Object.entries(activeParams.time_window_multiplier).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-zinc-500">{k}</span>
                <span className="font-medium">×{v as number}</span>
              </div>
            ))}
          </ParamCard>

          <ParamCard title="其他 Other">
            <div className="flex justify-between">
              <span className="text-zinc-500">急件加乘 urgent_multiplier</span>
              <span className="font-medium">×{activeParams.urgent_multiplier}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">最低訂單 min_order</span>
              <span className="font-medium">{activeParams.min_order.toLocaleString()} NTD</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">加乘上限 quote_max_multiplier</span>
              <span className="font-medium">×{activeParams.quote_max_multiplier}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">最終折扣 final_discount</span>
              <span className="font-medium">×{activeParams.final_discount}</span>
            </div>
          </ParamCard>

          <ParamCard title="通勤起點 commute_origin">
            <div className="flex justify-between">
              <span className="text-zinc-500">lat</span>
              <span className="font-medium">{activeParams.commute_origin.lat}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">lng</span>
              <span className="font-medium">{activeParams.commute_origin.lng}</span>
            </div>
            <div className="text-zinc-500 text-xs mt-1 truncate">{activeParams.commute_origin.address}</div>
          </ParamCard>

          <ParamCard title="通勤計算 commute">
            <div className="flex justify-between">
              <span className="text-zinc-500">fee_per_hour</span>
              <span className="font-medium">{activeParams.commute.fee_per_hour.toLocaleString()} NTD</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">daily_fuel_fee</span>
              <span className="font-medium">{activeParams.commute.daily_fuel_fee.toLocaleString()} NTD</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">lodging_per_day</span>
              <span className="font-medium">{activeParams.commute.lodging_per_day.toLocaleString()} NTD</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">lodging_threshold_hours</span>
              <span className="font-medium">{activeParams.commute.lodging_threshold_hours} hrs</span>
            </div>
          </ParamCard>

        </div>
      </div>
    </div>
  )
}

function ParamCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-zinc-200 rounded-lg p-4 space-y-2">
      <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{title}</h4>
      {children}
    </div>
  )
}
