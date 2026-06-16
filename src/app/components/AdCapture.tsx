"use client"

import { useEffect } from "react"
import { captureFirstTouch } from "@/lib/ad-cookie"

/** Mounts once at the app root; persists landing gclid/fbclid/utm to a cookie. */
export function AdCapture() {
  useEffect(() => {
    captureFirstTouch()
  }, [])
  return null
}
