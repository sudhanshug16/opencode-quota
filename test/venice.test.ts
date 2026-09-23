import { expect, test } from "bun:test"
import { parseVeniceBalance, veniceCollector } from "../src/venice.js"

const now = new Date("2026-09-23T12:00:00Z")
test("Venice USD/DIEM balances and optional epoch allocation are distinct", () => {
  const payload = { canConsume: true, consumptionCurrency: "DIEM", balances: { usd: "5.25", diem: 40 }, diemEpochAllocation: 100 }
  expect(parseVeniceBalance(payload, "selected", now)).toMatchObject({ status: "available", serviceStatus: "can-consume", windows: [{ id: "diem-epoch", kind: "credit", unit: "DIEM", limit: 100, used: 60, remaining: 40 }], credits: [{ id: "usd", amount: 5.25 }, { id: "diem", amount: 40 }] })
  expect(parseVeniceBalance({ ...payload, canConsume: false, diemEpochAllocation: null }, "selected", now)).toMatchObject({ serviceStatus: "cannot-consume", windows: [], credits: [{ amount: 5.25 }, { amount: 40 }] })
  expect(parseVeniceBalance({ ...payload, balances: { diem: "invalid" } }, "selected", now)).toBeUndefined()
})

test("Venice selected bearer key uses fixed billing endpoint", async () => {
  const urls: string[] = []
  const collector = veniceCollector({ account: "selected", apiKey: async () => "fake-key", now: () => now, fetch: async (url, init) => {
    urls.push(url); expect(init).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer fake-key" } })
    return Response.json({ canConsume: true, balances: { usd: 10 } })
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(urls).toEqual(["https://api.venice.ai/api/v1/billing/balance"])
  expect(result.windows).toEqual([])
  expect(JSON.stringify(result)).not.toContain("fake-key")
})
