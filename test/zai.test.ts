import { expect, test } from "bun:test"
import { parseZaiCnBalance, parseZaiModelUsage, parseZaiQuota, zaiCollector } from "../src/zai.js"

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

test("CN PAYG balance prefers available value; null is unknown, not zero", () => {
  expect(parseZaiCnBalance({ success: true, data: { availableBalance: "12.50", balance: "25" } })).toBe(12.5)
  expect(parseZaiCnBalance({ success: true, data: { availableBalance: null, balance: "25" } })).toBe(25)
  expect(parseZaiCnBalance({ success: true, data: { availableBalance: null, balance: null } })).toBeUndefined()
  expect(parseZaiCnBalance({ success: false, data: { balance: 5 } })).toBeUndefined()
})

test("optional CN balance is key-bound and independent of Coding Plan quota", async () => {
  const urls: string[] = []
  const collector = zaiCollector({ account: "selected", region: "bigmodel-cn", scope: { kind: "personal" }, includeCnBalance: true,
    apiKey: async () => "fake-key", now: () => now, fetch: async (url, init) => {
      urls.push(url)
      expect(init).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer fake-key" } })
      return Response.json(url.includes("query-customer-account-report") ? { success: true, data: { availableBalance: "14.25" } } : body)
    } })
  const result = await collector.collect(new AbortController().signal)
  expect(urls).toEqual(["https://open.bigmodel.cn/api/monitor/usage/quota/limit", "https://www.bigmodel.cn/api/biz/account/query-customer-account-report"])
  expect(result).toMatchObject({ status: "available", credits: [{ id: "cn-payg", amount: 14.25, unit: "CNY" }] })
  expect(result.windows).toHaveLength(3)
  expect(JSON.stringify(result)).not.toContain("fake-key")
  const failed = zaiCollector({ account: "selected", region: "bigmodel-cn", scope: { kind: "personal" }, includeCnBalance: true,
    apiKey: async () => "fake-key", now: () => now, fetch: async url => url.includes("query-customer-account-report") ? new Response("denied", { status: 403 }) : Response.json(body) })
  const failedResult = await failed.collect(new AbortController().signal)
  expect(failedResult.status).toBe("available")
  expect(failedResult.windows[0]?.id).toBe("five-hour")
  expect(failedResult.credits).toBeUndefined()
  const teamUrls: string[] = []
  await zaiCollector({ account: "team", region: "bigmodel-cn", scope: { kind: "team", organization: "o", project: "p" }, includeCnBalance: true,
    apiKey: async () => "fake-key", fetch: async url => { teamUrls.push(url); return Response.json(body) } }).collect(new AbortController().signal)
  expect(teamUrls).toHaveLength(1)
})

test("z.ai model series are bounded historical tokens, not quota", async () => {
  const history = { success: true, code: 200, data: { x_time: ["hour-1", "hour-2"], modelDataList: [
    { modelName: "GLM", tokensUsage: [12, 20] }, { modelName: "other", tokensUsage: [0, 4] },
  ] } }
  expect(parseZaiModelUsage(history)).toEqual([{ name: "GLM", tokens: 32 }, { name: "other", tokens: 4 }])
  expect(parseZaiModelUsage({ ...history, data: { ...history.data, x_time: [] } })).toEqual([])
  expect(parseZaiModelUsage({ ...history, data: { ...history.data, modelDataList: [{ modelName: "bad", tokensUsage: [NaN] }] } })).toBeUndefined()
  const urls: string[] = []
  const collector = zaiCollector({ account: "selected", region: "global", scope: { kind: "personal" }, includeModelUsage: true,
    apiKey: async () => "fake", now: () => now, fetch: async (url, init) => {
      urls.push(url)
      expect(init).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer fake" } })
      return Response.json(url.includes("model-usage") ? history : body)
    } })
  const result = await collector.collect(new AbortController().signal)
  expect(urls).toHaveLength(3)
  expect(urls[1]).toContain("/api/monitor/usage/model-usage?startTime=")
  expect(urls[2]).toContain("/api/monitor/usage/model-usage?startTime=")
  expect(result.usage).toMatchObject([{ id: "model-1d:GLM", amount: 32, unit: "tokens", period: "hourly-history" },
    { id: "model-1d:other", amount: 4 }, { id: "model-30d:GLM", amount: 32 }, { id: "model-30d:other", amount: 4 }])
  expect(result.windows).toHaveLength(3)
  expect(JSON.stringify(result)).not.toContain("fake")
  const denied = zaiCollector({ account: "selected", region: "global", scope: { kind: "personal" }, includeModelUsage: true,
    apiKey: async () => "fake", now: () => now, fetch: async url => url.includes("model-usage") ? new Response("denied", { status: 403 }) : Response.json(body) })
  const quota = await denied.collect(new AbortController().signal)
  expect(quota.status).toBe("available")
  expect(quota.usage).toBeUndefined()
})
