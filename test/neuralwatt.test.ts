import { expect, test } from "bun:test"
import { neuralwattCollector, parseNeuralwattQuota } from "../src/neuralwatt.js"

const now = new Date("2026-09-23T12:00:00Z")
const body = { balance: { credits_remaining_usd: 18.5, credits_used_usd: 11.5, total_credits_usd: 30 },
  subscription: { kwh_included: 100, kwh_used: 35, kwh_remaining: 65, status: "active", current_period_start: "2026-09-01T00:00:00Z", current_period_end: "2026-10-01T00:00:00Z" },
  key: { allowance: { limit_usd: 20, spent_usd: 6, remaining_usd: 14, period: "monthly" } },
  usage: { current_month: { cost_usd: 4.5, energy_kwh: 9 } } }

test("Neuralwatt kWh subscription, prepaid USD and key cap are separate", () => {
  expect(parseNeuralwattQuota(body, "selected", now)).toMatchObject({ status: "available", serviceStatus: "active",
    windows: [{ id: "subscription-kwh", unit: "kWh", used: 35, limit: 100, remaining: 65, resetAt: "2026-10-01T00:00:00.000Z" },
      { id: "key-allowance", unit: "USD", used: 6, limit: 20, remaining: 14, scope: "monthly" }],
    credits: [{ id: "prepaid", amount: 18.5, unit: "USD" }],
    usage: [{ id: "month-cost", amount: 4.5 }, { id: "month-energy", amount: 9 }] })
  expect(parseNeuralwattQuota({ balance: { total_credits_usd: 30, credits_used_usd: 11 }, key: { allowance: { blocked: true } } }, "selected", now)).toMatchObject({ credits: [{ amount: 19 }], windows: [], serviceStatus: "key-blocked" })
  expect(parseNeuralwattQuota({ balance: {} }, "selected", now)).toBeUndefined()
})

test("fixed catalog API host; rejected key has no artificial exhausted window", async () => {
  const urls: string[] = []
  const collector = neuralwattCollector({ account: "selected", apiKey: async () => "fake", now: () => now, fetch: async (url, init) => {
    urls.push(url); expect(init).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer fake" } })
    return Response.json(body)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(urls).toEqual(["https://api.neuralwatt.com/v1/quota"])
  expect(JSON.stringify(result)).not.toContain("fake")
  expect((await neuralwattCollector({ account: "selected", apiKey: async () => "fake", fetch: async () => new Response("no", { status: 403 }) }).collect(new AbortController().signal))).toMatchObject({ status: "unavailable", reason: "auth", windows: [] })
})
