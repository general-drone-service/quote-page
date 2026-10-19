import crypto from "node:crypto"
import { NextResponse } from "next/server"

/**
 * Bearer check for admin writes (Authorization: Bearer $PRICING_ADMIN_TOKEN).
 * Fails closed: 503 when the token is not configured, 401 when it does not match.
 */
export function rejectUnlessAdmin(request: Request): Response | null {
  const token = process.env.PRICING_ADMIN_TOKEN
  if (!token) {
    return NextResponse.json({ error: "Admin API not configured" }, { status: 503 })
  }
  const given = Buffer.from(request.headers.get("authorization") ?? "")
  const expected = Buffer.from(`Bearer ${token}`)
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return null
}
