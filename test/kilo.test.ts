import { expect, test } from "bun:test"
import { kiloCollector, parseKiloBatch } from "../src/kilo.js"

const now = new Date("2026-09-23T12:00:00Z")
const batch = [
  { result: { data: { creditBlocks: [{ amount_mUsd: 30_000_000, balance_mUsd: 12_000_000 }], autoTopUpEnabled: false } } },
  { result: { data: { subscription: { tier: "tier_19", currentPeriodUsageUsd: 4, currentPeriodBaseCreditsUsd: 19,
    currentPeriodBonusCreditsUsd: 9.5, nextBillingAt: "2026-10-01T00:00:00Z" } } } },
  { result: { data: { enabled: false } } },
]

test("Kilo micro-USD credit blocks and USD pass bonus stay distinct", () => {
  expect(parseKiloBatch(batch, "selected", now)).toMatchObject({ status: "available", serviceStatus: "tier_19", windows: [
    { id: "credit-blocks", unit: "USD", used: 18, limit: 30, remaining: 12 },
    { id: "kilo-pass", unit: "USD", used: 4, limit: 28.5, remaining: 24.5, resetAt: "2026-10-01T00:00:00.000Z" },
  ], credits: [{ id: "credit-blocks", amount: 12, unit: "USD" }] })
  expect(parseKiloBatch([{ result: { data: { creditBlocks: [], totalBalance_mUsd: 0 } } }], "selected", now)).toMatchObject({ windows: [{ limit: 0, remaining: 0 }], credits: [{ amount: 0 }] })
  expect(parseKiloBatch([{ error: { message: "UNAUTHORIZED" } }], "selected", now)).toBeUndefined()
})

test("exact selected key, optional organization and fixed tRPC batch", async () => {
  const urls: string[] = []
  const collector = kiloCollector({ account: "selected", organization: "org_42", apiKey: async () => "fake", now: () => now,
    fetch: async (url, init) => {
      urls.push(url)
      expect(init).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer fake", "X-KILOCODE-ORGANIZATIONID": "org_42" } })
      return Response.json(batch)
    } })
  const result = await collector.collect(new AbortController().signal)
  expect(urls).toHaveLength(1)
  const parsed = new URL(urls[0])
  expect(parsed.origin + parsed.pathname).toBe("https://app.kilo.ai/api/trpc/user.getCreditBlocks,kiloPass.getState,user.getAutoTopUpPaymentMethod")
  expect(parsed.searchParams.get("batch")).toBe("1")
  expect(result.pool).toBe("kilo-org:org_42")
  expect(JSON.stringify(result)).not.toContain("fake")
  expect(await kiloCollector({ account: "selected", apiKey: async () => "fake", fetch: async () => new Response("denied", { status: 403 }) }).collect(new AbortController().signal)).toMatchObject({ status: "unavailable", reason: "auth", windows: [] })
})
