import { expect, test } from "bun:test"
import { openRouterCollector, parseOpenRouter } from "../src/openrouter.js"

const now = new Date("2026-09-23T12:00:00Z")
const key = { data: { limit: 10, limit_remaining: 7, usage: 99, usage_weekly: 4, limit_reset: "weekly" } }
const credits = { data: { total_credits: 20, total_usage: 8 } }

test("key cap follows server remaining, not cumulative spend; credits stay account-scoped", () => {
  const result = parseOpenRouter(key, credits, "selected", now)
  expect(result).toMatchObject({ strategy: "openrouter.js", account: "selected", pool: "selected-api-key", routes: [],
    windows: [{ id: "api-key", limit: 10, used: 3, remaining: 7, scope: "weekly" }],
    credits: [{ id: "account-balance", amount: 12, unit: "USD" }],
    usage: [{ id: "key-weekly", amount: 4, authority: "provider" }, { id: "key-total", amount: 99 }, { id: "account-total", amount: 8 }],
  })
  expect(parseOpenRouter({ data: { limit: null, usage_monthly: 3 } }, undefined, "a", now)?.windows).toEqual([])
  expect(parseOpenRouter({ data: { usage: "3" } }, undefined, "a", now)).toBeUndefined()
  expect(parseOpenRouter({ data: { usage: "3" } }, credits, "a", now)?.credits?.[0]?.amount).toBe(12)
  expect(parseOpenRouter(undefined, { data: { total_credits: 5, total_usage: 2 } }, "a", now)?.credits?.[0]?.amount).toBe(3)
})

test("selected bearer key cannot follow redirects and responses never contain secrets", async () => {
  const seen: string[] = []
  const collector = openRouterCollector({ account: "selected", apiKey: async () => "fake-key", now: () => now, fetch: async (url, init) => {
    seen.push(`${url} ${init.redirect} ${(init.headers as Record<string, string>).Authorization}`)
    return Response.json(url.endsWith("/key") ? key : credits)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(seen).toEqual(["https://openrouter.ai/api/v1/key manual Bearer fake-key", "https://openrouter.ai/api/v1/credits manual Bearer fake-key"])
  expect(result.status).toBe("available")
  expect(JSON.stringify(result)).not.toContain("fake-key")
  const auth = openRouterCollector({ account: "a", apiKey: async () => "key", fetch: async () => new Response(null, { status: 403 }) })
  expect((await auth.collect(new AbortController().signal)).reason).toBe("auth")
})
