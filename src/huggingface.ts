import type { Collector, Observation, QuotaWindow, UsageAmount } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

const ROOT = "https://huggingface.co"
function row(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function nonnegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Pinned billing API uses nano-USD; interval end is a query cutoff, never a quota reset. */
export function parseHuggingFaceBilling(value: unknown, account: string, now = new Date()): Observation | undefined {
  const inference = row(row(row(value)?.usage)?.inferenceProviders)
  const grossNano = nonnegative(inference?.usedNanoUsd)
  const includedNano = nonnegative(inference?.includedNanoUsd)
  if (grossNano === undefined || includedNano === undefined || inference?.limitNanoUsd != null && nonnegative(inference.limitNanoUsd) === undefined) return undefined
  const gross = grossNano / 1e9
  const included = includedNano / 1e9
  const billable = Math.max(0, gross - included)
  const limit = (nonnegative(inference?.limitNanoUsd) ?? 0) / 1e9
  const usage: UsageAmount[] = [
    { id: "gross-inference", amount: gross, unit: "USD", currency: "USD", authority: "provider", period: "current-month" },
    { id: "included-inference", amount: included, unit: "USD", currency: "USD", authority: "provider", period: "current-month" },
    { id: "billable-inference", amount: billable, unit: "USD", currency: "USD", authority: "provider", period: "current-month" },
  ]
  const requests = nonnegative(inference?.numRequests)
  if (inference?.numRequests != null && (requests === undefined || !Number.isSafeInteger(requests))) return undefined
  if (requests !== undefined) usage.push({ id: "requests", amount: requests, unit: "requests", authority: "provider", period: "current-month" })
  const windows: QuotaWindow[] = limit > 0 ? [{ id: "spending-limit", kind: "credit", unit: "USD", limit, used: billable, remaining: Math.max(0, limit - billable) }] : []
  return { schemaVersion: 1, provider: "huggingface", account, pool: `huggingface:${account}`, routes: [], status: "available", source: `${ROOT}/api/settings/billing/usage-v2`,
    strategy: "huggingface.api", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows, usage }
}

export function parseZeroGPU(value: unknown): QuotaWindow | undefined {
  const gpu = row(value)
  const total = nonnegative(gpu?.base)
  const remaining = nonnegative(gpu?.current)
  if (total === undefined || total <= 0 || remaining === undefined) return undefined
  const window: QuotaWindow = { id: "zero-gpu", kind: "other", unit: "seconds", limit: total, used: Math.max(0, total - remaining), remaining }
  const rawReset = gpu?.resetsAt
  const date = typeof rawReset === "number" && rawReset > 0 ? new Date(rawReset * 1000) : typeof rawReset === "string" ? new Date(rawReset) : undefined
  if (date && Number.isFinite(date.getTime())) window.resetAt = date.toISOString()
  return window
}

export interface HuggingFaceOptions { account: string; apiKey: () => Promise<string | undefined>; fetch?: HttpTransport; now?: () => Date }
export function huggingFaceCollector(options: HuggingFaceOptions): Collector {
  return { id: "huggingface", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "huggingface", account: options.account, pool: `huggingface:${options.account}`, routes: [], source: `${ROOT}/api/settings/billing/usage-v2` }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    const http = options.fetch ?? fetch
    const init: RequestInit = { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", signal }
    const start = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000)
    const end = Math.floor(now.getTime() / 1000)
    let result: Observation
    try {
      const response = await http(`${ROOT}/api/settings/billing/usage-v2?startDate=${start}&endDate=${end}`, init)
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      const parsed = parseHuggingFaceBilling(await response.json() as unknown, options.account, now)
      if (!parsed) return unavailable(base, "invalid_response", now)
      result = parsed
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
    // ZeroGPU is an independent optional quota; failure never erases authoritative billing.
    try {
      const response = await http(`${ROOT}/api/spaces/zero-gpu/quota`, init)
      if (response.ok && !response.redirected) {
        const gpu = parseZeroGPU(await response.json() as unknown)
        if (gpu) result.windows = [...result.windows, gpu]
      }
    } catch { /* optional endpoint */ }
    return result
  } }
}
