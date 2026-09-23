import { expect, test } from "bun:test"
import type { IntegrationDomain } from "@opencode/plugin/promise/integration"
import { Credential } from "@opencode/schema/credential"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { parsePoeBalance, poeCollector, selectedPoeToken } from "../src/poe.js"

const now = new Date("2026-09-23T12:00:00Z")
test("Poe balance and bounded history stay points/spend, never quota", async () => {
  const urls: string[] = []
  const collector = poeCollector({ account: "selected", apiKey: async () => "fake-poe-key", now: () => now, fetch: async (url, init) => {
    urls.push(url)
    expect(init?.redirect).toBe("manual")
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer fake-poe-key")
    if (url.endsWith("current_balance")) return Response.json({ current_point_balance: "245.5" })
    return Response.json({ data: [{ creation_time: "2026-09-23T11:00:00Z", cost_points: "10", cost_usd: "0.1" },
      { creation_time: "2026-09-20T12:00:00Z", cost_points: 20 },
      { creation_time: "2026-08-01T12:00:00Z", cost_points: 999 }], has_more: false })
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(urls).toEqual(["https://api.poe.com/usage/current_balance", "https://api.poe.com/usage/points_history?limit=100"])
  expect(result).toMatchObject({ status: "available", windows: [], credits: [{ amount: 245.5, unit: "points" }],
    usage: [{ id: "points-today", amount: 10 }, { id: "spend-today", amount: 0.1 }, { id: "points-7d", amount: 30 }, { id: "spend-7d", amount: 0.1 }, { id: "points-30d", amount: 30 }, { id: "spend-30d", amount: 0.1 }] })
  expect(JSON.stringify(result)).not.toContain("fake-poe-key")
  expect(parsePoeBalance({ current_point_balance: null })).toEqual([])
  expect(parsePoeBalance([])).toBeUndefined()
})

test("history failure does not erase balance and auth errors never fake zero", async () => {
  const collector = poeCollector({ account: "selected", apiKey: async () => "fake", now: () => now, fetch: async url => {
    if (url.endsWith("current_balance")) return Response.json({ current_point_balance: 0 })
    return new Response("no", { status: 503 })
  } })
  expect(await collector.collect(new AbortController().signal)).toMatchObject({ status: "available", credits: [{ amount: 0 }], windows: [] })
  expect((await poeCollector({ account: "selected", apiKey: async () => "fake", fetch: async () => new Response("denied", { status: 403 }) }).collect(new AbortController().signal)).reason).toBe("auth")
  let pages = 0
  const partial = poeCollector({ account: "selected", apiKey: async () => "fake", now: () => now, fetch: async url => {
    if (url.endsWith("current_balance")) return Response.json({ current_point_balance: 12 })
    pages++
    return pages === 1 ? Response.json({ data: [{ creation_time: now.toISOString(), cost_points: 3 }], next_cursor: "next" }) : new Response("error", { status: 503 })
  } })
  expect((await partial.collect(new AbortController().signal)).usage).toMatchObject([{ id: "points-today", amount: 3, period: "observed-today" }, { id: "points-7d", period: "observed-7d" }, { id: "points-30d", period: "observed-30d" }])
})

test("installed Poe OAuth credential shape: selected connection, method and expiry", async () => {
  const value = Credential.OAuth.make({ type: "oauth", methodID: IntegrationMethodID.make("browser"), access: "fake-poe-api-key", refresh: "", expires: now.getTime() + 60_000 })
  const active: Awaited<ReturnType<IntegrationDomain["connection"]["active"]>> = { type: "credential", id: "cred-selected", label: "poe", method: "oauth" }
  let resolutions = 0
  const connection: IntegrationDomain["connection"] = { active: async () => active, resolve: async () => { resolutions++; return value } }
  expect(await selectedPoeToken(connection, "cred-selected", now.getTime())).toBe("fake-poe-api-key")
  expect(await selectedPoeToken(connection, "wrong-id", now.getTime())).toBeUndefined()
  expect(resolutions).toBe(1)
  expect(await selectedPoeToken(connection, "cred-selected", now.getTime() + 40_000)).toBeUndefined()
  expect(await selectedPoeToken({ ...connection, resolve: async () => Credential.OAuth.make({ ...value, methodID: IntegrationMethodID.make("wrong") }) }, "cred-selected", now.getTime())).toBeUndefined()
  expect(await selectedPoeToken({ ...connection, resolve: async () => Credential.Key.make({ type: "key", key: "fake-key" }) }, "cred-selected", now.getTime())).toBeUndefined()
  const selectedKey: IntegrationDomain["connection"] = { active: async () => ({ ...active, method: "key" }), resolve: async () => Credential.Key.make({ type: "key", key: "fake-key" }) }
  expect(await selectedPoeToken(selectedKey, "cred-selected", now.getTime())).toBe("fake-key")
})
