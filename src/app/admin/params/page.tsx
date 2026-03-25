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
          <ParamCard title="基礎單價（NTD/㎡）">
            {Object.entries(activeParams.base_price).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-zinc-500">{k}</span>
                <span className="font-medium">{v}</span>
              </div>
            ))}
          </ParamCard>

          <ParamCard title="樓層加乘">
            {activeParams.floor_multiplier.map(f => (
              <div key={f.max_floor} className="flex justify-between">
                <span className="text-zinc-500">≤{f.max_floor}F</span>
                <span className="font-medium">×{f.multiplier}</span>
              </div>
            ))}
          </ParamCard>

          <ParamCard title="時段加乘">
            {Object.entries(activeParams.time_window_multiplier).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-zinc-500">{k}</span>
                <span className="font-medium">×{v}</span>
              </div>
            ))}
          </ParamCard>

          <ParamCard title="其他">
            <div className="flex justify-between">
              <span className="text-zinc-500">急件加乘</span>
              <span className="font-medium">×{activeParams.urgent_multiplier}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">最低訂單</span>
              <span className="font-medium">{activeParams.min_order.toLocaleString()} NTD</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">加乘上限</span>
              <span className="font-medium">×{activeParams.quote_max_multiplier}</span>
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
