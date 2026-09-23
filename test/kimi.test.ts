import { expect, test } from "bun:test"
import { kimiCollector, parseKimiCodeUsage } from "../src/kimi.js"

const now = new Date("2026-09-23T12:00:00Z")
const body = { usages: { limit_5h: { used_ratio: 0.2, reset_time: "2026-09-23T17:00:00Z" }, limit_7d: { used_ratio: 0.45, reset_time: "2026-09-28T00:00:00Z" }, limit_month_total: { used_ratio: 0.7, reset_time: "2026-10-01T00:00:00Z" } },
  user: { membership: { level: "LEVEL_BASIC" } } }

test("Kimi Code fractions are quotas, distinct session/weekly/total pools", () => {
  expect(parseKimiCodeUsage(body, "selected", "international", now)).toMatchObject({ status: "available", pool: "kimi:international:selected", source: "https://api.kimi.ai/coding/v1/usages",
    windows: [{ id: "weekly", kind: "weekly", used: 45, remaining: 55 }, { id: "five-hour", kind: "rolling", used: 20, resetAt: "2026-09-23T17:00:00.000Z" }, { id: "monthly-total", kind: "monthly", used: 70 }] })
  expect(parseKimiCodeUsage({ usages: { limit_5h: { used_ratio: 0.5 } } }, "selected", "china", now)?.windows).toMatchObject([{ id: "five-hour", used: 50 }])
  expect(parseKimiCodeUsage({ usages: { limit_5h: { used_ratio: "0.5" } } }, "selected", "china", now)).toBeUndefined()
})

test("legacy Code counters and same-clock zero-ratio fallback", () => {
  const legacy = { usage: { limit: "100", used: "40", reset_time: "2026-09-28T00:00:00Z" }, limits: [{ detail: { limit: "20", remaining: "15", reset_time: "2026-09-23T17:00:00Z" } }] }
  expect(parseKimiCodeUsage(legacy, "selected", "china", now)?.windows).toMatchObject([{ id: "weekly", unit: "requests", limit: 100, used: 40 }, { id: "five-hour", unit: "requests", limit: 20, used: 5 }])
  expect(parseKimiCodeUsage({ ...legacy, usages: { limit_7d: { used_ratio: 0, reset_time: "2026-09-28T00:00:00.500Z" } } }, "selected", "china", now)?.windows[0]).toMatchObject({ id: "weekly", unit: "requests", used: 40 })
})

test("regional fixed endpoint, bearer key and unavailable response", async () => {
  const urls: string[] = []
  const collector = kimiCollector({ account: "selected", region: "china", apiKey: async () => "fake", now: () => now, fetch: async (url, init) => {
    urls.push(url)
    expect(init).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer fake" } })
    return Response.json(body)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(urls).toEqual(["https://api.kimi.com/coding/v1/usages"])
  expect(JSON.stringify(result)).not.toContain("fake")
  expect((await kimiCollector({ account: "selected", region: "china", apiKey: async () => "fake", fetch: async () => new Response("no", { status: 403 }) }).collect(new AbortController().signal))).toMatchObject({ status: "unavailable", reason: "auth", windows: [] })
})
