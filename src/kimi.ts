import type { Collector, Observation, QuotaWindow } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

export type KimiRegion = "china" | "international"
const urls: Record<KimiRegion, string> = { china: "https://api.kimi.com/coding/v1/usages", international: "https://api.kimi.ai/coding/v1/usages" }
function row(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function reset(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined
}

/** Code API ratios are fractions, unlike percent values in other providers. */
export function parseKimiCodeUsage(value: unknown, account: string, region: KimiRegion, now = new Date()): Observation | undefined {
  const body = row(value)
  if (!body) return undefined
  const pools = row(body.usages)
  const windows: QuotaWindow[] = []
  const legacy = (value: unknown, id: string, kind: QuotaWindow["kind"]): QuotaWindow | undefined => {
    const detail = row(value)
    const limit = Number(detail?.limit)
    if (!Number.isSafeInteger(limit) || limit <= 0) return undefined
    const usedValue = detail?.used == null ? undefined : Number(detail.used)
    const remainingValue = detail?.remaining == null ? undefined : Number(detail.remaining)
    const used = Number.isSafeInteger(usedValue) && usedValue! >= 0 ? usedValue! : Number.isSafeInteger(remainingValue) && remainingValue! >= 0 && remainingValue! <= limit ? limit - remainingValue! : undefined
    if (used === undefined) return undefined
    const result: QuotaWindow = { id, kind, unit: "requests", limit, used, remaining: Math.max(0, limit - used) }
    const at = reset(detail?.resetTime ?? detail?.resetAt ?? detail?.reset_time ?? detail?.reset_at)
    if (at) result.resetAt = at
    return result
  }
  const weekly = legacy(body.usage, "weekly", "weekly")
  const rate = Array.isArray(body.limits) ? row(body.limits[0]) : undefined
  const session = legacy(rate?.detail, "five-hour", "rolling")
  const ratio = (pool: unknown, id: string, kind: QuotaWindow["kind"], alternate?: QuotaWindow): QuotaWindow | undefined => {
    const data = row(pool)
    const value = data?.used_ratio
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return alternate
    const at = reset(data?.reset_time)
    // Pinned source treats a zero-ratio placeholder as stale only when a reliable same-clock legacy counter disagrees.
    if (value === 0 && !row(pools?.limit_month_total) && alternate?.used && alternate.resetAt && at && Math.abs(Date.parse(at) - Date.parse(alternate.resetAt)) <= 2000) return alternate
    const used = Math.min(1, value) * 100
    const result: QuotaWindow = { id, kind, unit: "percent", limit: 100, used, remaining: 100 - used }
    if (at) result.resetAt = at
    return result
  }
  const weeklyWindow = ratio(pools?.limit_7d, "weekly", "weekly", weekly)
  const sessionWindow = ratio(pools?.limit_5h, "five-hour", "rolling", session)
  const monthlyWindow = ratio(pools?.limit_month_total, "monthly-total", "monthly")
  for (const window of [weeklyWindow, sessionWindow, monthlyWindow]) if (window) windows.push(window)
  if (!windows.length) return undefined
  const result: Observation = { schemaVersion: 1, provider: "kimi", account, pool: `kimi:${region}:${account}`, routes: [], status: "available",
    source: urls[region], strategy: "kimi.api", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows }
  const level = row(row(body.user)?.membership)?.level
  if (typeof level === "string" && level.trim() && level !== "LEVEL_UNSPECIFIED") result.serviceStatus = level
  return result
}

export interface KimiOptions {
  account: string
  region: KimiRegion
  apiKey: () => Promise<string | undefined>
  fetch?: HttpTransport
  now?: () => Date
}

export function kimiCollector(options: KimiOptions): Collector {
  return { id: "kimi", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const url = urls[options.region]
    const base = { provider: "kimi", account: options.account, pool: `kimi:${options.region}:${options.account}`, routes: [], source: url }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    try {
      const response = await (options.fetch ?? fetch)(url, { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", signal })
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      return parseKimiCodeUsage(await response.json() as unknown, options.account, options.region, now) ?? unavailable(base, "invalid_response", now)
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
