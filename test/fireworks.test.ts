import { expect, test } from "bun:test"
import { fireworksCollector, parseFireworksSummary } from "../src/fireworks.js"

const now = new Date("2026-09-23T12:00:00Z")
const body = { lineItems: [
  { totalCost: { currencyCode: "USD", units: "1", nanos: 250000000 } },
  { totalCost: { currencyCode: "USD", units: "2", nanos: 750000000 } },
  { totalCost: { currencyCode: "EUR", units: "100", nanos: 0 } },
] }

test("rated lines retain first currency and report spend, never quota", () => {
  expect(parseFireworksSummary(body, "selected", "slug", now)).toMatchObject({ pool: "account:slug", windows: [],
    usage: [{ id: "last-30-days-spend", amount: 4, currency: "USD", authority: "provider" }],
  })
  expect(parseFireworksSummary({ lineItems: [] }, "a", "slug", now)).toBeUndefined()
  expect(() => fireworksCollector({ account: "a", accountSlug: "../escape", apiKey: async () => "key" })).toThrow()
})

test("selected account path and exact 30-day UTC range use existing key only", async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const collector = fireworksCollector({ account: "selected", accountSlug: "my-account", apiKey: async () => "fake-key", now: () => now, fetch: async (url, init) => {
    calls.push({ url, init }); return Response.json(body)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(calls).toMatchObject([{ url: "https://api.fireworks.ai/v1/accounts/my-account/billing/summary?startTime=2026-08-24T12%3A00%3A00Z&endTime=2026-09-23T12%3A00%3A00Z", init: { redirect: "manual", headers: { Authorization: "Bearer fake-key" } } }])
  expect(JSON.stringify(result)).not.toContain("fake-key")
})
