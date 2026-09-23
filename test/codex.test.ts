import { expect, test } from "bun:test"
import { codexAccess, codexCollector, parseCodexUsage } from "../src/codex.js"

const now = new Date("2026-09-23T12:00:00Z")
const body = { account_id: "account-1", plan_type: "plus", rate_limit: {
  primary_window: { used_percent: 30, reset_at: 1790172000, limit_window_seconds: 18000 },
  secondary_window: { used_percent: 15, reset_at: 1790683200, limit_window_seconds: 604800 },
}, credits: { has_credits: true, unlimited: false, balance: "12.5" }, additional_rate_limits: [
  { limit_name: "spark", rate_limit: { primary_window: { used_percent: 5, reset_at: 1790172000, limit_window_seconds: 18000 } } },
] }

test("wham windows, named limits and credits remain bound to account", () => {
  expect(parseCodexUsage(body, "selected", "account-1", now)).toMatchObject({ account: "selected", pool: "chatgpt:account-1", serviceStatus: "plus",
    windows: [{ id: "primary", used: 30, resetAt: expect.any(String) }, { id: "secondary", used: 15, kind: "weekly" }, { id: "spark:primary", used: 5 }],
    credits: [{ id: "balance", amount: 12.5, unit: "credits" }],
  })
  expect(parseCodexUsage(body, "selected", "account-2", now)).toBeUndefined()
  expect(parseCodexUsage({ rate_limit: { primary_window: { used_percent: "30", reset_at: 0, limit_window_seconds: 18000 } } }, "a", "id", now)).toBeUndefined()
  expect(parseCodexUsage({ ...body, rate_limit: { ...body.rate_limit, primary_window: { used_percent: "30" } }, additional_rate_limits: "malformed" }, "selected", "account-1", now)?.windows.map(window => window.id)).toEqual(["secondary"])
})

test("selected OpenCode OAuth method/account/expiry gate and exact wham request", async () => {
  const oauth = { type: "oauth", methodID: "chatgpt-browser", metadata: { accountID: "account-1" }, access: "fake-access", expires: now.getTime() + 3_600_000 }
  expect(codexAccess(oauth, "account-1", now.getTime())).toBe("fake-access")
  expect(codexAccess(oauth, "account-2", now.getTime())).toBeUndefined()
  expect(codexAccess({ ...oauth, methodID: "other" }, "account-1", now.getTime())).toBeUndefined()
  expect(codexAccess({ ...oauth, expires: now.getTime() + 1_000 }, "account-1", now.getTime())).toBeUndefined()
  const seen: { url?: string; init?: RequestInit } = {}
  const collector = codexCollector({ account: "selected", accountId: "account-1", accessToken: async () => "fake-access", now: () => now, fetch: async (url, init) => {
    seen.url = url; seen.init = init; return Response.json(body)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(seen).toMatchObject({ url: "https://chatgpt.com/backend-api/wham/usage", init: { redirect: "manual", headers: { Authorization: "Bearer fake-access", "ChatGPT-Account-Id": "account-1" } } })
  expect(JSON.stringify(result)).not.toContain("fake-access")
})
