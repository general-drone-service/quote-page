import { beforeEach, describe, expect, it, vi } from "vitest"

let pdfThrows: boolean
vi.mock("@/lib/pdf", () => ({
  generateQuotePdf: (input: { pricing: { quote_code: string } }) => {
    if (pdfThrows) throw new Error("font missing")
    return Buffer.from(input.pricing.quote_code)
  },
}))
vi.mock("@/lib/supabase/crm", () => ({ getCrmAdmin: () => null }))

// In-memory quotes table with the real unique constraint on quote_code
let rows: Record<string, unknown>[]
let uploads: { path: string; body: string; opts: unknown }[]
let uploadFails: boolean
let uploadStoresThenFails: boolean
let updateFails: boolean
let removed: string[]
const db = {
  from: () => ({
    insert: async (row: Record<string, unknown>) => {
      if (rows.some((r) => r.quote_code === row.quote_code)) return { error: { code: "23505" } }
      rows.push({ ...row })
      return { error: null }
    },
    update: (patch: Record<string, unknown>) => ({
      eq: async (_col: string, code: string) => {
        if (updateFails) return { error: { message: "timeout" } }
        rows.filter((r) => r.quote_code === code).forEach((r) => Object.assign(r, patch))
        return { error: null }
      },
    }),
    delete: () => ({
      eq: async (_col: string, code: string) => {
        rows = rows.filter((r) => r.quote_code !== code)
        return { error: null }
      },
    }),
  }),
  storage: {
    from: () => ({
      upload: async (path: string, body: Buffer, opts: unknown) => {
        if (uploadFails) return { error: { message: "boom" } }
        uploads.push({ path, body: body.toString(), opts })
        if (uploadStoresThenFails) return { error: { message: "connection reset" } }
        return { error: null }
      },
      remove: async (paths: string[]) => {
        removed.push(...paths)
        uploads = uploads.filter((u) => !paths.includes(u.path))
        return { error: null }
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
    }),
  },
}
vi.mock("@/lib/supabase/client", () => ({ getSupabaseAdmin: () => db }))

const { POST } = await import("./route")

function req(code: string) {
  return new Request("https://quote.test/api/quote/generate-and-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pricing: { quote_code: code, valid_until: "2026-11-19" },
      timeResult: {},
      formData: { clientName: "測試", address: "測試地址" },
      areaEstimate: {},
    }),
  })
}

beforeEach(() => {
  rows = []
  uploads = []
  uploadFails = false
  updateFails = false
  uploadStoresThenFails = false
  pdfThrows = false
  removed = []
})

describe("POST /api/quote/generate-and-save", () => {
  it("never overwrites another customer's quote when the code is taken", async () => {
    rows.push({ quote_code: "Q-20261019-123", form_data: { clientName: "先來的客戶" } })
    const res = await POST(req("Q-20261019-123"))
    const { quoteCode } = (await res.json()) as { quoteCode: string }

    expect(res.status).toBe(200)
    expect(quoteCode).toMatch(/^Q-20261019-\d{3}$/)
    expect(quoteCode).not.toBe("Q-20261019-123")
    expect(rows.find((r) => r.quote_code === "Q-20261019-123")?.form_data).toEqual({ clientName: "先來的客戶" })
    // the new code is the one stored, printed in the PDF and returned to the client
    const saved = rows.find((r) => r.quote_code === quoteCode) as { pricing: { quote_code: string }; pdf_url: string }
    expect(saved.pricing.quote_code).toBe(quoteCode)
    expect(uploads[0].body).toBe(quoteCode)
    expect(saved.pdf_url).toBe(`https://cdn.test/${uploads[0].path}`)
  })

  it("stores the PDF under an unguessable name and never overwrites a file", async () => {
    await POST(req("Q-20261019-456"))
    expect(uploads[0].path).toMatch(/^quotes\/Q-20261019-456-[0-9a-f-]{36}\.pdf$/)
    expect(uploads[0].opts).not.toHaveProperty("upsert", true)
  })

  it("rejects a quote code outside the wizard format before writing anything", async () => {
    const res = await POST(req("../../etc/x"))
    expect(res.status).toBe(400)
    expect(rows).toHaveLength(0)
    expect(uploads).toHaveLength(0)
  })

  it("releases the code when the PDF upload fails", async () => {
    uploadFails = true
    const res = await POST(req("Q-20261019-789"))
    expect(res.status).toBe(500)
    expect(rows).toHaveLength(0)
  })

  it("removes a PDF that was stored even though the upload reported an error", async () => {
    uploadStoresThenFails = true
    const res = await POST(req("Q-20261019-987"))
    expect(res.status).toBe(500)
    expect(rows).toHaveLength(0)
    expect(uploads).toHaveLength(0)
  })

  it("releases the code when PDF generation throws", async () => {
    pdfThrows = true
    const res = await POST(req("Q-20261019-321"))
    expect(res.status).toBe(500)
    expect(rows).toHaveLength(0)
  })

  it("removes the uploaded PDF and the row when saving pdf_url fails", async () => {
    updateFails = true
    const res = await POST(req("Q-20261019-654"))
    expect(res.status).toBe(500)
    expect(rows).toHaveLength(0)
    expect(uploads).toHaveLength(0)
    expect(removed).toHaveLength(1)
  })

  it("gives up with 503 instead of looping when every retry collides", async () => {
    for (let n = 100; n < 1000; n++) rows.push({ quote_code: `Q-20261019-${n}` })
    const res = await POST(req("Q-20261019-123"))
    expect(res.status).toBe(503)
    expect(rows).toHaveLength(900)
  })
})
