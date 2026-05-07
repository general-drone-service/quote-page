"use client"

import { useEffect, useRef } from "react"
import { setOptions, importLibrary } from "@googlemaps/js-api-loader"
import type { AirspaceResult } from "@/lib/types"

export interface PersistedShape {
  vertices: [number, number][]
  label: string
  edgeLabels?: string[]
}

interface Props {
  lat: number
  lng: number
  airspace: AirspaceResult | null
  drawMode?: boolean
  drawLabel?: string
  persistedShapes?: PersistedShape[]
  onPolygonDraw?: (vertices: [number, number][], area_m2: number, perimeter_m: number) => void
  onDrawModeEnd?: () => void
  onPositionChange?: (lat: number, lng: number) => void
  mapContainerRef?: (el: HTMLDivElement | null) => void
}

let optionsSet = false

function ensureOptions() {
  if (optionsSet) return
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? ""
  if (!apiKey) {
    console.warn("NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY not set; map will fail")
  }
  setOptions({ key: apiKey, v: "weekly", libraries: ["geometry", "drawing", "marker"] })
  optionsSet = true
}

type LoadedLibs = {
  coreLib: google.maps.CoreLibrary
  mapsLib: google.maps.MapsLibrary
  markerLib: google.maps.MarkerLibrary
  geometryLib: google.maps.GeometryLibrary
  drawingLib: google.maps.DrawingLibrary
}

async function loadMapsLibs(): Promise<LoadedLibs> {
  ensureOptions()
  const [coreLib, mapsLib, markerLib, geometryLib, drawingLib] = await Promise.all([
    importLibrary("core") as Promise<google.maps.CoreLibrary>,
    importLibrary("maps") as Promise<google.maps.MapsLibrary>,
    importLibrary("marker") as Promise<google.maps.MarkerLibrary>,
    importLibrary("geometry") as Promise<google.maps.GeometryLibrary>,
    importLibrary("drawing") as Promise<google.maps.DrawingLibrary>,
  ])
  return { coreLib, mapsLib, markerLib, geometryLib, drawingLib }
}

export function QuoteMap({
  lat, lng,
  drawMode, persistedShapes,
  onPolygonDraw, onDrawModeEnd, onPositionChange,
  mapContainerRef,
  // kept for API compat but unused in this impl:
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  airspace: _airspace,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  drawLabel: _drawLabel,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markerRef = useRef<google.maps.Marker | null>(null)
  const drawingManagerRef = useRef<google.maps.drawing.DrawingManager | null>(null)
  const persistedPolygonsRef = useRef<google.maps.Polygon[]>([])
  const persistedLabelsRef = useRef<google.maps.OverlayView[]>([])

  // ── Initialize map (once) ─────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    if (mapContainerRef) mapContainerRef(containerRef.current)
    let cancelled = false
    loadMapsLibs().then(({ mapsLib, markerLib }) => {
      if (cancelled || !containerRef.current) return
      const map = new mapsLib.Map(containerRef.current, {
        center: { lat, lng },
        zoom: 19,
        mapTypeId: mapsLib.MapTypeId.HYBRID,
        streetViewControl: false,
        mapTypeControl: false,
      })
      mapRef.current = map

      const marker = new markerLib.Marker({
        map, position: { lat, lng },
        draggable: !!onPositionChange,
      })
      markerRef.current = marker

      if (onPositionChange) {
        marker.addListener("dragend", () => {
          const p = marker.getPosition()
          if (p) onPositionChange(p.lat(), p.lng())
        })
        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (drawMode) return
          if (!e.latLng) return
          marker.setPosition(e.latLng)
          onPositionChange(e.latLng.lat(), e.latLng.lng())
        })
      }
    })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── React to lat/lng changes ──────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return
    const pos = { lat, lng }
    mapRef.current.setCenter(pos)
    markerRef.current.setPosition(pos)
  }, [lat, lng])

  // ── Drawing manager ───────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    loadMapsLibs().then(({ coreLib, geometryLib, drawingLib }) => {
      if (!drawMode) {
        drawingManagerRef.current?.setMap(null)
        drawingManagerRef.current = null
        return
      }
      const dm = new drawingLib.DrawingManager({
        drawingMode: drawingLib.OverlayType.POLYGON,
        drawingControl: false,
        polygonOptions: {
          fillColor: "#2563eb", fillOpacity: 0.2,
          strokeColor: "#2563eb", strokeWeight: 2,
          editable: false, draggable: false,
        },
      })
      dm.setMap(map)
      drawingManagerRef.current = dm

      coreLib.event.addListener(dm, "polygoncomplete", (poly: google.maps.Polygon) => {
        const path = poly.getPath()
        const verts: [number, number][] = []
        for (let i = 0; i < path.getLength(); i++) {
          const ll = path.getAt(i)
          verts.push([ll.lat(), ll.lng()])
        }
        const area_m2 = geometryLib.spherical.computeArea(path)
        const perimeter_m = geometryLib.spherical.computeLength(path)
        poly.setMap(null)
        onPolygonDraw?.(verts, area_m2, perimeter_m)
        onDrawModeEnd?.()
      })
    })
  }, [drawMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render persisted shapes ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    persistedPolygonsRef.current.forEach(p => p.setMap(null))
    persistedLabelsRef.current.forEach(l => l.setMap(null))
    persistedPolygonsRef.current = []
    persistedLabelsRef.current = []

    if (!persistedShapes?.length) return

    loadMapsLibs().then(({ coreLib, mapsLib }) => {
      for (const shape of persistedShapes!) {
        const path = shape.vertices.map(([vlat, vlng]) => ({ lat: vlat, lng: vlng }))
        const poly = new mapsLib.Polygon({
          map, paths: path,
          fillColor: "#10b981", fillOpacity: 0.25,
          strokeColor: "#059669", strokeWeight: 2,
        })
        persistedPolygonsRef.current.push(poly)

        if (shape.edgeLabels) {
          for (let i = 0; i < shape.vertices.length; i++) {
            const a = shape.vertices[i]
            const b = shape.vertices[(i + 1) % shape.vertices.length]
            const mid = { lat: (a[0] + b[0]) / 2, lng: (a[1] + b[1]) / 2 }
            const labelText = shape.edgeLabels[i] ?? `${i + 1}面`
            const label = createTextOverlay(coreLib, mapsLib, map, mid, labelText)
            persistedLabelsRef.current.push(label)
          }
        }
      }
    })
  }, [persistedShapes])

  return (
    <div ref={containerRef} className="w-full h-[400px] rounded-lg border border-zinc-300" />
  )
}

// ── Text overlay (edge label) ─────────────────────────────────────────────────

function createTextOverlay(
  coreLib: google.maps.CoreLibrary,
  mapsLib: google.maps.MapsLibrary,
  map: google.maps.Map,
  position: google.maps.LatLngLiteral,
  text: string,
): google.maps.OverlayView {
  class TextOverlay extends (mapsLib.OverlayView as typeof google.maps.OverlayView) {
    private div: HTMLDivElement | null = null
    onAdd() {
      const div = document.createElement("div")
      div.style.position = "absolute"
      div.style.background = "white"
      div.style.padding = "2px 6px"
      div.style.borderRadius = "4px"
      div.style.fontSize = "12px"
      div.style.boxShadow = "0 1px 3px rgba(0,0,0,0.2)"
      div.style.pointerEvents = "none"
      div.textContent = text
      this.div = div
      this.getPanes()?.overlayLayer.appendChild(div)
    }
    draw() {
      if (!this.div) return
      const proj = this.getProjection()
      if (!proj) return
      const p = proj.fromLatLngToDivPixel(new coreLib.LatLng(position))
      if (!p) return
      this.div.style.left = `${p.x - 20}px`
      this.div.style.top  = `${p.y - 12}px`
    }
    onRemove() {
      this.div?.remove()
      this.div = null
    }
  }
  const overlay = new TextOverlay()
  overlay.setMap(map)
  return overlay
}
