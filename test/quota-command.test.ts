import { describe, expect, test } from "bun:test"
import type { Observation } from "../src/core.js"
import { quotaReport } from "../src/quota-command.js"

const observation: Observation = {
  schemaVersion: 1, provider: "alpha", account: "primary", pool: "pool", routes: [], status: "available",
  observedAt: "2026-09-23T00:00:00.000Z", freshUntil: "2026-09-23T00:01:00.000Z", source: "fixture",
  windows: [{ id: "week", kind: "weekly", unit: "percent", used: 12, limit: 100, resetAt: "2026-09-24T00:00:00.000Z" }],
  credits: [{ id: "balance", amount: 2.5, unit: "USD" }],
}

describe("/quota report", () => {
  test("shows selected observations and explicit connected unsupported/unconfigured accounts", async () => {
    const report = await quotaReport({
      accounts: [
        { integration: "alpha", label: "primary", connectionId: "conn-a" },
        { integration: "beta", label: "other", connectionId: "conn-b" },
        { integration: "gamma", label: "third", connectionId: "conn-c" },
      ],
      collectors: [{ integration: "alpha", connectionId: "conn-a", account: "primary", collect: async () => observation }],
      unsupported: new Set(["beta"]), now: () => new Date("2026-09-23T00:00:00.000Z"),
    })
    expect(report).toContain("week: 12/100 percent (resets 2026-09-24T00:00:00.000Z)")
    expect(report).toContain("balance: 2.5 USD")
    expect(report).toContain("beta (other): unsupported")
    expect(report).toContain("gamma (third): unavailable")
    expect(report).not.toContain("secret")
  })

  test("handles no connected accounts and isolates collector errors without exposing messages", async () => {
    expect(await quotaReport({ accounts: [], collectors: [], unsupported: new Set() })).toBe("No connected providers found in this OpenCode location.")
    const report = await quotaReport({
      accounts: [{ integration: "alpha", label: "primary", connectionId: "conn-a" }, { integration: "beta", label: "secondary", connectionId: "conn-b" }],
      collectors: [
        { integration: "alpha", connectionId: "conn-a", account: "primary", collect: async () => { throw new Error("secret credential detail") } },
        { integration: "beta", connectionId: "conn-b", account: "secondary", collect: async () => observation },
      ], unsupported: new Set(),
    })
    expect(report).toContain("collection failed (Error)")
    expect(report).not.toContain("secret credential detail")
    expect(report).toContain("beta (secondary): available")
  })
})
