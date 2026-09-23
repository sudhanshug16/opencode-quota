import { expect, test } from "bun:test"
import { moonshotCollector, parseMoonshotBalance } from "../src/moonshot.js"

const now = new Date("2026-09-23T12:00:00Z")
const body = { code: 0, scode: "0", status: true, data: { available_balance: 5, cash_balance: -2, voucher_balance: 7 } }

test("regional balances preserve currency and deficit without inventing quota", () => {
  expect(parseMoonshotBalance(body, "account", "china", now)).toMatchObject({ account: "account", pool: "moonshot-china", windows: [],
    credits: [{ id: "available", amount: 5, unit: "CNY" }, { id: "cash", amount: -2 }, { id: "voucher", amount: 7 }],
  })
  expect(parseMoonshotBalance({ ...body, code: 1 }, "a", "global", now)).toBeUndefined()
  expect(parseMoonshotBalance({ ...body, data: { available_balance: null, cash_balance: 1, voucher_balance: 2 } }, "a", "global", now)).toBeUndefined()
})

test("selected region and existing key select fixed HTTPS endpoint", async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const collector = moonshotCollector({ account: "a", region: "global", apiKey: async () => "fake-key", now: () => now, fetch: async (url, init) => {
    calls.push({ url, init }); return Response.json(body)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(calls).toMatchObject([{ url: "https://api.moonshot.ai/v1/users/me/balance", init: { method: "GET", redirect: "manual", headers: { Authorization: "Bearer fake-key" } } }])
  expect(result.credits?.[0]?.unit).toBe("USD")
  expect(JSON.stringify(result)).not.toContain("fake-key")
  expect(() => moonshotCollector({ account: "a", region: "invalid" as "global", apiKey: async () => "key" })).toThrow()
})
