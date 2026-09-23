import { expect, test } from "bun:test"
import { huggingFaceCollector, parseHuggingFaceBilling, parseZeroGPU } from "../src/huggingface.js"

const now = new Date("2026-09-23T12:00:00Z")
const body = { usage: { inferenceProviders: { usedNanoUsd: 9_000_000_000, includedNanoUsd: 4_000_000_000, limitNanoUsd: 20_000_000_000, numRequests: 25 } } }

test("inference gross/included/billable USD and optional cap; no wallet from bearer", () => {
  expect(parseHuggingFaceBilling(body, "selected", now)).toMatchObject({ status: "available",
    usage: [{ id: "gross-inference", amount: 9 }, { id: "included-inference", amount: 4 }, { id: "billable-inference", amount: 5 }, { id: "requests", amount: 25 }],
    windows: [{ id: "spending-limit", kind: "credit", unit: "USD", used: 5, limit: 20, remaining: 15 }] })
  expect(parseHuggingFaceBilling(body, "selected", now)?.credits).toBeUndefined()
  expect(parseHuggingFaceBilling({ usage: { inferenceProviders: { ...body.usage.inferenceProviders, limitNanoUsd: null } } }, "selected", now)?.windows).toEqual([])
  expect(parseHuggingFaceBilling({ usage: { inferenceProviders: { ...body.usage.inferenceProviders, usedNanoUsd: "9000000000" } } }, "selected", now)).toBeUndefined()
  expect(parseZeroGPU({ base: 600, current: 120, resetsAt: "2026-09-24T00:00:00Z" })).toMatchObject({ unit: "seconds", used: 480, remaining: 120, resetAt: "2026-09-24T00:00:00.000Z" })
})

test("fixed monthly query and optional ZeroGPU; failure keeps billing only", async () => {
  const urls: string[] = []
  const collector = huggingFaceCollector({ account: "selected", apiKey: async () => "fake", now: () => now, fetch: async (url, init) => {
    urls.push(url)
    expect(init).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer fake" } })
    return url.includes("zero-gpu") ? Response.json({ base: 600, current: 120 }) : Response.json(body)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(urls).toEqual(["https://huggingface.co/api/settings/billing/usage-v2?startDate=1788220800&endDate=1790164800", "https://huggingface.co/api/spaces/zero-gpu/quota"])
  expect(result.windows).toHaveLength(2)
  expect(JSON.stringify(result)).not.toContain("fake")
  const optionalFailure = huggingFaceCollector({ account: "selected", apiKey: async () => "fake", fetch: async url => url.includes("zero-gpu") ? new Response("no", { status: 403 }) : Response.json(body) })
  expect((await optionalFailure.collect(new AbortController().signal)).windows).toHaveLength(1)
  const rejected = huggingFaceCollector({ account: "selected", apiKey: async () => "fake", fetch: async () => new Response("no", { status: 403 }) })
  expect(await rejected.collect(new AbortController().signal)).toMatchObject({ status: "unavailable", reason: "auth", windows: [] })
})
