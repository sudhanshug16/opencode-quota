import { expect, test } from "bun:test"
import { deepSeekCollector, parseDeepSeekBalance } from "../src/deepseek.js"

const now = new Date("2026-09-23T12:00:00Z")
const body = { is_available: true, balance_infos: [
  { currency: "USD", total_balance: "0.00", granted_balance: "0.00", topped_up_balance: "0.00" },
  { currency: "CNY", total_balance: "12.50", granted_balance: "2.50", topped_up_balance: "10.00" },
] }

test("funded currency wins; balance never becomes synthetic percent quota", () => {
  expect(parseDeepSeekBalance(body, "selected", now)).toMatchObject({ status: "available", serviceStatus: "api-available", windows: [],
    account: "selected", credits: [{ id: "total", amount: 12.5, unit: "CNY" }, { id: "granted", amount: 2.5 }, { id: "topped-up", amount: 10 }],
  })
  expect(parseDeepSeekBalance({ ...body, is_available: false, balance_infos: [] }, "a", now)?.serviceStatus).toBe("api-unavailable")
  expect(parseDeepSeekBalance({ ...body, balance_infos: [{ ...body.balance_infos[0], total_balance: "invalid" }] }, "a", now)).toBeUndefined()
})

test("existing key only, fixed balance endpoint, no redirect or secret in output", async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const collector = deepSeekCollector({ account: "a", apiKey: async () => "fake-key", now: () => now, fetch: async (url, init) => {
    calls.push({ url, init }); return Response.json(body)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(calls).toMatchObject([{ url: "https://api.deepseek.com/user/balance", init: { method: "GET", redirect: "manual", headers: { Authorization: "Bearer fake-key" } } }])
  expect(JSON.stringify(result)).not.toContain("fake-key")
  const denied = deepSeekCollector({ account: "a", apiKey: async () => "key", fetch: async () => new Response(null, { status: 401 }) })
  expect((await denied.collect(new AbortController().signal)).reason).toBe("auth")
})
