import { expect, test } from "bun:test"
import { hyperCollector, parseHyperBalance } from "../src/hyper.js"

const now = new Date("2026-09-23T12:00:00Z")
test("Hypercredits balance cannot masquerade as a quota window", () => {
  expect(parseHyperBalance({ balance: 42.5 }, "selected", now)).toMatchObject({ status: "available", windows: [], credits: [{ amount: 42.5, unit: "HC" }] })
  expect(parseHyperBalance({ balance: -1 }, "selected", now)).toBeUndefined()
  expect(parseHyperBalance({ balance: "42.5" }, "selected", now)).toBeUndefined()
})

test("Hyper selected key uses credits endpoint and exposes no secret", async () => {
  const urls: string[] = []
  const collector = hyperCollector({ account: "selected", apiKey: async () => "fake", fetch: async (url, init) => {
    urls.push(url); expect(init).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer fake" } })
    return Response.json({ balance: 0 })
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(urls).toEqual(["https://hyper.charm.land/v1/credits"])
  expect(result.credits).toMatchObject([{ amount: 0 }])
  expect(JSON.stringify(result)).not.toContain("fake")
  expect((await hyperCollector({ account: "selected", apiKey: async () => "fake", fetch: async () => new Response("denied", { status: 403 }) }).collect(new AbortController().signal))).toMatchObject({ status: "unavailable", reason: "auth", windows: [] })
})
