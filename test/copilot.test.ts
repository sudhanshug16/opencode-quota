import { expect, test } from "bun:test"
import { copilotAccess, copilotCollector, parseCopilotUsage } from "../src/copilot.js"

const now = new Date("2026-09-23T12:00:00Z")
const direct = { copilot_plan: "pro", quota_reset_date: "2026-10-01T00:00:00Z", quota_snapshots: {
  premium_interactions: { entitlement: 300, remaining: 225, percent_remaining: 75, credits_used: 7, quota_id: "premium" },
  chat: { entitlement: 1000, remaining: 900, percent_remaining: 90, quota_id: "chat" },
} }

test("premium/chat windows, reset and real credits-used counter", () => {
  expect(parseCopilotUsage(direct, "selected", now)).toMatchObject({ status: "available", serviceStatus: "pro",
    windows: [{ id: "premium", used: 25, remaining: 75, resetAt: "2026-10-01T00:00:00.000Z" }, { id: "chat", used: 10 }],
    usage: [{ id: "premium-credits", amount: 7, authority: "provider", unit: "credits" }],
  })
  expect(parseCopilotUsage({ copilot_plan: "business", token_based_billing: true, quota_snapshots: { premium_interactions: { entitlement: 0, remaining: 0, percent_remaining: 100, credits_used: 0 } } }, "selected", now)).toMatchObject({ windows: [], usage: [{ amount: 0 }] })
  expect(parseCopilotUsage({ monthly_quotas: { completions: "300", chat: 0 }, limited_user_quotas: { completions: "90", chat: 0 } }, "selected", now)?.windows).toMatchObject([{ id: "premium", used: 70 }])
  expect(parseCopilotUsage({ quota_snapshots: { chat: { entitlement: 0, remaining: 0, percent_remaining: 100 } } }, "selected", now)).toBeUndefined()
})

test("only selected GitHub device OAuth token; public host and no redirect", async () => {
  const credential = { type: "oauth", methodID: "device", access: "fake-token", refresh: "fake-token" }
  expect(copilotAccess(credential)).toBe("fake-token")
  expect(copilotAccess({ ...credential, metadata: { enterpriseUrl: "github.example" } })).toBeUndefined()
  expect(copilotAccess({ ...credential, methodID: "other" })).toBeUndefined()
  expect(copilotAccess({ ...credential, access: "short-lived-model-token" })).toBeUndefined()
  const seen: { url?: string; init?: RequestInit } = {}
  const collector = copilotCollector({ account: "selected", githubToken: async () => "fake-token", now: () => now, fetch: async (url, init) => {
    seen.url = url; seen.init = init; return Response.json(direct)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(seen).toMatchObject({ url: "https://api.github.com/copilot_internal/user", init: { redirect: "manual", headers: { Authorization: "token fake-token" } } })
  expect(JSON.stringify(result)).not.toContain("fake-token")
  expect((await copilotCollector({ account: "selected", githubToken: async () => undefined }).collect(new AbortController().signal)).reason).toBe("not_configured")
})
