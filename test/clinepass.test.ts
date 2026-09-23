import { expect, test } from "bun:test"
import { clinePassCollector, parseClinePassUsage } from "../src/clinepass.js"

const now = new Date("2026-09-23T12:00:00Z")
const body = { success: true, data: { limits: [
  { type: "weekly", percentUsed: 25, resetsAt: "2026-09-28T00:00:00Z" },
  { type: "five_hour", percentUsed: 12.5, resetsAt: "2026-09-23T17:00:00Z" },
  { type: "monthly", percentUsed: 100.5 },
  { type: "unknown", percentUsed: "ignored" },
] } }

test("ClinePass subscription lanes, resets and upstream clamp", () => {
  expect(parseClinePassUsage(body, "selected", now)).toMatchObject({ status: "available", windows: [
    { id: "five_hour", kind: "rolling", used: 12.5, remaining: 87.5, resetAt: "2026-09-23T17:00:00.000Z" },
    { id: "weekly", kind: "weekly", used: 25, resetAt: "2026-09-28T00:00:00.000Z" },
    { id: "monthly", kind: "monthly", used: 100, remaining: 0 },
  ] })
  expect(parseClinePassUsage({ success: false, data: { limits: [] } }, "selected", now)).toBeUndefined()
  expect(parseClinePassUsage({ success: true, data: { limits: [{ type: "weekly", percentUsed: "25" }] } }, "selected", now)).toBeUndefined()
  expect(parseClinePassUsage({ success: true, data: { limits: [{ type: "weekly", percentUsed: 25, resetsAt: "invalid" }] } }, "selected", now)).toBeUndefined()
})

test("fixed bearer endpoint and failed auth never yields zero quota", async () => {
  const requests: string[] = []
  const collector = clinePassCollector({ account: "selected", apiKey: async () => "fake", now: () => now, fetch: async (url, init) => {
    requests.push(url)
    expect(init).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer fake" } })
    return Response.json(body)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(requests).toEqual(["https://api.cline.bot/api/v1/users/me/plan/usage-limits"])
  expect(JSON.stringify(result)).not.toContain("fake")
  expect(result.windows).toHaveLength(3)
  const denied = clinePassCollector({ account: "selected", apiKey: async () => "fake", fetch: async () => new Response("no", { status: 401 }) })
  expect(await denied.collect(new AbortController().signal)).toMatchObject({ status: "unavailable", reason: "auth", windows: [] })
})
