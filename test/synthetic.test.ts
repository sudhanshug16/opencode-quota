import { expect, test } from "bun:test"
import { parseSyntheticQuota, syntheticCollector } from "../src/synthetic.js"

const now = new Date("2026-09-23T12:00:00Z")
const generic = { plan: "Starter", quotas: [
  { name: "Monthly", limit: 1000, used: 250, reset_at: "2026-10-01T00:00:00Z" },
  { name: "Daily", max: 200, remaining: 50, window_minutes: 1440 },
] }
const named = { weeklyTokenLimit: { nextRegenAt: "2026-09-24T00:00:00Z", percentRemaining: 98,
  maxCredits: "$36.00", remainingCredits: "$35.30" }, search: { hourly: { limit: 250, requests: 2 } } }

test("Synthetic generic and named lanes preserve denominators and weekly credit cap", () => {
  expect(parseSyntheticQuota(generic, "selected", now)).toMatchObject({ serviceStatus: "Starter", windows: [
    { id: "quota-0", kind: "monthly", unit: "provider-quota-units", limit: 1000, used: 250, remaining: 750, resetAt: "2026-10-01T00:00:00.000Z" },
    { id: "quota-1", kind: "rolling", unit: "provider-quota-units", limit: 200, used: 150, remaining: 50 },
  ] })
  expect(parseSyntheticQuota(named, "selected", now)).toMatchObject({ windows: [
    { id: "weekly-tokens", kind: "weekly", unit: "percent", limit: 100, used: 2 },
    { id: "search-hourly", kind: "rolling", unit: "requests", limit: 250, used: 2 },
    { id: "weekly-credits", kind: "weekly", unit: "USD", limit: 36, remaining: 35.3 },
  ] })
  expect(parseSyntheticQuota({ quotas: [{ name: "unknown" }] }, "selected", now)).toBeUndefined()
})

test("Synthetic selected bearer key uses pinned fixed endpoint", async () => {
  const urls: string[] = []
  const collector = syntheticCollector({ account: "selected", apiKey: async () => "fake", now: () => now, fetch: async (url, init) => {
    urls.push(url); expect(init).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer fake" } })
    return Response.json(generic)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(urls).toEqual(["https://api.synthetic.new/v2/quotas"])
  expect(result.status).toBe("available")
  expect(JSON.stringify(result)).not.toContain("fake")
  expect(await syntheticCollector({ account: "selected", apiKey: async () => "fake", fetch: async () => new Response("denied", { status: 403 }) }).collect(new AbortController().signal)).toMatchObject({ status: "unavailable", reason: "auth", windows: [] })
})
