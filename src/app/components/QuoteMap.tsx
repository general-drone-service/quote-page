"use client"

import { useEffect, useRef } from "react"
import type { AirspaceResult } from "@/lib/types"

export interface PersistedShape {
  vertices: [number, number][]   // [lat, lng] polygon vertices
  label: string
  /** Numbered face labels for each edge (e.g. ["1面", "2面", ...]) */
  edgeLabels?: string[]
}

interface Props {
  lat: number
  lng: number
  airspace: AirspaceResult | null
  /** Draw mode active — clicks add polygon vertices */
  drawMode?: boolean
  /** Label shown in dim overlay while drawing (e.g. "棟A") */
  drawLabel?: string
  /** Saved polygon shapes to display persistently on the map */
  persistedShapes?: PersistedShape[]
  /** Called when shape is closed (≥2 vertices: 2=single facade line, ≥3=polygon) */
  onPolygonDraw?: (vertices: [number, number][], area_m2: number, perimeter_m: number) => void
  /** Called after polygon is successfully closed (so parent can exit draw mode) */
  onDrawModeEnd?: () => void
  /** When provided the marker becomes draggable and map clicks also reposition it */
  onPositionChange?: (lat: number, lng: number) => void
  /** Exposes the map container DOM element for screenshot capture */
  mapContainerRef?: (el: HTMLDivElement | null) => void
}

const SATELLITE_TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
const SATELLITE_ATTR = "Tiles &copy; Esri"

// ── Polygon geometry helpers ──────────────────────────────────────────────────

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLon = (lon2 - lon1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function polygonPerimeter(verts: [number, number][]): number {
  let total = 0
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length]
    total += haversineM(a[0], a[1], b[0], b[1])
  }
  return total
}

function polygonArea(verts: [number, number][]): number {
  if (verts.length < 3) return 0
  const refLat = verts[0][0], refLng = verts[0][1]
  const mLat = 111320, mLng = 111320 * Math.cos(refLat * Math.PI / 180)
  const pts = verts.map(([lat, lng]) => [(lng - refLng) * mLng, (lat - refLat) * mLat])
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]
  }
  return Math.abs(area) / 2
}

// ─────────────────────────────────────────────────────────────────────────────

export function QuoteMap({
  lat, lng, airspace,
  drawMode, drawLabel, persistedShapes,
  onPolygonDraw, onDrawModeEnd, onPositionChange,
  mapContainerRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<unknown>(null)
  const drawModeRef  = useRef(drawMode ?? false)
  const drawLabelRef = useRef(drawLabel ?? "")
  const persistedLayersRef = useRef<unknown[]>([])

  // ── Marker ref: exposed so pan-to effect can update position without reinit ──
  const markerRef = useRef<unknown>(null)

  // ── Callback refs: prevents map reinit when parent re-renders with new inline lambdas ──
  const onPolygonDrawCb    = useRef(onPolygonDraw)
  const onPositionChangeCb = useRef(onPositionChange)
  const onDrawModeEndCb    = useRef(onDrawModeEnd)

  useEffect(() => { onPolygonDrawCb.current    = onPolygonDraw    }, [onPolygonDraw])
  useEffect(() => { onPositionChangeCb.current = onPositionChange }, [onPositionChange])
  useEffect(() => { onDrawModeEndCb.current    = onDrawModeEnd    }, [onDrawModeEnd])

  // Refs for communicating with secondary effects
  const startNewDrawRef = useRef<() => void>(() => {})
  const cancelDrawRef   = useRef<() => void>(() => {})
  const isCompleteRef   = useRef(false)

  // ── Main effect: initialise the Leaflet map ──────────────────────────────────
  // Deps: only `airspace` — lat/lng are used as initial values at init time
  // and updated via the pan-to effect below without full reinit.
  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    async function init() {
      const L = await import("leaflet")
      // @ts-expect-error — no type declarations
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return

      if (mapInstance.current) {
        (mapInstance.current as L.Map).remove()
        mapInstance.current = null
        markerRef.current = null
      }

      const icon = L.icon({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        iconSize: [25, 41] as [number, number],
        iconAnchor: [12, 41] as [number, number],
      })

      const map = L.map(containerRef.current, { center: [lat, lng] as [number, number], zoom: 18 })
      L.tileLayer(SATELLITE_TILE, { attribution: SATELLITE_ATTR, maxZoom: 19 }).addTo(map)

      // ── Marker ────────────────────────────────────────────────────────────────
      const marker = L.marker([lat, lng] as [number, number], {
        icon, draggable: !!onPositionChangeCb.current,
      }).addTo(map)
      markerRef.current = marker   // expose for pan-to effect

      if (onPositionChangeCb.current) {
        marker.on("dragend", () => {
          const { lat: newLat, lng: newLng } = marker.getLatLng()
          onPositionChangeCb.current?.(newLat, newLng)
        })
        map.on("click", (e: L.LeafletMouseEvent) => {
          if (drawModeRef.current) return
          marker.setLatLng(e.latlng)
          onPositionChangeCb.current?.(e.latlng.lat, e.latlng.lng)
        })
        const PinHelp = L.Control.extend({
          onAdd() {
            const div = L.DomUtil.create("div", "")
            div.innerHTML = `<div style="background:white;padding:5px 9px;border-radius:6px;font-size:11px;box-shadow:0 1px 4px rgba(0,0,0,.2)">拖動標記或點選地圖修正位置</div>`
            return div
          },
        })
        new PinHelp({ position: "bottomright" }).addTo(map)
      }

      // ── Airspace circle ────────────────────────────────────────────────────────
      if (airspace) {
        const color =
          airspace.status === "NoFly" ? "#ef4444" :
          airspace.status === "NeedPermit" ? "#f59e0b" : "#22c55e"
        L.circle([lat, lng] as [number, number], {
          radius: 100, color, weight: 1, fillColor: color, fillOpacity: 0.1,
        }).addTo(map)
      }

      // ── Polygon click-draw ─────────────────────────────────────────────────────
      if (onPolygonDrawCb.current) {
        // Drawing state (closure-local)
        let vertices: L.LatLng[] = []
        let vertexMarkers: L.CircleMarker[] = []
        let edgeLines: L.Polyline[] = []
        let previewLine: L.Polyline | null = null
        const SNAP_M = 10  // snap distance to first vertex (meters)

        // Dim control — shows live info
        const dimDiv = L.DomUtil.create("div", "")
        dimDiv.style.cssText =
          "display:none;background:rgba(20,20,20,.88);color:#fff;padding:4px 10px;border-radius:6px;" +
          "font-size:12px;font-weight:600;pointer-events:none;white-space:nowrap"
        const DimCtrl = L.Control.extend({ onAdd() { return dimDiv } })
        new DimCtrl({ position: "topleft" }).addTo(map)

        // Close hint overlay
        const hintDiv = L.DomUtil.create("div", "")
        hintDiv.style.cssText =
          "display:none;background:rgba(239,68,68,.9);color:#fff;padding:3px 9px;border-radius:5px;" +
          "font-size:11px;pointer-events:none"
        hintDiv.textContent = "點擊閉合多邊形"
        const HintCtrl = L.Control.extend({ onAdd() { return hintDiv } })
        new HintCtrl({ position: "topright" }).addTo(map)

        const clearInProgress = () => {
          vertexMarkers.forEach(m => map.removeLayer(m))
          edgeLines.forEach(l => map.removeLayer(l))
          if (previewLine) { map.removeLayer(previewLine); previewLine = null }
          vertexMarkers = []
          edgeLines = []
          vertices = []
          dimDiv.style.display = "none"
          hintDiv.style.display = "none"
        }

        const closePolygon = () => {
          if (vertices.length < 2 || isCompleteRef.current) return
          isCompleteRef.current = true

          // Capture before clearInProgress() resets the vertices array
          const verts: [number, number][] = vertices.map(v => [v.lat, v.lng])
          const area = polygonArea(verts) // returns 0 for <3 vertices
          // For 2 vertices (single facade line), perimeter = edge length (not round-trip)
          const perim = verts.length === 2
            ? haversineM(verts[0][0], verts[0][1], verts[1][0], verts[1][1])
            : polygonPerimeter(verts)

          clearInProgress()

          dimDiv.textContent = verts.length === 2
            ? `${drawLabelRef.current ? drawLabelRef.current + "  " : ""}單面寬 ${Math.round(perim)} m`
            : `${drawLabelRef.current ? drawLabelRef.current + "  " : ""}${Math.round(area).toLocaleString()} ㎡ · 周長 ${Math.round(perim)} m`
          dimDiv.style.display = "block"
          setTimeout(() => { dimDiv.style.display = "none" }, 3000)

          onPolygonDrawCb.current?.(verts, area, perim)
          onDrawModeEndCb.current?.()
        }

        // Expose reset hooks for secondary effect
        startNewDrawRef.current = () => {
          clearInProgress()
          isCompleteRef.current = false
        }
        cancelDrawRef.current = () => {
          if (!isCompleteRef.current) clearInProgress()
        }

        // ── Click: add vertex or close ──────────────────────────────────────────
        map.on("click", (e: L.LeafletMouseEvent) => {
          if (!drawModeRef.current || isCompleteRef.current) return

          // Snap to first vertex to close (≥2 for single facade, ≥3 for polygon)
          if (vertices.length >= 2) {
            const dist = e.latlng.distanceTo(vertices[0])
            if (dist <= SNAP_M) {
              closePolygon()
              return
            }
          }

          vertices.push(e.latlng)
          const isFirst = vertices.length === 1

          // Vertex marker
          const m = L.circleMarker(e.latlng, {
            radius: isFirst ? 8 : 5,
            color: "#2563eb", weight: 2,
            fillColor: isFirst ? "#ef4444" : "#fff",
            fillOpacity: 1,
          }).addTo(map)
          vertexMarkers.push(m)

          // Edge from previous vertex
          if (vertices.length >= 2) {
            const edge = L.polyline(
              [vertices[vertices.length - 2], vertices[vertices.length - 1]],
              { color: "#2563eb", weight: 2 }
            ).addTo(map)
            edgeLines.push(edge)
          }

          // Update dim
          if (vertices.length >= 2) {
            const perim = polygonPerimeter(vertices.map(v => [v.lat, v.lng] as [number, number]))
            const prefix = drawLabelRef.current ? `${drawLabelRef.current}  ` : ""
            dimDiv.textContent = `${prefix}${vertices.length} 頂點 · 約 ${Math.round(perim)} m`
            dimDiv.style.display = "block"
          }
        })

        // ── Mousemove: preview line + snap hint ────────────────────────────────
        map.on("mousemove", (e: L.LeafletMouseEvent) => {
          if (!drawModeRef.current || isCompleteRef.current || vertices.length === 0) return

          if (previewLine) map.removeLayer(previewLine)
          previewLine = L.polyline(
            [vertices[vertices.length - 1], e.latlng],
            { color: "#2563eb", weight: 1.5, dashArray: "6 4" }
          ).addTo(map)

          // Snap hint: highlight first vertex (≥2 for single facade, ≥3 for polygon)
          if (vertices.length >= 2 && vertexMarkers[0]) {
            const dist = e.latlng.distanceTo(vertices[0])
            const near = dist <= SNAP_M
            vertexMarkers[0].setStyle({
              fillColor: "#ef4444",
              radius: near ? 11 : 8,
              color: near ? "#dc2626" : "#2563eb",
            })
            hintDiv.textContent = vertices.length === 2 ? "點擊確認單面" : "點擊閉合多邊形"
            hintDiv.style.display = near ? "block" : "none"
          }
        })

        // ── Double-click: close shape (≥2 vertices) ──────────────────────────
        map.on("dblclick", (e: L.LeafletMouseEvent) => {
          if (!drawModeRef.current || isCompleteRef.current) return
          L.DomEvent.stop(e)
          if (vertices.length >= 2) closePolygon()
        })
      }

      persistedLayersRef.current = []
      mapInstance.current = map
    }

    init()
    return () => {
      cancelled = true
      if (mapInstance.current) {
        (mapInstance.current as { remove: () => void }).remove()
        mapInstance.current = null
        markerRef.current = null
      }
    }
  }, [airspace]) // eslint-disable-line react-hooks/exhaustive-deps
  // ^ lat/lng intentionally omitted: used as init-time values only.
  //   Subsequent changes are handled by the pan-to effect below.

  // ── Pan-to: update map position without full reinit ────────────────────────
  // Prevents the drag-feedback loop: drag marker → parent updates lat/lng →
  // map pans to same position (no visible change) rather than reinitialising.
  useEffect(() => {
    type Marker = { getLatLng: () => { lat: number; lng: number }; setLatLng: (ll: [number, number]) => void }
    type Map = { setView: (c: [number, number], z: number) => void; getZoom: () => number }
    const map = mapInstance.current as Map | null
    const marker = markerRef.current as Marker | null
    if (!map || !marker) return
    const cur = marker.getLatLng()
    // Only reposition if meaningfully different (>0.00005° ≈ 5m) to avoid
    // feedback loop when the change originated from a marker drag.
    if (Math.abs(cur.lat - lat) > 0.00005 || Math.abs(cur.lng - lng) > 0.00005) {
      marker.setLatLng([lat, lng])
      map.setView([lat, lng], map.getZoom())
    }
  }, [lat, lng])

  // ── Secondary: draw mode changes ──────────────────────────────────────────
  useEffect(() => {
    drawModeRef.current = drawMode ?? false
    const map = mapInstance.current as (L.Map & { dragging: L.Handler }) | null
    if (!map) return
    if (drawMode) {
      startNewDrawRef.current()
      ;(map.getContainer() as HTMLElement).style.cursor = "crosshair"
    } else {
      cancelDrawRef.current()
      isCompleteRef.current = false
      ;(map.getContainer() as HTMLElement).style.cursor = ""
    }
  }, [drawMode])

  // ── Secondary: draw label ref ──────────────────────────────────────────────
  useEffect(() => { drawLabelRef.current = drawLabel ?? "" }, [drawLabel])

  // ── Secondary: update persisted shape layers ───────────────────────────────
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return
    import("leaflet").then(L => {
      const m = map as L.Map
      for (const layer of persistedLayersRef.current) m.removeLayer(layer as L.Layer)
      persistedLayersRef.current = []
      if (!persistedShapes?.length) return
      for (const shape of persistedShapes) {
        if (!shape.vertices?.length) continue
        const isSingleFacade = shape.vertices.length === 2
        // 2 vertices → polyline (single facade); ≥3 → polygon
        const layer = isSingleFacade
          ? L.polyline(shape.vertices, {
              color: "#16a34a", weight: 3, dashArray: "8 4",
            }).bindTooltip(shape.label, { permanent: true, direction: "center" }).addTo(m)
          : L.polygon(shape.vertices, {
              color: "#16a34a", weight: 2, fillColor: "#22c55e", fillOpacity: 0.2,
            }).bindTooltip(shape.label, { permanent: true, direction: "center" }).addTo(m)
        persistedLayersRef.current.push(layer)

        // Add numbered face labels at each edge midpoint
        const edgeCount = isSingleFacade ? 1 : shape.vertices.length
        if (shape.edgeLabels?.length) {
          for (let ei = 0; ei < edgeCount; ei++) {
            const v1 = shape.vertices[ei]
            const v2 = shape.vertices[(ei + 1) % shape.vertices.length]
            const midLat = (v1[0] + v2[0]) / 2
            const midLng = (v1[1] + v2[1]) / 2
            const edgeLabel = shape.edgeLabels[ei] ?? `${ei + 1}面`
            const edgeMarker = L.marker([midLat, midLng] as [number, number], {
              icon: L.divIcon({
                className: "",
                html: `<div style="background:#2563eb;color:#fff;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600;white-space:nowrap;transform:translate(-50%,-50%);box-shadow:0 1px 3px rgba(0,0,0,.3)">${edgeLabel}</div>`,
                iconSize: [0, 0],
              }),
              interactive: false,
            }).addTo(m)
            persistedLayersRef.current.push(edgeMarker)
          }
        }
      }
    })
  }, [persistedShapes])

  return (
    <div ref={(el) => { (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el; mapContainerRef?.(el) }} className="w-full h-[220px] sm:h-[300px] rounded-lg border border-zinc-700 overflow-hidden" />
  )
}
