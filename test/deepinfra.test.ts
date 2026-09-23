import { expect, test } from "bun:test"
import { deepInfraCollector, parseDeepInfraUsage } from "../src/deepinfra.js"

const now = new Date("2026-09-23T12:00:00Z")
const checklist = { stripe_balance: -25, recent: 5, limit: 100, suspended: false }
const usage = { months: [{ period: "2026-08", total_cost: 1000 }, { period: "2026-09", total_cost: 1750 }] }

test("checklist USD and usage cents stay distinct; limit only when supplied", () => {
  expect(parseDeepInfraUsage(checklist, usage, "selected", now)).toMatchObject({ status: "available", pool: "deepinfra:selected",
    credits: [{ id: "available-balance", amount: 20, unit: "USD" }],
    usage: [{ id: "recent-spend", amount: 5 }, { id: "current-month-spend", amount: 17.5 }],
    windows: [{ id: "spending-limit", kind: "credit", limit: 100, used: 5, remaining: 95, unit: "USD" }] })
  expect(parseDeepInfraUsage({ ...checklist, stripe_balance: 30, limit: null, suspended: true }, { months: [] }, "selected", now)).toMatchObject({ credits: [{ amount: 0 }], usage: [{ amount: 5 }, { amount: 5 }, { id: "amount-owed", amount: 35 }], windows: [], serviceStatus: "suspended" })
  expect(parseDeepInfraUsage({ ...checklist, recent: "5" }, usage, "selected", now)).toBeUndefined()
  expect(parseDeepInfraUsage(checklist, { months: [{ period: "2026-09", total_cost: "1750" }] }, "selected", now)).toBeUndefined()
})

test("selected bearer key makes two fixed requests; second failure never fabricates balance", async () => {
  const urls: string[] = []
  const collector = deepInfraCollector({ account: "selected", apiKey: async () => "fake-key", now: () => now, fetch: async (url, init) => {
    urls.push(url)
    expect(init?.redirect).toBe("manual")
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer fake-key")
    return Response.json(url.includes("checklist") ? checklist : usage)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(urls).toEqual(["https://api.deepinfra.com/payment/checklist?compute_owed=true", "https://api.deepinfra.com/payment/usage?from=current"])
  expect(JSON.stringify(result)).not.toContain("fake-key")
  expect(result.status).toBe("available")
  const rejected = deepInfraCollector({ account: "selected", apiKey: async () => "fake", fetch: async url => url.includes("checklist") ? Response.json(checklist) : new Response("denied", { status: 403 }) })
  expect(await rejected.collect(new AbortController().signal)).toMatchObject({ status: "unavailable", reason: "auth", windows: [] })
})
