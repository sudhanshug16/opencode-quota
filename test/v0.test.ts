import { expect, test } from "bun:test"
import { parseV0Usage, v0Collector } from "../src/v0.js"

const now = new Date("2026-09-23T12:00:00Z")
const token = { billingType: "token", data: { balance: { total: 500, remaining: 275 }, billingCycle: { end: 1790812800 }, onDemand: { balance: 12.5 } } }
const rate = { limit: 100, remaining: 70, reset: 1790172000 }

test("v0 token billing vs legacy quota and separate rate-limit units", () => {
  expect(parseV0Usage(token, rate, "selected", now)).toMatchObject({ serviceStatus: "token", windows: [
    { id: "billing", kind: "credit", limit: 500, used: 225, remaining: 275, unit: "provider-billing-units" },
    { id: "rate-limit", kind: "rolling", limit: 100, used: 30, remaining: 70, unit: "provider-rate-units" }],
    credits: [{ id: "on-demand", amount: 12.5, unit: "provider-billing-units" }] })
  expect(parseV0Usage({ billingType: "legacy", data: { limit: 50, remaining: 10 } }, rate, "selected", now)?.windows[0]).toMatchObject({ limit: 50, used: 40 })
  expect(parseV0Usage({ billingType: "token", data: { balance: { total: 500 } } }, rate, "selected", now)).toBeUndefined()
  expect(parseV0Usage(token, { limit: "100", remaining: 70 }, "selected", now)).toBeUndefined()
})

test("selected key and optional nonsecret project scope stay on both fixed v0 paths", async () => {
  const urls: string[] = []
  const collector = v0Collector({ account: "selected", scope: "project /demo", apiKey: async () => "fake", now: () => now, fetch: async (url, init) => {
    urls.push(url)
    expect(init).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer fake" } })
    return Response.json(url.includes("/billing") ? token : rate)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(urls).toEqual(["https://api.v0.dev/v1/user/billing?scope=project%20%2Fdemo", "https://api.v0.dev/v1/rate-limits?scope=project%20%2Fdemo"])
  expect(result.pool).toBe("v0:selected:project /demo")
  expect(JSON.stringify(result)).not.toContain("fake")
  expect((await v0Collector({ account: "selected", apiKey: async () => "fake", fetch: async url => url.includes("/billing") ? Response.json(token) : new Response("denied", { status: 403 }) }).collect(new AbortController().signal))).toMatchObject({ status: "unavailable", reason: "auth", windows: [] })
})
