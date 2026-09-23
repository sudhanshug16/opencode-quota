import { expect, test } from "bun:test"
import { alibabaCollector, parseAlibabaQuota } from "../src/alibaba.js"

const now = new Date("2026-09-23T12:00:00Z")
const quota = { per5HourUsedQuota: 52, per5HourTotalQuota: 1000, per5HourQuotaNextRefreshTime: 1790182800000,
  perWeekUsedQuota: 800, perWeekTotalQuota: 5000, perWeekQuotaNextRefreshTime: 1790812800000 }
const body = { data: { codingPlanInstanceInfos: [{ planName: "Alibaba Coding Plan Pro", status: "VALID", codingPlanQuotaInfo: quota }] } }

test("Alibaba key quota stays on uniquely active plan instance", () => {
  expect(parseAlibabaQuota(body, "selected", "intl", now)).toMatchObject({ serviceStatus: "Alibaba Coding Plan Pro", windows: [
    { id: "five-hour", kind: "rolling", unit: "provider-quota-units", used: 52, limit: 1000, remaining: 948 },
    { id: "weekly", kind: "weekly", used: 800, limit: 5000, remaining: 4200 },
  ] })
  const multiple = { data: { codingPlanInstanceInfos: [body.data.codingPlanInstanceInfos[0], { ...body.data.codingPlanInstanceInfos[0], planName: "second" }] } }
  expect(parseAlibabaQuota(multiple, "selected", "intl", now)).toBeUndefined()
  expect(parseAlibabaQuota({ data: { codingPlanInstanceInfos: [{ status: "VALID", planName: "Pro" }] } }, "selected", "cn", now)).toMatchObject({ status: "available", windows: [], serviceStatus: "Pro" })
  expect(parseAlibabaQuota({ data: { codingPlanInstanceInfos: [{ planName: "Pro" }] } }, "selected", "cn", now)).toBeUndefined()
})

test("selected regional Coding Plan key uses fixed POST and no other region", async () => {
  const seen: { url?: string; init?: RequestInit } = {}
  const collector = alibabaCollector({ account: "selected", region: "cn", apiKey: async () => "fake", now: () => now, fetch: async (url, init) => {
    seen.url = url; seen.init = init
    return Response.json(body)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(new URL(seen.url!).origin).toBe("https://bailian.console.aliyun.com")
  expect(new URL(seen.url!).searchParams.get("currentRegionId")).toBe("cn-beijing")
  expect(seen.init).toMatchObject({ method: "POST", redirect: "manual", headers: {
    Authorization: "Bearer fake", "x-api-key": "fake", "X-DashScope-API-Key": "fake", Origin: "https://bailian.console.aliyun.com" } })
  expect(JSON.parse(String(seen.init?.body))).toEqual({ queryCodingPlanInstanceInfoRequest: { commodityCode: "sfm_codingplan_public_cn" } })
  expect(result.status).toBe("available")
  expect(JSON.stringify(result)).not.toContain("fake")
  expect(await alibabaCollector({ account: "selected", region: "cn", apiKey: async () => "fake", fetch: async () => new Response("no", { status: 403 }) }).collect(new AbortController().signal)).toMatchObject({ status: "unavailable", reason: "auth", windows: [] })
})
