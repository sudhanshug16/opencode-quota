import type { Collector, Observation, QuotaWindow } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

const PROCEDURES = ["user.getCreditBlocks", "kiloPass.getState", "user.getAutoTopUpPaymentMethod"] as const
const BASE = `https://app.kilo.ai/api/trpc/${PROCEDURES.join(",")}`
function row(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}
function payload(value: unknown): Record<string, unknown> | undefined {
  const result = row(row(value)?.result)
  return row(row(result?.data)?.json) ?? row(result?.data)
}

/** Kilo's creditBlocks use micro-USD; pass subscription fields are USD. */
export function parseKiloBatch(value: unknown, account: string, now = new Date(), organization?: string): Observation | undefined {
  const entries = Array.isArray(value) ? value : row(value) ? [value] : []
  if (!entries.length || row(entries[0])?.error || row(entries[1])?.error) return undefined
  const creditData = payload(entries[0])
  const passData = payload(entries[1])
  const rawBlocks = creditData?.creditBlocks
  let total: number | undefined
  let remaining: number | undefined
  if (Array.isArray(rawBlocks) && rawBlocks.length <= 500) {
    let sumTotal = 0
    let sumRemaining = 0
    let hasTotal = false
    let hasRemaining = false
    for (const value of rawBlocks) {
      const block = row(value)
      const amount = number(block?.amount_mUsd)
      const balance = number(block?.balance_mUsd)
      if (amount !== undefined) { sumTotal += amount / 1e6; hasTotal = true }
      if (balance !== undefined) { sumRemaining += balance / 1e6; hasRemaining = true }
    }
    if (hasTotal) total = sumTotal
    if (hasRemaining) remaining = sumRemaining
  }
  const fallback = number(creditData?.totalBalance_mUsd)
  if (total === undefined && remaining === undefined && fallback !== undefined) total = remaining = fallback / 1e6
  const subscription = row(passData?.subscription)
  const used = number(subscription?.currentPeriodUsageUsd)
  const base = number(subscription?.currentPeriodBaseCreditsUsd)
  const bonus = number(subscription?.currentPeriodBonusCreditsUsd) ?? 0
  const windows: QuotaWindow[] = []
  if (total !== undefined && remaining !== undefined) windows.push({ id: "credit-blocks", kind: "credit", unit: "USD", limit: total,
    used: Math.max(0, total - remaining), remaining })
  if (base !== undefined && used !== undefined) {
    const pass: QuotaWindow = { id: "kilo-pass", kind: "credit", unit: "USD", limit: base + bonus, used, remaining: Math.max(0, base + bonus - used) }
    const rawDate = subscription?.nextBillingAt ?? subscription?.nextRenewalAt
    if (typeof rawDate === "string" && Number.isFinite(Date.parse(rawDate))) pass.resetAt = new Date(rawDate).toISOString()
    windows.push(pass)
  }
  if (!windows.length) return undefined
  const result: Observation = { schemaVersion: 1, provider: "kilo", account, pool: organization ? `kilo-org:${organization}` : `kilo-personal:${account}`,
    routes: [], status: "available", source: BASE, strategy: "kilo.api", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows }
  if (remaining !== undefined) result.credits = [{ id: "credit-blocks", amount: remaining, unit: "USD" }]
  if (typeof subscription?.tier === "string") result.serviceStatus = subscription.tier
  return result
}

export interface KiloOptions { account: string; organization?: string; apiKey: () => Promise<string | undefined>; fetch?: HttpTransport; now?: () => Date }
export function kiloCollector(options: KiloOptions): Collector {
  if (options.organization && (!/^[a-zA-Z0-9_-]+$/.test(options.organization) || options.organization.length > 120)) throw new Error("Invalid Kilo organization ID")
  return { id: "kilo", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "kilo", account: options.account, pool: options.organization ? `kilo-org:${options.organization}` : `kilo-personal:${options.account}`, routes: [], source: BASE }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    const input = Object.fromEntries(PROCEDURES.map((_, index) => [index.toString(), { json: null }]))
    const query = new URLSearchParams({ batch: "1", input: JSON.stringify(input) })
    const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: "application/json" }
    if (options.organization) headers["X-KILOCODE-ORGANIZATIONID"] = options.organization
    try {
      const response = await (options.fetch ?? fetch)(`${BASE}?${query}`, { method: "GET", headers, redirect: "manual", signal })
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      return parseKiloBatch(await response.json() as unknown, options.account, now, options.organization) ?? unavailable(base, "invalid_response", now)
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
