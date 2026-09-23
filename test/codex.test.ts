import { expect, test } from "bun:test"
import { codexAccess, codexCollector, parseCodexMonthlySpend, parseCodexResetCredits, parseCodexUsage, parseCodexWorkspaceBalance, selectedCodexOAuth } from "../src/codex.js"
import type { IntegrationDomain } from "@opencode/plugin/promise/integration"
import { Credential } from "@opencode/schema/credential"
import { IntegrationMethodID } from "@opencode/schema/integration-id"

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
  expect(codexAccess(oauth, undefined, now.getTime())).toEqual({ accessToken: "fake-access", accountId: "account-1" })
  expect(codexAccess(oauth, "account-1", now.getTime())).toEqual({ accessToken: "fake-access", accountId: "account-1" })
  expect(codexAccess(oauth, "account-2", now.getTime())).toBeUndefined()
  expect(codexAccess({ ...oauth, metadata: undefined }, undefined, now.getTime())).toBeUndefined()
  expect(codexAccess({ ...oauth, metadata: undefined }, "manually-selected", now.getTime())).toEqual({ accessToken: "fake-access", accountId: "manually-selected" })
  expect(codexAccess({ ...oauth, metadata: { accountID: "" } }, "manually-selected", now.getTime())).toBeUndefined()
  expect(codexAccess({ ...oauth, methodID: "other" }, "account-1", now.getTime())).toBeUndefined()
  expect(codexAccess({ ...oauth, expires: now.getTime() + 1_000 }, "account-1", now.getTime())).toBeUndefined()
  const seen: { url?: string; init?: RequestInit } = {}
  const collector = codexCollector({ account: "selected", oauth: async () => ({ accessToken: "fake-access", accountId: "account-1" }), now: () => now, fetch: async (url, init) => {
    seen.url = url; seen.init = init; return Response.json(body)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(seen).toMatchObject({ url: "https://chatgpt.com/backend-api/wham/usage", init: { redirect: "manual", headers: { Authorization: "Bearer fake-access", "ChatGPT-Account-Id": "account-1" } } })
  expect(JSON.stringify(result)).not.toContain("fake-access")
})

test("installed SDK OAuth credential shape and active connection are account-bound", async () => {
  const value = Credential.OAuth.make({ type: "oauth", methodID: IntegrationMethodID.make("chatgpt-browser"), access: "fake-access", refresh: "fake-refresh", expires: Date.now() + 3_600_000, metadata: { accountID: "from-open-code" } })
  let resolutions = 0
  const active: Awaited<ReturnType<IntegrationDomain["connection"]["active"]>> = { type: "credential", id: "cred-selected", label: "personal", method: "oauth" }
  const connection: IntegrationDomain["connection"] = {
    active: async () => active,
    resolve: async () => { resolutions++; return value },
  }
  expect(await selectedCodexOAuth(connection, "cred-selected")).toEqual({ accessToken: "fake-access", accountId: "from-open-code" })
  expect(await selectedCodexOAuth(connection, "cred-selected", "from-open-code")).toEqual({ accessToken: "fake-access", accountId: "from-open-code" })
  expect(await selectedCodexOAuth(connection, "cred-selected", "different-account")).toBeUndefined()
  expect(await selectedCodexOAuth(connection, "other-connection")).toBeUndefined()
  expect(resolutions).toBe(3)
  const missingIdentity: IntegrationDomain["connection"] = { ...connection, resolve: async () => Credential.OAuth.make({ ...value, metadata: undefined }) }
  expect(await selectedCodexOAuth(missingIdentity, "cred-selected")).toBeUndefined()
  expect(await selectedCodexOAuth(missingIdentity, "cred-selected", "explicit-account")).toEqual({ accessToken: "fake-access", accountId: "explicit-account" })
  const expired: IntegrationDomain["connection"] = { ...connection, resolve: async () => Credential.OAuth.make({ ...value, expires: Date.now() - 1 }) }
  expect(await selectedCodexOAuth(expired, "cred-selected")).toBeUndefined()
  const wrongMethod: IntegrationDomain["connection"] = { ...connection, resolve: async () => Credential.OAuth.make({ ...value, methodID: IntegrationMethodID.make("another-audience") }) }
  expect(await selectedCodexOAuth(wrongMethod, "cred-selected")).toBeUndefined()
})

test("account-bound OAuth extras are independent reset inventory, spend cap and workspace credits", async () => {
  expect(parseCodexResetCredits({ credits: [], available_count: 2 })).toBe(2)
  expect(parseCodexResetCredits({ credits: [], available_count: -1 })).toBeUndefined()
  expect(parseCodexMonthlySpend({ current_month_usage: "12", effective_monthly_limit: { limit: "7000", enforcement_mode: "HARD_CAP" } })).toMatchObject({ id: "monthly-spend-control", used: 12, limit: 7000, unit: "credits" })
  expect(parseCodexMonthlySpend({ current_month_usage: 12, effective_monthly_limit: { limit: 7000, enforcement_mode: "off" } })).toBeUndefined()
  expect(parseCodexWorkspaceBalance({ balance: "1234" })).toBe(1234)
  expect(parseCodexWorkspaceBalance({ balance: null })).toBeUndefined()
  const urls: string[] = []
  const wham = { ...body, plan_type: "education", spend_control: { individual_limit: null }, credits: { has_credits: true, unlimited: false, balance: null } }
  const collector = codexCollector({ account: "selected", includeExtras: true, oauth: async () => ({ accessToken: "fake-access", accountId: "account-1" }), now: () => now,
    fetch: async (url, init) => {
      urls.push(url)
      expect(init).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer fake-access", "ChatGPT-Account-Id": "account-1" } })
      if (url.endsWith("/wham/usage")) return Response.json(wham)
      if (url.endsWith("rate-limit-reset-credits")) {
        expect(init?.headers).toMatchObject({ "OpenAI-Beta": "codex-1", originator: "Codex Desktop" })
        return Response.json({ credits: [], available_count: 2 })
      }
      if (url.endsWith("monthly-usage")) return Response.json({ current_month_usage: 12, effective_monthly_limit: { limit: 7000, enforcement_mode: "HARD_CAP" } })
      return Response.json({ balance: 1234 })
    } })
  const result = await collector.collect(new AbortController().signal)
  expect(urls).toEqual(["https://chatgpt.com/backend-api/wham/usage", "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
    "https://chatgpt.com/backend-api/accounts/account-1/spend-controls/current-user/monthly-usage", "https://chatgpt.com/backend-api/accounts/account-1/remaining_balance"])
  expect(result.windows.at(-1)).toMatchObject({ id: "monthly-spend-control", used: 12, limit: 7000 })
  expect(result.credits).toMatchObject([{ id: "rate-limit-resets", amount: 2, unit: "reset-credits" }, { id: "workspace-remaining", amount: 1234, unit: "credits" }])
  expect(JSON.stringify(result)).not.toContain("fake-access")
  const denied = codexCollector({ account: "selected", includeExtras: true, oauth: async () => ({ accessToken: "fake-access", accountId: "account-1" }),
    fetch: async url => url.endsWith("/wham/usage") ? Response.json(wham) : new Response("denied", { status: 403 }) })
  const quota = await denied.collect(new AbortController().signal)
  expect(quota.status).toBe("available")
  expect(quota.windows).toHaveLength(3)
  expect(quota.credits).toBeUndefined()
})
