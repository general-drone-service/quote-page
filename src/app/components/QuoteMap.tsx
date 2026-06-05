"use client"

import { useEffect, useRef, useState } from "react"
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
  // NOTE: the "drawing" library is intentionally NOT requested. Google deprecated
  // google.maps.drawing in Aug 2025 and made it unavailable in May 2026 — importing it
  // now rejects and would break the whole map load. We draw polygons manually instead.
  setOptions({ key: apiKey, v: "weekly", libraries: ["geometry", "marker"] })
  optionsSet = true
}

type LoadedLibs = {
  coreLib: google.maps.CoreLibrary
  mapsLib: google.maps.MapsLibrary
  markerLib: google.maps.MarkerLibrary
  geometryLib: google.maps.GeometryLibrary
}

async function loadMapsLibs(): Promise<LoadedLibs> {
  ensureOptions()
  const [coreLib, mapsLib, markerLib, geometryLib] = await Promise.all([
    importLibrary("core") as Promise<google.maps.CoreLibrary>,
    importLibrary("maps") as Promise<google.maps.MapsLibrary>,
    importLibrary("marker") as Promise<google.maps.MarkerLibrary>,
    importLibrary("geometry") as Promise<google.maps.GeometryLibrary>,
  ])
  return { coreLib, mapsLib, markerLib, geometryLib }
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
  const persistedPolygonsRef = useRef<google.maps.Polygon[]>([])
  const persistedLabelsRef = useRef<google.maps.OverlayView[]>([])
  // Set once the map instance exists; lets the draw effect re-run when the map is ready.
  const [mapReady, setMapReady] = useState(false)

  // Stable refs for draw callbacks so the draw listeners never close over stale props.
  const onPolygonDrawRef = useRef(onPolygonDraw)
  const onDrawModeEndRef = useRef(onDrawModeEnd)
  useEffect(() => { onPolygonDrawRef.current = onPolygonDraw }, [onPolygonDraw])
  useEffect(() => { onDrawModeEndRef.current = onDrawModeEnd }, [onDrawModeEnd])

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
        clickableIcons: false, // POI labels must not swallow draw clicks
      })
      mapRef.current = map
      setMapReady(true)

      const marker = new markerLib.Marker({
        map, position: { lat, lng },
        draggable: !!onPositionChange,
        // In draw-only mode (no onPositionChange) keep the pin click-through so it
        // never eats a vertex click landing on it.
        clickable: !!onPositionChange,
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

  // ── Manual polygon draw ────────────────────────────────────────────────────
  // The Google Maps Drawing library (DrawingManager) was removed in May 2026, so we
  // implement click-to-draw ourselves with plain map listeners + Polyline/Marker, and
  // compute area/length with the geometry library. UX mirrors the prior Leaflet build:
  // click to add vertices, click the first vertex (red, snaps) or double-click to close,
  // 2 vertices = single facade line, ≥3 = polygon.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !drawMode) return

    let cancelled = false
    let cleanup: (() => void) | null = null

    loadMapsLibs().then(({ coreLib, mapsLib, markerLib, geometryLib }) => {
      if (cancelled) return
      const sph = geometryLib.spherical
      const SNAP_M = 10 // snap distance to first vertex (meters)

      let vertices: google.maps.LatLng[] = []
      let vertexTimes: number[] = [] // ms timestamp per vertex; lets dblclick drop its leading click
      let vertexMarkers: google.maps.Marker[] = []
      let edgeLines: google.maps.Polyline[] = []
      let previewLine: google.maps.Polyline | null = null
      let complete = false

      const prevDblZoom = map.get("disableDoubleClickZoom") as boolean | undefined
      map.setOptions({ disableDoubleClickZoom: true, draggableCursor: "crosshair" })

      const vertexIcon = (first: boolean, near = false): google.maps.Symbol => ({
        path: coreLib.SymbolPath.CIRCLE,
        scale: first ? (near ? 10 : 7) : 5,
        fillColor: first ? "#ef4444" : "#ffffff",
        fillOpacity: 1,
        strokeColor: near ? "#dc2626" : "#2563eb",
        strokeWeight: 2,
      })

      const clearInProgress = () => {
        vertexMarkers.forEach(m => m.setMap(null))
        edgeLines.forEach(l => l.setMap(null))
        previewLine?.setMap(null)
        previewLine = null
        vertexMarkers = []
        edgeLines = []
        vertices = []
        vertexTimes = []
      }

      const closePolygon = () => {
        if (vertices.length < 2 || complete) return
        complete = true
        const verts: [number, number][] = vertices.map(v => [v.lat(), v.lng()])
        // 2 verts → single facade line (edge length); ≥3 → polygon (footprint area + closed perimeter)
        const area_m2 = verts.length >= 3 ? sph.computeArea(vertices) : 0
        const perimeter_m = verts.length === 2
          ? sph.computeDistanceBetween(vertices[0], vertices[1])
          : sph.computeLength([...vertices, vertices[0]])
        clearInProgress()
        onPolygonDrawRef.current?.(verts, area_m2, perimeter_m)
        onDrawModeEndRef.current?.()
      }

      const clickL = map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (complete || !e.latLng) return
        // Snap to first vertex to close (≥2 for single facade, ≥3 for polygon)
        if (vertices.length >= 2 && sph.computeDistanceBetween(e.latLng, vertices[0]) <= SNAP_M) {
          closePolygon()
          return
        }
        const isFirst = vertices.length === 0
        vertices.push(e.latLng)
        vertexTimes.push(Date.now())
        vertexMarkers.push(new markerLib.Marker({
          map, position: e.latLng, clickable: false, zIndex: 10,
          icon: vertexIcon(isFirst),
        }))
        if (vertices.length >= 2) {
          edgeLines.push(new mapsLib.Polyline({
            map, clickable: false,
            path: [vertices[vertices.length - 2], vertices[vertices.length - 1]],
            strokeColor: "#2563eb", strokeWeight: 2,
          }))
        }
      })

      const moveL = map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
        if (complete || vertices.length === 0 || !e.latLng) return
        const last = vertices[vertices.length - 1]
        if (previewLine) previewLine.setPath([last, e.latLng])
        else previewLine = new mapsLib.Polyline({
          map, clickable: false, path: [last, e.latLng], strokeOpacity: 0,
          icons: [{
            icon: { path: "M 0,-1 0,1", strokeColor: "#2563eb", strokeOpacity: 1, scale: 3 },
            offset: "0", repeat: "12px",
          }],
        })
        // Highlight first vertex when the cursor is near enough to snap-close
        if (vertices.length >= 2 && vertexMarkers[0]) {
          const near = sph.computeDistanceBetween(e.latLng, vertices[0]) <= SNAP_M
          vertexMarkers[0].setIcon(vertexIcon(true, near))
        }
      })

      const dblL = map.addListener("dblclick", () => {
        if (complete) return
        // Google emits a click (occasionally two) right before dblclick, each of which already
        // committed a vertex. Drop those just-added points so double-click closes with only the
        // user's deliberate vertices (mirrors the prior Leaflet build, which stopped the click).
        const now = Date.now()
        while (vertices.length > 0 && now - vertexTimes[vertices.length - 1] < 400) {
          const hadEdge = vertices.length >= 2
          vertices.pop()
          vertexTimes.pop()
          vertexMarkers.pop()?.setMap(null)
          if (hadEdge) edgeLines.pop()?.setMap(null)
        }
        if (vertices.length >= 2) closePolygon()
      })

      cleanup = () => {
        clickL.remove()
        moveL.remove()
        dblL.remove()
        clearInProgress()
        map.setOptions({ disableDoubleClickZoom: !!prevDblZoom, draggableCursor: null })
      }
    })

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [drawMode, mapReady])

  // ── Render persisted shapes ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    persistedPolygonsRef.current.forEach(p => p.setMap(null))
    persistedLabelsRef.current.forEach(l => l.setMap(null))
    persistedPolygonsRef.current = []
    persistedLabelsRef.current = []

    if (!persistedShapes?.length) return

    let cancelled = false
    loadMapsLibs().then(({ coreLib, mapsLib }) => {
      if (cancelled) return // a newer run superseded this one; don't stack stale graphics
      for (const shape of persistedShapes!) {
        const path = shape.vertices.map(([vlat, vlng]) => ({ lat: vlat, lng: vlng }))
        const poly = new mapsLib.Polygon({
          map, paths: path,
          fillColor: "#10b981", fillOpacity: 0.25,
          strokeColor: "#059669", strokeWeight: 2,
          clickable: false, // display-only; must not swallow clicks meant for drawing
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

    return () => {
      cancelled = true
      // Graphics are created post-await; drop anything this run already added so a
      // superseding re-run / StrictMode double-invoke can't leave stacked duplicates.
      persistedPolygonsRef.current.forEach(p => p.setMap(null))
      persistedLabelsRef.current.forEach(l => l.setMap(null))
      persistedPolygonsRef.current = []
      persistedLabelsRef.current = []
    }
  }, [persistedShapes, mapReady])

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
