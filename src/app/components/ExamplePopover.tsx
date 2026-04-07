"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { ExampleInfo } from "./example-popover-data"

interface Props {
  anchorEl: HTMLElement | null
  open: boolean
  onClose: () => void
  info: ExampleInfo
  dark?: boolean
}

export function ExamplePopover({ anchorEl, open, onClose, info, dark = false }: Props) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null)

  // Position calculation
  useEffect(() => {
    if (!open || !anchorEl) { setPos(null); return }
    const rect = anchorEl.getBoundingClientRect()
    const popW = 240
    const popH = 180
    const above = rect.top > popH + 12
    const top = above ? rect.top - popH - 8 : rect.bottom + 8
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - popW / 2, window.innerWidth - popW - 8))
    setPos({ top: top + window.scrollY, left, above })
  }, [open, anchorEl])

  // Auto-close after 3 seconds
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(onClose, 3000)
    return () => clearTimeout(timer)
  }, [open, onClose])

  // Click outside to close
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
          anchorEl && !anchorEl.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("pointerdown", handleClick, true)
    return () => document.removeEventListener("pointerdown", handleClick, true)
  }, [open, onClose, anchorEl])

  if (!open || !pos) return null

  const bg = dark ? "bg-zinc-800 border-zinc-600" : "bg-white border-zinc-200"
  const titleColor = dark ? "text-zinc-100" : "text-zinc-800"
  const descColor = dark ? "text-zinc-400" : "text-zinc-500"
  const shadow = "shadow-lg"

  return createPortal(
    <div
      ref={popoverRef}
      role="tooltip"
      style={{ position: "absolute", top: pos.top, left: pos.left, width: 240, zIndex: 9999 }}
      className={`rounded-xl border ${bg} ${shadow} overflow-hidden animate-in fade-in duration-150`}
    >
      {/* Placeholder image */}
      <div className={`h-20 ${info.imageBg} flex items-center justify-center`}>
        <span className="text-3xl">{info.imageIcon}</span>
      </div>
      {/* Text */}
      <div className="px-3 py-2.5">
        <p className={`text-sm font-semibold ${titleColor}`}>{info.title}</p>
        <p className={`text-xs leading-relaxed mt-1 ${descColor}`}>{info.description}</p>
      </div>
      {/* Arrow */}
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={pos.above ? { bottom: -6 } : { top: -6 }}
      >
        <div
          className={`w-3 h-3 rotate-45 border ${bg}`}
          style={pos.above
            ? { borderTop: "none", borderLeft: "none" }
            : { borderBottom: "none", borderRight: "none" }
          }
        />
      </div>
    </div>,
    document.body,
  )
}
