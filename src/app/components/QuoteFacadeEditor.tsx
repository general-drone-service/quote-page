"use client"

import { useState, useEffect, useRef } from "react"
import type { Complexity, Supply } from "@/lib/types"
import type { QuoteFacadeInput, DirtType, PowerVoltage } from "./quote-defaults"
import { DIRT_TYPE_OPTIONS, COMPLEXITY_OPTIONS } from "./quote-defaults"

const BUILDING_LABELS = ["A", "B", "C", "D", "E", "F"]

interface Props {
  facades: QuoteFacadeInput[]
  facadeWidths_m?: number[]    // per-facade actual widths from MBR (per building)
  numBuildings?: number        // for tab-based grouping
  dark?: boolean               // dark-theme mode (for LARM wizard)
  onChange: (facades: QuoteFacadeInput[]) => void
}

export function QuoteFacadeEditor({ facades, facadeWidths_m, numBuildings = 1, dark = false, onChange }: Props) {
  const [activeTab, setActiveTab] = useState(0)

  // Reset tab if numBuildings shrinks below active tab
  useEffect(() => {
    if (activeTab >= numBuildings) setActiveTab(0)
  }, [numBuildings, activeTab])

  function update(index: number, patch: Partial<QuoteFacadeInput>) {
    onChange(facades.map((f, i) => i === index ? { ...f, ...patch } : f))
  }

  function toggleDirt(index: number, type: DirtType) {
    const current = facades[index].dirtTypes
    const next = current.includes(type) ? current.filter(d => d !== type) : [...current, type]
    if (next.length === 0) return
    update(index, { dirtTypes: next })
  }

  function handlePhotos(index: number, field: "photos" | "supplyPhotos", files: FileList | null) {
    if (!files) return
    const existing = facades[index][field]
    const added = Array.from(files).map(f => ({ name: f.name, url: URL.createObjectURL(f) }))
    update(index, { [field]: [...existing, ...added] })
  }

  function removePhoto(facadeIndex: number, field: "photos" | "supplyPhotos", photoIndex: number) {
    const photos = facades[facadeIndex][field].filter((_, i) => i !== photoIndex)
    update(facadeIndex, { [field]: photos })
  }

  function handlePowerChange(index: number, supply: Supply, voltages: PowerVoltage[]) {
    update(index, { powerSupply: supply, powerVoltage: voltages })
  }

  // Group facades by buildingIndex (supports variable face counts per building)
  const facadesByBuilding: Map<number, { facades: QuoteFacadeInput[]; globalIndices: number[] }> = new Map()
  facades.forEach((f, i) => {
    const group = facadesByBuilding.get(f.buildingIndex) ?? { facades: [], globalIndices: [] }
    group.facades.push(f)
    group.globalIndices.push(i)
    facadesByBuilding.set(f.buildingIndex, group)
  })
  const buildingKeys = Array.from(facadesByBuilding.keys()).sort((a, b) => a - b)

  // Build building labels list (one per building)
  const buildingTabLabels: string[] = buildingKeys.map(bIdx => {
    if (numBuildings === 1) return ""
    const group = facadesByBuilding.get(bIdx)!
    const labelFromFacade = group.facades[0]?.buildingLabel
    return (labelFromFacade && labelFromFacade.trim() !== "")
      ? labelFromFacade
      : (BUILDING_LABELS[bIdx] ?? String(bIdx + 1))
  })

  // Facades for the currently active building
  const activeKey = buildingKeys[activeTab] ?? 0
  const activeGroup = facadesByBuilding.get(activeKey) ?? { facades: [], globalIndices: [] }
  const activeBuildingFacades = activeGroup.facades

  // ── Theme tokens ──────────────────────────────────────────────────────────
  const t = dark ? {
    heading:       "text-zinc-100",
    tabBorder:     "border-zinc-700",
    tabActive:     "border-sky-500 text-sky-400 bg-zinc-800/50",
    tabInactive:   "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800",
  } : {
    heading:       "text-zinc-800",
    tabBorder:     "border-zinc-200",
    tabActive:     "border-blue-600 text-blue-600 bg-blue-50",
    tabInactive:   "border-transparent text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50",
  }

  return (
    <div className="space-y-4">
      <h3 className={`text-base font-semibold ${t.heading}`}>各立面詳細資訊</h3>

      {/* Building tabs — only show when multiple buildings */}
      {numBuildings > 1 && (
        <div className={`flex gap-1 border-b ${t.tabBorder} overflow-x-auto scrollbar-thin`}>
          {buildingTabLabels.map((label, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setActiveTab(idx)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                activeTab === idx ? t.tabActive : t.tabInactive
              }`}
            >
              棟 {label}
              <span className="text-xs opacity-70 ml-1">
                ({(facadesByBuilding.get(buildingKeys[idx])?.facades.length ?? 0)}面)
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Facades for active building */}
      <div className="space-y-4">
        {activeBuildingFacades.map((facade, j) => {
          const globalIndex = activeGroup.globalIndices[j]
          return (
            <FacadeCard
              key={facade.id}
              facade={facade}
              width_m={facadeWidths_m?.[j]}
              dark={dark}
              onToggleDirt={(type) => toggleDirt(globalIndex, type)}
              onComplexity={(c) => update(globalIndex, { complexity: c })}
              onToggleRecesses={() => update(globalIndex, { hasRecesses: !facade.hasRecesses })}
              onToggleHighRisk={() => update(globalIndex, { isHighRisk: !facade.isHighRisk })}
              onToggleAdjacentTrees={() => update(globalIndex, {
                hasAdjacentTrees: !facade.hasAdjacentTrees,
                treeFloors: facade.hasAdjacentTrees ? 0 : facade.treeFloors,
              })}
              onTreeFloorsChange={(n) => update(globalIndex, { treeFloors: n })}
              onCleanTreeFloorsChange={(v) => update(globalIndex, { cleanTreeFloors: v })}
              onWaterSupply={(v) => update(globalIndex, { waterSupply: v })}
              onPowerChange={(supply, voltages) => handlePowerChange(globalIndex, supply, voltages)}
              onPhotoUpload={(f) => handlePhotos(globalIndex, "photos", f)}
              onSupplyPhotoUpload={(f) => handlePhotos(globalIndex, "supplyPhotos", f)}
              onRemovePhoto={(pi) => removePhoto(globalIndex, "photos", pi)}
              onRemoveSupplyPhoto={(pi) => removePhoto(globalIndex, "supplyPhotos", pi)}
            />
          )
        })}
      </div>
    </div>
  )
}

// ─── Single facade card ───────────────────────────────────────────────────────

interface CardProps {
  facade: QuoteFacadeInput
  width_m?: number
  dark?: boolean
  onToggleDirt: (type: DirtType) => void
  onComplexity: (c: Complexity) => void
  onToggleRecesses: () => void
  onToggleHighRisk: () => void
  onToggleAdjacentTrees: () => void
  onTreeFloorsChange: (n: number) => void
  onCleanTreeFloorsChange: (v: boolean) => void
  onWaterSupply: (v: Supply) => void
  onPowerChange: (supply: Supply, voltages: PowerVoltage[]) => void
  onPhotoUpload: (files: FileList | null) => void
  onSupplyPhotoUpload: (files: FileList | null) => void
  onRemovePhoto: (index: number) => void
  onRemoveSupplyPhoto: (index: number) => void
}

function FacadeCard({
  facade, width_m, dark = false,
  onToggleDirt, onComplexity, onToggleRecesses, onToggleHighRisk,
  onToggleAdjacentTrees, onTreeFloorsChange, onCleanTreeFloorsChange,
  onWaterSupply, onPowerChange,
  onPhotoUpload, onSupplyPhotoUpload,
  onRemovePhoto, onRemoveSupplyPhoto,
}: CardProps) {
  const photoRef = useRef<HTMLInputElement>(null)
  const supplyPhotoRef = useRef<HTMLInputElement>(null)

  // ── Theme tokens ────────────────────────────────────────────────────────────
  const t = dark ? {
    card:        "border-zinc-700 bg-zinc-800/40",
    badgeBg:     "bg-sky-500 text-white",
    badgeWidth:  "bg-sky-900/50 text-sky-300",
    heading:     "text-zinc-400",
    label:       "text-zinc-300",
    subLabel:    "text-zinc-400",
    note:        "text-zinc-500",
    check:       "accent-sky-500",
    checkGreen:  "accent-emerald-500",
    treeBorder:  "border-emerald-800",
    treeInput:   "border-zinc-600 text-zinc-200 bg-zinc-800 focus:ring-emerald-600",
    btnOff:      "bg-zinc-800 text-zinc-300 border-zinc-600 hover:border-zinc-400",
    btnOn:       "bg-sky-600 text-white border-sky-600",
    btnCompOff:  "bg-zinc-800 text-zinc-300 border-zinc-600 hover:border-zinc-400",
    btnCompOn:   "bg-zinc-600 text-white border-zinc-600",
    dirtOff:     "bg-zinc-800 text-zinc-300 border-zinc-600 hover:border-sky-500",
    dirtOn:      "bg-sky-600 text-white border-sky-600",
    warnText:    "text-amber-400",
  } : {
    card:        "border-zinc-200 bg-zinc-50",
    badgeBg:     "bg-blue-600 text-white",
    badgeWidth:  "bg-blue-100 text-blue-700",
    heading:     "text-zinc-500",
    label:       "text-zinc-700",
    subLabel:    "text-zinc-400",
    note:        "text-zinc-400",
    check:       "accent-blue-600",
    checkGreen:  "accent-green-600",
    treeBorder:  "border-green-200",
    treeInput:   "border-zinc-300 text-zinc-700 bg-white focus:ring-green-500",
    btnOff:      "bg-white text-zinc-600 border-zinc-300 hover:border-blue-400",
    btnOn:       "bg-blue-600 text-white border-blue-600",
    btnCompOff:  "bg-white text-zinc-600 border-zinc-300 hover:border-zinc-500",
    btnCompOn:   "bg-zinc-800 text-white border-zinc-800",
    dirtOff:     "bg-white text-zinc-600 border-zinc-300 hover:border-blue-400",
    dirtOn:      "bg-blue-600 text-white border-blue-600",
    warnText:    "text-amber-600",
  }

  return (
    <div className={`border rounded-xl p-4 space-y-4 ${t.card}`}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className={`px-2 h-7 rounded-lg text-sm font-bold flex items-center justify-center ${t.badgeBg}`}>
          {facade.buildingLabel ? `${facade.buildingLabel}棟-${facade.label}` : facade.label}
        </span>
        {width_m != null && (
          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${t.badgeWidth}`}>
            實測 {width_m} m
          </span>
        )}
      </div>

      {/* Dirt types */}
      <div>
        <p className={`text-xs font-medium mb-2 ${t.heading}`}>髒汙類型（可多選）</p>
        <div className="flex flex-wrap gap-2">
          {DIRT_TYPE_OPTIONS.map(opt => {
            const active = facade.dirtTypes.includes(opt.value)
            return (
              <button key={opt.value} type="button" onClick={() => onToggleDirt(opt.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  active ? t.dirtOn : t.dirtOff
                }`}>
                <span>{opt.emoji}</span><span>{opt.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Complexity */}
      <div>
        <p className={`text-xs font-medium mb-2 ${t.heading}`}>立面複雜程度</p>
        <div className="flex gap-2">
          {COMPLEXITY_OPTIONS.map(opt => (
            <button key={opt.value} type="button" onClick={() => onComplexity(opt.value)}
              title={opt.desc}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                facade.complexity === opt.value ? t.btnCompOn : t.btnCompOff
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
        <p className={`text-xs mt-1 ${t.note}`}>
          {COMPLEXITY_OPTIONS.find(o => o.value === facade.complexity)?.desc}
        </p>
      </div>

      {/* Special conditions */}
      <div>
        <p className={`text-xs font-medium mb-2 ${t.heading}`}>特殊狀況</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={facade.hasRecesses} onChange={onToggleRecesses}
              className={`w-4 h-4 ${t.check}`} />
            <span className={`text-sm ${t.label}`}>有內縮 / 露台 / 天井</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={facade.isHighRisk} onChange={onToggleHighRisk}
              className={`w-4 h-4 ${t.check}`} />
            <span className={`text-sm ${t.label}`}>緊鄰特殊風險環境</span>
            <span className={`text-xs ${t.subLabel}`}>（電線 / 交通要道）</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={facade.hasAdjacentTrees} onChange={onToggleAdjacentTrees}
              className={`w-4 h-4 ${t.checkGreen}`} />
            <span className={`text-sm ${t.label}`}>鄰樹</span>
          </label>
          {facade.hasAdjacentTrees && (
            <div className={`ml-6 space-y-2 border-l-2 pl-3 ${t.treeBorder}`}>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${t.subLabel}`}>樹木遮蔽樓層數：</span>
                <input
                  type="number"
                  value={facade.treeFloors}
                  min={0}
                  max={facade.hasAdjacentTrees ? 999 : 0}
                  onChange={e => onTreeFloorsChange(Math.max(0, parseInt(e.target.value) || 0))}
                  className={`w-16 px-2 py-1 border rounded text-sm text-center outline-none focus:ring-1 ${t.treeInput}`}
                />
                <span className={`text-xs ${t.subLabel}`}>F</span>
              </div>
              {facade.treeFloors > 0 && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={facade.cleanTreeFloors}
                    onChange={e => onCleanTreeFloorsChange(e.target.checked)}
                    className={`w-3.5 h-3.5 ${t.checkGreen}`}
                  />
                  <span className={`text-xs ${t.label}`}>
                    清洗樹遮樓層
                  </span>
                  {!facade.cleanTreeFloors && (
                    <span className={`text-xs ${t.warnText}`}>不計入清洗範圍</span>
                  )}
                </label>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Water / Power supply per facade */}
      <div className="grid grid-cols-2 gap-3">
        <SupplyField
          icon="💧"
          label="用水"
          value={facade.waterSupply}
          dark={dark}
          onChange={onWaterSupply}
        />
        <PowerVoltageField
          supply={facade.powerSupply}
          voltages={facade.powerVoltage ?? []}
          dark={dark}
          onChange={onPowerChange}
        />
      </div>

      {/* Supply access photos */}
      <div>
        <p className={`text-xs font-medium mb-2 ${t.heading}`}>水電接口現況照片（選填）</p>
        <PhotoStrip
          photos={facade.supplyPhotos}
          dark={dark}
          onAdd={() => supplyPhotoRef.current?.click()}
          onRemove={onRemoveSupplyPhoto}
        />
        <input ref={supplyPhotoRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e => onSupplyPhotoUpload(e.target.files)} />
      </div>

      {/* General facade photos */}
      <div>
        <p className={`text-xs font-medium mb-2 ${t.heading}`}>立面照片（選填）</p>
        <PhotoStrip
          photos={facade.photos}
          dark={dark}
          onAdd={() => photoRef.current?.click()}
          onRemove={onRemovePhoto}
        />
        <input ref={photoRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e => onPhotoUpload(e.target.files)} />
      </div>
    </div>
  )
}

// ─── Water supply field ───────────────────────────────────────────────────────

function SupplyField({
  icon, label, value, dark = false, onChange,
}: {
  icon: string; label: string; value: Supply; dark?: boolean; onChange: (v: Supply) => void
}) {
  const border = dark ? "border-zinc-600" : "border-zinc-300"
  const active  = dark ? "bg-sky-600 text-white" : "bg-blue-600 text-white"
  const inactive = dark ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" : "bg-white text-zinc-600 hover:bg-zinc-50"
  const lbl = dark ? "text-zinc-400" : "text-zinc-500"

  return (
    <div>
      <p className={`text-xs mb-1.5 ${lbl}`}>{icon} {label}</p>
      <div className={`flex rounded-lg border overflow-hidden text-xs ${border}`}>
        {(["Provided", "SelfSupply"] as Supply[]).map(opt => (
          <button key={opt} type="button" onClick={() => onChange(opt)}
            className={`flex-1 py-2 text-center transition-colors ${
              value === opt ? active : inactive
            }`}>
            {opt === "Provided" ? "業主提供" : "自備"}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Power voltage field (110V / 220V checkboxes) ────────────────────────────

function PowerVoltageField({
  supply, voltages, dark = false, onChange,
}: {
  supply: Supply
  voltages: PowerVoltage[]
  dark?: boolean
  onChange: (supply: Supply, voltages: PowerVoltage[]) => void
}) {
  const lbl      = dark ? "text-zinc-400" : "text-zinc-500"
  const vBtnOn   = dark ? "bg-sky-600 text-white border-sky-600" : "bg-blue-600 text-white border-blue-600"
  const vBtnDis  = dark ? "bg-zinc-700 text-zinc-500 border-zinc-600 cursor-not-allowed" : "bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed"
  const vBtnOff  = dark ? "bg-zinc-800 text-zinc-300 border-zinc-600 hover:border-sky-400" : "bg-white text-zinc-600 border-zinc-300 hover:border-blue-400"
  const selfChk  = dark ? "accent-orange-400" : "accent-orange-500"
  const selfLbl  = dark ? "text-zinc-400" : "text-zinc-500"

  function toggleVoltage(v: PowerVoltage) {
    if (supply === "SelfSupply") {
      onChange("Provided", [v])
      return
    }
    const next = voltages.includes(v) ? voltages.filter(x => x !== v) : [...voltages, v]
    onChange("Provided", next)
  }

  function toggleSelfSupply() {
    if (supply === "SelfSupply") {
      onChange("Provided", ["110V", "220V"])
    } else {
      onChange("SelfSupply", [])
    }
  }

  return (
    <div>
      <p className={`text-xs mb-1.5 ${lbl}`}>⚡ 用電</p>
      <div className="space-y-2">
        {/* Voltage checkboxes */}
        <div className="flex gap-2">
          {(["110V", "220V"] as PowerVoltage[]).map(v => {
            const checked = supply !== "SelfSupply" && voltages.includes(v)
            return (
              <button
                key={v}
                type="button"
                onClick={() => toggleVoltage(v)}
                className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  checked ? vBtnOn : supply === "SelfSupply" ? vBtnDis : vBtnOff
                }`}
              >
                {v}
              </button>
            )
          })}
        </div>
        {/* Self-supply toggle */}
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={supply === "SelfSupply"}
            onChange={toggleSelfSupply}
            className={`w-3.5 h-3.5 ${selfChk}`}
          />
          <span className={`text-xs ${selfLbl}`}>自備電源</span>
        </label>
      </div>
    </div>
  )
}

// ─── Photo strip ─────────────────────────────────────────────────────────────

function PhotoStrip({
  photos, dark = false, onAdd, onRemove,
}: {
  photos: { name: string; url: string }[]
  dark?: boolean
  onAdd: () => void
  onRemove: (i: number) => void
}) {
  const border  = dark ? "border-zinc-600" : "border-zinc-200"
  const addBorder = dark ? "border-zinc-600 hover:border-sky-400 text-zinc-500 hover:text-sky-400" : "border-zinc-300 hover:border-blue-400 text-zinc-400 hover:text-blue-500"

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {photos.map((photo, i) => (
        <div key={i} className="relative group w-16 h-16">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt={photo.name}
            className={`w-full h-full object-cover rounded-lg border ${border}`} />
          <button type="button" onClick={() => onRemove(i)}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs hidden group-hover:flex items-center justify-center">
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={onAdd}
        className={`w-16 h-16 rounded-lg border-2 border-dashed flex flex-col items-center justify-center transition-colors ${addBorder}`}>
        <span className="text-xl leading-none">+</span>
        <span className="text-[10px] mt-0.5">上傳</span>
      </button>
    </div>
  )
}
