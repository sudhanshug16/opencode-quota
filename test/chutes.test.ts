import { expect, test } from "bun:test"
import { chutesCollector, parseChutesSubscription } from "../src/chutes.js"

const now = new Date("2026-09-23T12:00:00Z")
const body = { subscription: { active: true, plan_name: "Pro", current_period_end: "2026-10-01T00:00:00Z" },
  monthly: { used: 250, limit: 1000, resets_at: "2026-10-01T00:00:00Z", unit: "credits" },
  rolling_window: { requests: 40, limit: 100, window_minutes: 240, reset_at: "2026-09-23T16:00:00Z", unit: "requests" } }

test("pinned Chutes subscription fixture preserves counts, plan and distinct resets", () => {
  expect(parseChutesSubscription(body, "selected", now)).toMatchObject({ status: "available", serviceStatus: "Pro", windows: [
    { id: "rolling", kind: "rolling", unit: "requests", used: 40, limit: 100, remaining: 60, resetAt: "2026-09-23T16:00:00.000Z" },
    { id: "monthly", kind: "monthly", unit: "credits", used: 250, limit: 1000, remaining: 750, resetAt: "2026-10-01T00:00:00.000Z" },
  ] })
  expect(parseChutesSubscription({ subscription: { active: false } }, "selected", now)).toMatchObject({ status: "available", serviceStatus: "inactive", windows: [] })
  expect(parseChutesSubscription({ subscription: { active: true } }, "selected", now)).toBeUndefined()
  expect(parseChutesSubscription({ monthly: { percent_used: 25 } }, "selected", now)?.windows).toMatchObject([{ id: "monthly", unit: "percent", used: 25 }])
})

test("selected Chutes key uses only subscription endpoint and auth failure hides quota", async () => {
  const urls: string[] = []
  const collector = chutesCollector({ account: "selected", apiKey: async () => "fake-key", now: () => now, fetch: async (url, init) => {
    urls.push(url)
    expect(init).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer fake-key" } })
    return Response.json(body)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(urls).toEqual(["https://api.chutes.ai/users/me/subscription_usage"])
  expect(JSON.stringify(result)).not.toContain("fake-key")
  expect((await chutesCollector({ account: "selected", apiKey: async () => "fake-key", fetch: async () => new Response("no", { status: 403 }) }).collect(new AbortController().signal))).toMatchObject({ status: "unavailable", reason: "auth", windows: [] })
})
