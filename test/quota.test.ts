import { describe, expect, test } from "bun:test"
import { goCollector, parseGoUsage, unsupportedCollector } from "../src/collectors.js"
import { QuotaReader, type Collector, type Observation } from "../src/core.js"

const NOW = new Date("2026-09-23T12:00:00.000Z")
const body = { usage: { rolling: { percent: 1, resetInSec: 3600 }, weekly: { percent: 0.5, resetInSec: 86400 }, monthly: { percent: 31 } } }

describe("OpenCode Go", () => {
  test("whole-percent API data retains distinct windows, resets and unknown route mapping", () => {
    const result = parseGoUsage(body, "test-account", NOW)
    expect(result).toMatchObject({ status: "available", routes: [], account: "test-account", windows: [
      { used: 1, remaining: 99, resetAt: "2026-09-23T13:00:00.000Z" },
      { used: 0.5, remaining: 99.5, resetAt: "2026-09-24T12:00:00.000Z" },
      { used: 31, remaining: 69 },
    ] })
    expect(result?.windows[2]?.resetAt).toBeUndefined()
    expect(parseGoUsage({ usage: { weekly: { percent: 5 } } }, "test", NOW)).toBeUndefined()
    expect(parseGoUsage({ usage: { rolling: { percent: 101 } } }, "test", NOW)).toBeUndefined()
    expect(parseGoUsage({ usage: { rolling: { percent: 4, resetAt: "2026-09-25T00:00:00Z" } } }, "test", NOW)?.windows[0]?.resetAt).toBe("2026-09-25T00:00:00.000Z")
  })

  test("fixed HTTPS endpoint, bearer key, no redirect and no secret in result", async () => {
    const seen: { url?: string; init?: RequestInit } = {}
    const collector = goCollector({ account: "test", apiKey: async () => "fake-secret", now: () => NOW, fetch: async (url, init) => {
      seen.url = String(url); seen.init = init
      return Response.json(body)
    } })
    const result = await collector.collect(new AbortController().signal)
    expect(seen.url).toBe("https://opencode.ai/zen/go/v1/usage")
    expect(seen.init).toMatchObject({ method: "GET", redirect: "manual", headers: { Authorization: "Bearer fake-secret" } })
    expect(JSON.stringify(result)).not.toContain("fake-secret")
  })

  test("auth, malformed, transport and unconfigured all mean unavailable, not zero", async () => {
    const make = (fetcher: (input: string, init: RequestInit) => Promise<Response>, key = "key") => goCollector({ account: "a", apiKey: async () => key, now: () => NOW, fetch: fetcher })
    expect((await make(async () => new Response(null, { status: 401 })).collect(new AbortController().signal)).reason).toBe("auth")
    expect((await make(async () => Response.json({ usage: {} })).collect(new AbortController().signal)).reason).toBe("invalid_response")
    expect((await make(async () => { throw new Error("offline") }).collect(new AbortController().signal)).reason).toBe("transport")
    expect((await make(async () => Response.json(body), "").collect(new AbortController().signal)).reason).toBe("not_configured")
    expect((await make(async () => new Response(null, { status: 302 })).collect(new AbortController().signal)).windows).toEqual([])
  })
})

describe("reader", () => {
  test("caches fresh facts, coalesces reads and refreshes after expiry", async () => {
    let count = 0
    let now = NOW
    const collector: Collector = { id: "test", async collect() {
      count++
      await Promise.resolve()
      return { schemaVersion: 1, provider: "test", account: "a", pool: "p", routes: [], status: "available", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 1000).toISOString(), source: "test", windows: [] } satisfies Observation
    } }
    const reader = new QuotaReader([collector], 1000, () => now)
    await Promise.all([reader.read(), reader.read()])
    await reader.read()
    expect(count).toBe(1)
    now = new Date(NOW.getTime() + 1001)
    await reader.read()
    expect(count).toBe(2)
    reader.close()
    expect(reader.read()).rejects.toThrow("reader closed")
  })

  test("cancellation and unsupported collectors expose no fabricated amount", async () => {
    const reader = new QuotaReader([unsupportedCollector("claude")])
    expect(await reader.read()).toMatchObject([{ status: "unavailable", reason: "unsupported", windows: [] }])
    reader.close()
  })

  test("timeout terminates even a transport ignoring abort", async () => {
    let aborted = false
    const reader = new QuotaReader([{ id: "slow", collect(signal) {
      signal.addEventListener("abort", () => { aborted = true })
      return new Promise<Observation>(() => {})
    } }], 5)
    expect(await reader.read()).toMatchObject([{ status: "unavailable", reason: "timeout", windows: [] }])
    expect(aborted).toBe(true)
    reader.close()
  })
})
