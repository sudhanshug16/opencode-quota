import { expect, test } from "bun:test"
import { chutesCollector, parseChutesQuota, parseChutesSubscription } from "../src/chutes.js"

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

test("inactive subscription uses pinned quota list and per-chute usage without inventing a plan", async () => {
  const urls: string[] = []
  const collector = chutesCollector({ account: "selected", apiKey: async () => "fake-key", now: () => now, fetch: async (url, init) => {
    urls.push(url)
    expect(init).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer fake-key" } })
    if (url.endsWith("subscription_usage")) return Response.json({ subscription: { active: false, status: "free" } })
    if (url.endsWith("/quotas")) return Response.json([{ chute_id: "0", is_default: true, quota: 100 }])
    return Response.json({ quota: 100, used: 10 })
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(urls).toEqual(["https://api.chutes.ai/users/me/subscription_usage", "https://api.chutes.ai/users/me/quotas", "https://api.chutes.ai/users/me/quota_usage/0"])
  expect(result).toMatchObject({ serviceStatus: "inactive", windows: [{ id: "quota:0", scope: "chute:0", kind: "other", used: 10, limit: 100, remaining: 90 }] })
  expect(JSON.stringify(result)).not.toContain("fake-key")
  expect(parseChutesQuota({ quota: 100, used: 25, window_minutes: 240 }, "rolling")).toMatchObject({ kind: "rolling", used: 25 })
})

test("wrapped quota list and failed enrichment never erase subscription", async () => {
  const partial = { subscription: { active: true, plan_name: "Pro" }, monthly: { used: 250, limit: 1000 } }
  const collector = chutesCollector({ account: "selected", apiKey: async () => "fake-key", now: () => now, fetch: async url => {
    if (url.endsWith("subscription_usage")) return Response.json(partial)
    if (url.endsWith("/quotas")) return Response.json({ data: [{ chute_id: "wrapped", quota: 200, window_minutes: 240 }] })
    return Response.json({ quota: 200, used: 50 })
  } })
  expect((await collector.collect(new AbortController().signal)).windows).toMatchObject([
    { id: "monthly", used: 250 }, { id: "quota:wrapped", used: 50, kind: "rolling" },
  ])
  const failed = chutesCollector({ account: "selected", apiKey: async () => "fake-key", fetch: async url => url.endsWith("subscription_usage") ? Response.json(partial) : new Response("no", { status: 500 }) })
  const result = await failed.collect(new AbortController().signal)
  expect(result.status).toBe("available")
  expect(result.windows).toHaveLength(1)
  const denied = chutesCollector({ account: "selected", apiKey: async () => "fake-key", fetch: async url => url.endsWith("subscription_usage") ? Response.json(partial) : new Response("no", { status: 403 }) })
  expect(await denied.collect(new AbortController().signal)).toMatchObject({ status: "unavailable", reason: "auth", windows: [] })
  const missing = chutesCollector({ account: "selected", apiKey: async () => "fake-key", now: () => now, fetch: async url =>
    url.endsWith("subscription_usage") ? Response.json({ subscription: { active: true } }) : url.endsWith("/quotas")
      ? Response.json({ rolling_window: { requests: 40, limit: 100 } }) : new Response("no", { status: 404 }) })
  expect((await missing.collect(new AbortController().signal)).windows).toMatchObject([{ id: "rolling", used: 40 }])
  const empty = chutesCollector({ account: "selected", apiKey: async () => "fake-key", fetch: async url =>
    Response.json(url.endsWith("subscription_usage") ? { subscription: { active: true } } : { quotas: [] }) })
  expect(await empty.collect(new AbortController().signal)).toMatchObject({ status: "unavailable", reason: "invalid_response", windows: [] })
})
