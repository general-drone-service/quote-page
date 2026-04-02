import { jsPDF } from "jspdf"
import fs from "node:fs"
import path from "node:path"
import type { PricingResult, TimeResult } from "@/lib/types"

// ─── Types for PDF generation input ─────────────────────────────────────────

export interface QuotePdfInput {
  pricing: PricingResult
  timeResult: TimeResult
  formData: {
    clientName: string
    address: string
    buildingType: string
    floors: number
    heightMode?: "floors" | "height"
    heightM?: number
    numBuildings?: number
    serviceType: string
    timeSlot: string
    expectedDate?: string
    urgent: boolean
  }
  areaEstimate: {
    source: string
    total_area_m2: number
    project_total_m2?: number
    num_facades: number
  }
  buildingName?: string
}

// ─── Labels ──────────────────────────────────────────────────────────────────

const BUILDING_LABELS: Record<string, string> = {
  commercial: "商辦大樓",
  luxury: "住宅社區",
  house: "透天厝",
  factory: "廠房",
  solar: "太陽能板",
}

const SOURCE_LABELS: Record<string, string> = {
  overpass: "地圖自動偵測",
  "manual-draw": "手動框選",
  default: "智慧預設值",
}

const FLOOR_MULT_LABELS: Record<string, string> = {
  "1": "無加價",
  "1.3": "11-20F",
  "2": "21-30F",
  "3": ">30F",
}

const MULT_KEY_LABELS: Record<string, string> = {
  floor: "高樓加價",
  time_window: "施工時段",
  urgent: "急件加價",
}

// ─── Font loading ────────────────────────────────────────────────────────────

// Cache font data across invocations, but always register with each new jsPDF doc
let cachedFontBase64: string | null = null

function loadCJKFont(doc: jsPDF) {
  if (!cachedFontBase64) {
    const fontPaths = [
      path.join(process.cwd(), "src/lib/pdf/fonts/NotoSansTC-Regular.ttf"),
      path.join(process.cwd(), "src/lib/line/fonts/NotoSansTC-Regular.ttf"),
      path.join(__dirname, "fonts/NotoSansTC-Regular.ttf"),
      path.join(__dirname, "../pdf/fonts/NotoSansTC-Regular.ttf"),
      path.join(__dirname, "../../lib/pdf/fonts/NotoSansTC-Regular.ttf"),
    ]

    let fontBuffer: Buffer | null = null
    for (const p of fontPaths) {
      try {
        fontBuffer = fs.readFileSync(p)
        console.log(`CJK font loaded from: ${p}`)
        break
      } catch {
        // Try next path
      }
    }

    if (!fontBuffer) {
      console.warn("CJK font not found, tried paths:", fontPaths)
      return
    }

    cachedFontBase64 = fontBuffer.toString("base64")
  }

  // Always register font with each new jsPDF instance
  doc.addFileToVFS("NotoSansTC-Regular.ttf", cachedFontBase64)
  doc.addFont("NotoSansTC-Regular.ttf", "NotoSansTC", "normal")
  doc.setFont("NotoSansTC")
}

// ─── PDF Generator ───────────────────────────────────────────────────────────

export function generateQuotePdf(input: QuotePdfInput): Buffer {
  const { pricing, timeResult, formData, areaEstimate, buildingName } = input
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 15
  const contentWidth = pageWidth - margin * 2
  let y = margin

  loadCJKFont(doc)

  // ── Helper functions ───────────────────────────────────────────────────────

  function setColor(hex: string) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    doc.setTextColor(r, g, b)
  }

  function drawLine(yPos: number, color = "#D4D4D8") {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    doc.setDrawColor(r, g, b)
    doc.setLineWidth(0.3)
    doc.line(margin, yPos, pageWidth - margin, yPos)
  }

  function checkPageBreak(needed: number) {
    const pageHeight = doc.internal.pageSize.getHeight()
    if (y + needed > pageHeight - margin) {
      doc.addPage()
      y = margin
    }
  }

  // ── Header ─────────────────────────────────────────────────────────────────

  doc.setFillColor(39, 39, 42) // zinc-800
  doc.rect(0, 0, pageWidth, 28, "F")

  doc.setFontSize(16)
  setColor("#FFFFFF")
  doc.text("GDS 低空作業 報價單", margin, 12)

  doc.setFontSize(9)
  setColor("#A1A1AA")
  doc.text("Quick Quote — 估算報價，正式報價以現場勘查為準", margin, 19)

  doc.setFontSize(10)
  setColor("#FFFFFF")
  doc.text(pricing.quote_code, pageWidth - margin, 12, { align: "right" })

  doc.setFontSize(8)
  setColor("#A1A1AA")
  doc.text(`有效至 ${pricing.valid_until}`, pageWidth - margin, 19, { align: "right" })

  y = 35

  // ── Info grid ──────────────────────────────────────────────────────────────

  doc.setFillColor(250, 250, 250) // zinc-50
  doc.rect(margin, y - 3, contentWidth, 38, "F")

  const numBuildings = formData.numBuildings ?? 1
  const totalArea = areaEstimate.project_total_m2 ?? areaEstimate.total_area_m2 * numBuildings

  const infoRows: [string, string][] = [
    ["客戶", formData.clientName || "—"],
    ["地址", formData.address || "—"],
  ]
  if (buildingName) infoRows.push(["建物名稱", buildingName])
  infoRows.push([
    "建物",
    formData.heightMode === "height" && formData.heightM
      ? `${BUILDING_LABELS[formData.buildingType] ?? formData.buildingType} ${formData.heightM}m（≈ ${Math.round(formData.heightM / 3.5)}F）`
      : `${BUILDING_LABELS[formData.buildingType] ?? formData.buildingType} ${formData.floors}F（${(formData.floors * 3.5).toFixed(1)}m）`,
  ])
  if (numBuildings > 1) infoRows.push(["棟數", `${numBuildings} 棟`])
  infoRows.push(
    ["施作總面積", `${totalArea.toLocaleString()} ㎡（${SOURCE_LABELS[areaEstimate.source] ?? areaEstimate.source}）`],
  )
  if (formData.expectedDate) infoRows.push(["預計施工日期", formData.expectedDate])

  doc.setFontSize(9)
  const colWidth = contentWidth / 2
  infoRows.forEach(([label, value], i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const xPos = margin + 3 + col * colWidth
    const yPos = y + row * 6

    setColor("#71717A") // zinc-500
    doc.text(`${label}：`, xPos, yPos)
    setColor("#18181B") // zinc-900
    doc.text(value, xPos + doc.getTextWidth(`${label}：`) + 1, yPos)
  })

  y += Math.ceil(infoRows.length / 2) * 6 + 5
  drawLine(y)
  y += 6

  // ── Line items table ───────────────────────────────────────────────────────

  checkPageBreak(40)
  doc.setFontSize(10)
  setColor("#52525B") // zinc-600
  doc.text("費用明細", margin, y)
  y += 6

  // Table header
  doc.setFontSize(8)
  setColor("#71717A")
  doc.text("項目", margin, y)
  doc.text("施作面積", margin + contentWidth * 0.45, y, { align: "right" })
  doc.text("單價", margin + contentWidth * 0.65, y, { align: "right" })
  doc.text("小計", margin + contentWidth, y, { align: "right" })
  y += 2
  drawLine(y)
  y += 5

  // Table rows
  doc.setFontSize(9)
  for (const item of pricing.line_items) {
    checkPageBreak(8)
    setColor("#18181B")
    doc.text(item.label.slice(0, 30), margin, y)

    setColor("#52525B")
    if (item.area_m2) {
      doc.text(`${item.area_m2.toLocaleString()} ㎡`, margin + contentWidth * 0.45, y, { align: "right" })
    } else {
      doc.text("—", margin + contentWidth * 0.45, y, { align: "right" })
    }

    if (item.unit_price) {
      doc.text(`${Math.round(item.unit_price)} NTD/㎡`, margin + contentWidth * 0.65, y, { align: "right" })
    } else {
      doc.text("—", margin + contentWidth * 0.65, y, { align: "right" })
    }

    setColor("#18181B")
    doc.text(`${item.subtotal.toLocaleString()} NTD`, margin + contentWidth, y, { align: "right" })
    y += 6
  }

  // Subtotal
  drawLine(y - 2)
  y += 3
  setColor("#71717A")
  doc.text("小計", margin + contentWidth * 0.65, y, { align: "right" })
  setColor("#18181B")
  doc.text(`${pricing.subtotal.toLocaleString()} NTD`, margin + contentWidth, y, { align: "right" })
  y += 8

  // ── Multipliers ────────────────────────────────────────────────────────────

  checkPageBreak(30)
  doc.setFillColor(250, 250, 250)
  const multHeight = Object.keys(pricing.multiplier_breakdown).length * 6 + 12
  doc.rect(margin, y - 3, contentWidth, multHeight, "F")

  doc.setFontSize(10)
  setColor("#52525B")
  doc.text("調整係數", margin + 3, y)
  y += 6

  doc.setFontSize(9)
  for (const [key, val] of Object.entries(pricing.multiplier_breakdown)) {
    const label = MULT_KEY_LABELS[key] ?? key
    const extra = key === "floor" ? `（${FLOOR_MULT_LABELS[String(val)] ?? ""}）` : ""
    setColor("#52525B")
    doc.text(`${label}${extra}`, margin + 3, y)

    if (val > 1) {
      setColor("#EA580C") // orange-600
    } else {
      setColor("#71717A")
    }
    doc.text(`× ${val.toFixed(2)}`, margin + contentWidth - 3, y, { align: "right" })
    y += 6
  }

  drawLine(y - 2, "#D4D4D8")
  y += 2
  setColor("#18181B")
  doc.setFont("NotoSansTC", "normal")
  doc.text("合計倍率", margin + 3, y)
  doc.text(`× ${pricing.multiplier.toFixed(2)}`, margin + contentWidth - 3, y, { align: "right" })
  y += 8

  // ── Total ──────────────────────────────────────────────────────────────────

  checkPageBreak(20)
  doc.setFillColor(37, 99, 235) // blue-600
  doc.rect(margin, y - 3, contentWidth, 18, "F")

  doc.setFontSize(10)
  setColor("#BFDBFE") // blue-200
  doc.text("報價總額", margin + 5, y + 2)

  doc.setFontSize(18)
  setColor("#FFFFFF")
  doc.text(`NTD ${pricing.total.toLocaleString()}`, margin + 5, y + 11)

  doc.setFontSize(10)
  setColor("#BFDBFE")
  doc.text("預估工期", margin + contentWidth - 5, y + 2, { align: "right" })

  doc.setFontSize(14)
  setColor("#FFFFFF")
  doc.text(`${timeResult.suggested_days} 天`, margin + contentWidth - 5, y + 11, { align: "right" })

  y += 22

  // ── Disclaimer ─────────────────────────────────────────────────────────────

  checkPageBreak(15)
  doc.setFillColor(255, 251, 235) // amber-50
  doc.rect(margin, y - 3, contentWidth, 14, "F")

  doc.setFontSize(8)
  setColor("#92400E") // amber-800
  const disclaimer = "⚠️ 本報價為快速估算，正式報價需現場勘查確認。面積估算基於" +
    (SOURCE_LABELS[areaEstimate.source] ?? areaEstimate.source) + "，誤差範圍約 ±15%。"
  doc.text(disclaimer, margin + 3, y + 3, { maxWidth: contentWidth - 6 })

  y += 18

  // ── Footer ─────────────────────────────────────────────────────────────────

  doc.setFontSize(7)
  setColor("#A1A1AA")
  doc.text(
    `Generated by GDS LARM Platform · ${new Date().toISOString().split("T")[0]} · ${pricing.pricing_version}`,
    pageWidth / 2,
    doc.internal.pageSize.getHeight() - 8,
    { align: "center" },
  )

  // ── Output ─────────────────────────────────────────────────────────────────

  const arrayBuffer = doc.output("arraybuffer")
  return Buffer.from(arrayBuffer)
}
