import type { Collector, Observation } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

const URL = "https://api.venice.ai/api/v1/billing/balance"
function row(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function numeric(value: unknown): number | undefined {
  if (value == null || value === "") return undefined
  const result = typeof value === "number" || typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(result) ? result : undefined
}

/** Venice returns separate USD and DIEM balances; DIEM epoch allocation is a cap, not a monthly subscription. */
export function parseVeniceBalance(value: unknown, account: string, now = new Date()): Observation | undefined {
  const body = row(value)
  const balances = row(body?.balances)
  if (!body || typeof body.canConsume !== "boolean" || !balances || body.consumptionCurrency != null && typeof body.consumptionCurrency !== "string") return undefined
  const usd = numeric(balances.usd)
  const diem = numeric(balances.diem)
  const allocation = numeric(body.diemEpochAllocation)
  if (balances.usd != null && usd === undefined || balances.diem != null && diem === undefined || body.diemEpochAllocation != null && allocation === undefined) return undefined
  const result: Observation = { schemaVersion: 1, provider: "venice", account, pool: `venice:${account}`, routes: [], status: "available", source: URL,
    strategy: "venice.api-balance", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows: [] }
  if (usd !== undefined || diem !== undefined) result.credits = [
    ...(usd !== undefined ? [{ id: "usd", amount: usd, unit: "USD" }] : []),
    ...(diem !== undefined ? [{ id: "diem", amount: diem, unit: "DIEM" }] : []),
  ]
  if (diem !== undefined && allocation !== undefined && allocation > 0) result.windows = [{ id: "diem-epoch", kind: "credit", unit: "DIEM", limit: allocation, used: Math.max(0, allocation - diem), remaining: diem }]
  result.serviceStatus = body.canConsume ? "can-consume" : "cannot-consume"
  return result
}

export interface VeniceOptions { account: string; apiKey: () => Promise<string | undefined>; fetch?: HttpTransport; now?: () => Date }
export function veniceCollector(options: VeniceOptions): Collector {
  return { id: "venice", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "venice", account: options.account, pool: `venice:${options.account}`, routes: [], source: URL }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    try {
      const response = await (options.fetch ?? fetch)(URL, { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", signal })
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      return parseVeniceBalance(await response.json() as unknown, options.account, now) ?? unavailable(base, "invalid_response", now)
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
