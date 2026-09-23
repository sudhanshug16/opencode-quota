import type { Collector, Observation, QuotaWindow } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

const BASE = "https://api.v0.dev/v1"
function row(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function finite(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined }
function reset(value: unknown): string | undefined {
  const timestamp = finite(value)
  if (timestamp === undefined || timestamp <= 0) return undefined
  const millis = timestamp >= 1e12 ? timestamp : timestamp * 1000
  return millis <= 8.64e15 ? new Date(millis).toISOString() : undefined
}

/** Pinned v0 billing and rate-limits shapes; units are deliberately provider-defined. */
export function parseV0Usage(billingValue: unknown, rateValue: unknown, account: string, now = new Date()): Observation | undefined {
  const billing = row(billingValue)
  const rate = row(rateValue)
  if (!billing || !rate || (billing.billingType !== "token" && billing.billingType !== "legacy")) return undefined
  const token = billing.billingType === "token"
  const data = row(billing.data)
  const balance = token ? row(data?.balance) : data
  const cycle = token ? row(data?.billingCycle) : undefined
  const onDemand = token ? row(data?.onDemand) : undefined
  const billingLimit = finite(token ? balance?.total : balance?.limit)
  const billingRemaining = finite(balance?.remaining)
  const rateLimit = finite(rate.limit)
  const rateRemaining = finite(rate.remaining)
  if (billingLimit === undefined || billingLimit < 0 || rateLimit === undefined || rateLimit < 0 || (token && (!cycle || billingRemaining === undefined))) return undefined
  if (balance?.remaining != null && billingRemaining === undefined || rate.remaining != null && rateRemaining === undefined) return undefined
  const windows: QuotaWindow[] = []
  const bill: QuotaWindow = { id: "billing", kind: "credit", unit: "provider-billing-units", limit: billingLimit }
  if (billingRemaining !== undefined) { bill.remaining = billingRemaining; bill.used = Math.max(0, billingLimit - billingRemaining) }
  const billReset = reset(token ? cycle?.end : data?.reset)
  if (billReset) bill.resetAt = billReset
  windows.push(bill)
  const rateWindow: QuotaWindow = { id: "rate-limit", kind: "rolling", unit: "provider-rate-units", limit: rateLimit }
  if (rateRemaining !== undefined) { rateWindow.remaining = rateRemaining; rateWindow.used = Math.max(0, rateLimit - rateRemaining) }
  const rateReset = reset(rate.reset)
  if (rateReset) rateWindow.resetAt = rateReset
  windows.push(rateWindow)
  const result: Observation = { schemaVersion: 1, provider: "v0", account, pool: `v0:${account}`, routes: [], status: "available", source: BASE,
    strategy: "v0.api", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows, serviceStatus: billing.billingType }
  const extra = finite(onDemand?.balance)
  if (extra !== undefined) result.credits = [{ id: "on-demand", amount: extra, unit: "provider-billing-units" }]
  return result
}

export interface V0Options {
  account: string
  apiKey: () => Promise<string | undefined>
  /** Explicit nonsecret project ID/slug; omitted for account-level request. */
  scope?: string
  fetch?: HttpTransport
  now?: () => Date
}

export function v0Collector(options: V0Options): Collector {
  if (options.scope && (options.scope.length > 120 || /[\r\n]/.test(options.scope))) throw new Error("Invalid v0 scope")
  return { id: "v0", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "v0", account: options.account, pool: `v0:${options.account}${options.scope ? `:${options.scope}` : ""}`, routes: [], source: BASE }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    const query = options.scope ? `?scope=${encodeURIComponent(options.scope)}` : ""
    const http = options.fetch ?? fetch
    const init: RequestInit = { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", signal }
    try {
      const billing = await http(`${BASE}/user/billing${query}`, init)
      if (billing.status === 401 || billing.status === 403) return unavailable(base, "auth", now)
      if (!billing.ok || billing.redirected) return unavailable(base, "transport", now)
      const rate = await http(`${BASE}/rate-limits${query}`, init)
      if (rate.status === 401 || rate.status === 403) return unavailable(base, "auth", now)
      if (!rate.ok || rate.redirected) return unavailable(base, "transport", now)
      const result = parseV0Usage(await billing.json() as unknown, await rate.json() as unknown, options.account, now)
      if (!result) return unavailable(base, "invalid_response", now)
      result.pool = base.pool
      return result
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
