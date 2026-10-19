import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const from = vi.fn()
vi.mock("@/lib/supabase/client", () => ({ getSupabaseAdmin: () => ({ from }) }))

const { POST } = await import("./route")

const TOKEN = "test-lookup-token"

function req(auth?: string) {
  return new Request("https://quote.test/api/quote/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify({ quoteCode: "Q-20261019-123" }),
  })
}

beforeEach(() => {
  from.mockReset()
  const q: Record<string, unknown> = {}
  for (const m of ["select", "eq"]) q[m] = vi.fn(() => q)
  q.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
  from.mockImplementation(() => q)
  process.env.QUOTE_LOOKUP_TOKEN = TOKEN
})
afterEach(() => {
  delete process.env.QUOTE_LOOKUP_TOKEN
})

describe("POST /api/quote/lookup", () => {
  it("rejects a request without a token before reading quotes", async () => {
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it("rejects a wrong token", async () => {
    const res = await POST(req(`Bearer ${"x".repeat(TOKEN.length)}`))
    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it("fails closed with 503 when the token is not configured", async () => {
    delete process.env.QUOTE_LOOKUP_TOKEN
    const res = await POST(req(`Bearer ${TOKEN}`))
    expect(res.status).toBe(503)
    expect(from).not.toHaveBeenCalled()
  })

  it("looks the quote up with the configured token", async () => {
    const res = await POST(req(`Bearer ${TOKEN}`))
    expect(res.status).toBe(404)
    expect(from).toHaveBeenCalledWith("quotes")
  })
})
