import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const from = vi.fn()
vi.mock("@/lib/supabase/client", () => ({ getSupabaseAdmin: () => ({ from }) }))

const { GET, POST, PUT } = await import("./route")

const TOKEN = "test-admin-token"

function req(method: string, body: unknown, auth?: string) {
  return new Request("https://quote.test/api/pricing-params", {
    method,
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body),
  })
}

// Every write path goes through from(); any call means the request reached the database
function chain() {
  const q: Record<string, unknown> = {}
  for (const m of ["select", "update", "insert", "eq", "limit"]) q[m] = vi.fn(() => q)
  q.single = vi.fn(async () => ({ data: { version: "v9", id: 1 }, error: null }))
  q.then = (resolve: (v: unknown) => void) => resolve({ error: null })
  return q
}

beforeEach(() => {
  from.mockReset()
  from.mockImplementation(() => chain())
  process.env.PRICING_ADMIN_TOKEN = TOKEN
})
afterEach(() => {
  delete process.env.PRICING_ADMIN_TOKEN
})

const create = { version: "v9", params: { version: "v9" } }

describe.each([
  ["POST", POST, create],
  ["PUT", PUT, { version: "v9" }],
] as const)("%s /api/pricing-params", (_name, handler, body) => {
  it("rejects a request without a token and never touches the database", async () => {
    const res = await handler(req(_name, body))
    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it("rejects a wrong token of the same length", async () => {
    const res = await handler(req(_name, body, `Bearer ${"x".repeat(TOKEN.length)}`))
    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it("fails closed with 503 when the admin token is not configured", async () => {
    delete process.env.PRICING_ADMIN_TOKEN
    const res = await handler(req(_name, body, `Bearer ${TOKEN}`))
    expect(res.status).toBe(503)
    expect(from).not.toHaveBeenCalled()
  })

  it("accepts the configured token", async () => {
    const res = await handler(req(_name, body, `Bearer ${TOKEN}`))
    expect(res.status).toBe(200)
    expect(from).toHaveBeenCalled()
  })
})

describe("GET /api/pricing-params", () => {
  it("stays public: the quote wizard reads the active params without a token", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
  })
})
