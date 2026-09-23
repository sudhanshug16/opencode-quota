import { expect, test } from "bun:test"
import { parseZaiQuota, zaiCollector } from "../src/zai.js"

const now = new Date("2026-09-23T12:00:00Z")
const body = { success: true, code: 200, data: { limits: [
  { type: "CREDIT_LIMIT", unit: 3, number: 5, percentage: 50, usage: 100, currentValue: 25, remaining: 70, nextResetTime: now.getTime() + 3_600_000 },
  { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 20, usage: 1000, currentValue: 200, remaining: 800 },
  { type: "TIME_LIMIT", unit: 5, number: 1, percentage: 10, usageDetails: [] },
] } }

test("server quota lanes retain percentages and reset plausibility", () => {
  const result = parseZaiQuota(body, "a", "global", { kind: "personal" }, now)
  expect(result).toMatchObject({ account: "a", windows: [
    { id: "five-hour", used: 30, remaining: 70, resetAt: "2026-09-23T13:00:00.000Z", scope: "credit" },
    { id: "week", used: 20, scope: "tokens" }, { id: "mcp", used: 10, scope: "mcp" },
  ] })
  expect(parseZaiQuota({ ...body, data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: "30" }] } }, "a", "global", { kind: "personal" }, now)).toBeUndefined()
})

test("team selector sends bounded organization/project headers; no secret in result", async () => {
  const seen: { url?: string; init?: RequestInit } = {}
  const collector = zaiCollector({ account: "team-a", region: "bigmodel-cn", scope: { kind: "team", organization: "org", project: "project" }, apiKey: async () => "fake-key", now: () => now, fetch: async (url, init) => {
    seen.url = url; seen.init = init; return Response.json(body)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(seen).toMatchObject({ url: "https://open.bigmodel.cn/api/monitor/usage/quota/limit?type=2", init: { redirect: "manual", headers: { Authorization: "Bearer fake-key", "Bigmodel-Organization": "org", "Bigmodel-Project": "project" } } })
  expect(result.pool).toBe("team:org/project")
  expect(JSON.stringify(result)).not.toContain("fake-key")
  expect(() => zaiCollector({ account: "a", region: "global", scope: { kind: "team", organization: "", project: "p" }, apiKey: async () => "key" })).toThrow()
})
