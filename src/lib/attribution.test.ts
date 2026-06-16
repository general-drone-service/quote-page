import { describe, it, expect } from "vitest"
import { parseAdParams, buildAdLead } from "./attribution"

describe("parseAdParams", () => {
  it("gclid → google, fbclid → meta", () => {
    expect(parseAdParams("?gclid=ABC123").platform).toBe("google")
    expect(parseAdParams("?fbclid=XYZ.789").platform).toBe("meta")
  })

  it("gclid wins when both present", () => {
    expect(parseAdParams("?gclid=A&fbclid=B").platform).toBe("google")
  })

  it("utm_source heuristic when no click id", () => {
    expect(parseAdParams("?utm_source=googleads").platform).toBe("google")
    expect(parseAdParams("?utm_source=facebook").platform).toBe("meta")
  })

  it("click ids kept opaque (not lowercased), only capped", () => {
    expect(parseAdParams("?gclid=Cj0KeQ-Xy_Z").gclid).toBe("Cj0KeQ-Xy_Z")
    expect(parseAdParams("?gclid=" + "A".repeat(300)).gclid!.length).toBe(255)
  })

  it("utm sanitised: lowercased + junk stripped", () => {
    expect(parseAdParams("?utm_source=Google%20Ads!").utm_source).toBe("googleads")
  })
})

describe("buildAdLead", () => {
  it("organic (no ad params) → null", () => {
    expect(buildAdLead("", "/", { name: "A" })).toBeNull()
    expect(buildAdLead("?ref=blog", "/")).toBeNull()
  })

  it("full payload from a google click", () => {
    expect(
      buildAdLead("?gclid=ABC&utm_source=googleads&utm_campaign=Spring_2026", "/", {
        name: "Wang",
        address: "台北市…",
      }),
    ).toEqual({
      platform: "google",
      gclid: "ABC",
      fbclid: null,
      utm_source: "googleads",
      utm_campaign: "spring_2026",
      landing_path: "/",
      contact: { name: "Wang", address: "台北市…" },
    })
  })
})
