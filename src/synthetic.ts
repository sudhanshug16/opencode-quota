import type { Collector, Observation, QuotaWindow } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

const URL = "https://api.synthetic.new/v2/quotas"
function row(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function numeric(value: unknown): number | undefined {
  const result = typeof value === "number" || typeof value === "string" && value.trim() ? Number(value) : NaN
  return Number.isFinite(result) ? result : undefined
}
function first(data: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) { const value = numeric(data[key]); if (value !== undefined) return value }
  return undefined
}
function reset(data: Record<string, unknown>): string | undefined {
  const raw = data.reset_at ?? data.resetAt ?? data.nextRegenAt ?? data.renewsAt
  const value = typeof raw === "number" ? new Date(raw > 1e12 ? raw : raw * 1000) : typeof raw === "string" ? new Date(raw) : undefined
  return value && Number.isFinite(value.getTime()) ? value.toISOString() : undefined
}
function parseQuota(value: unknown, id: string, kind: QuotaWindow["kind"]): QuotaWindow | undefined {
  const data = row(value)
  if (!data) return undefined
  const limit = first(data, ["limit", "max", "total", "quota", "messageLimit", "requestLimit"])
  const reportedUsed = first(data, ["used", "usage", "requests", "consumed"])
  const reportedRemaining = first(data, ["remaining", "left", "available"])
  const percentUsed = first(data, ["percentUsed", "usedPercent", "usage_percent", "percent_used"])
  const percentRemaining = first(data, ["percentRemaining", "remainingPercent"])
  const used = reportedUsed ?? (limit !== undefined && reportedRemaining !== undefined ? Math.max(0, limit - reportedRemaining) : undefined)
  const normalized = percentUsed !== undefined ? percentUsed <= 1 ? percentUsed * 100 : percentUsed : percentRemaining !== undefined ? 100 - (percentRemaining <= 1 ? percentRemaining * 100 : percentRemaining) : undefined
  if (limit !== undefined && limit > 0 && used !== undefined) {
    const unit = id === "weekly-tokens" ? "tokens" : id === "search-hourly" ? "requests" : typeof data.unit === "string" && data.unit.trim() ? data.unit : "provider-quota-units"
    const result: QuotaWindow = { id, kind, unit, limit, used, remaining: reportedRemaining ?? Math.max(0, limit - used) }
    const at = reset(data)
    if (at) result.resetAt = at
    return result
  }
  if (normalized === undefined) return undefined
  const result: QuotaWindow = { id, kind, unit: "percent", limit: 100, used: Math.max(0, Math.min(100, normalized)), remaining: 100 - Math.max(0, Math.min(100, normalized)) }
  const at = reset(data)
  if (at) result.resetAt = at
  return result
}

/** Pinned named slots or bounded generic quota list; USD weekly credits remain separate. */
export function parseSyntheticQuota(value: unknown, account: string, now = new Date()): Observation | undefined {
  const root = Array.isArray(value) ? { quotas: value } : row(value)
  if (!root) return undefined
  const data = row(root.data)
  const named = [row(root.rollingFiveHourLimit) ?? row(data?.rollingFiveHourLimit), row(root.weeklyTokenLimit) ?? row(data?.weeklyTokenLimit),
    row(row(root.search)?.hourly) ?? row(row(data?.search)?.hourly)]
  const windows: QuotaWindow[] = []
  let weekly: Record<string, unknown> | undefined
  let truncated = false
  if (named.some(Boolean)) {
    for (const [index, payload] of named.entries()) {
      const window = parseQuota(payload, ["five-hour", "weekly-tokens", "search-hourly"][index], index === 1 ? "weekly" : "rolling")
      if (window) windows.push(window)
    }
    weekly = named[1]
  } else {
    const candidates = Array.isArray(root.quotas) ? root.quotas : Array.isArray(data?.quotas) ? data.quotas : []
    truncated = candidates.length > 20
    for (const [index, payload] of candidates.slice(0, 20).entries()) {
      const name = typeof row(payload)?.name === "string" ? String(row(payload)?.name).toLowerCase() : ""
      const kind = name.includes("month") ? "monthly" : name.includes("week") ? "weekly" : "rolling"
      const window = parseQuota(payload, `quota-${index}`, kind)
      if (window) windows.push(window)
    }
  }
  if (!windows.length) return undefined
  const result: Observation = { schemaVersion: 1, provider: "synthetic", account, pool: `synthetic:${account}`, routes: [], status: "available", source: URL,
    strategy: "synthetic.api", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows }
  if (typeof root.plan === "string") result.serviceStatus = root.plan
  if (truncated) result.serviceStatus = `${result.serviceStatus ? `${result.serviceStatus}; ` : ""}quota-list-partial`
  if (weekly) {
    const money = (value: unknown): number | undefined => numeric(typeof value === "string" ? value.replace(/[$,]/g, "") : value)
    const cap = money(weekly.maxCredits)
    const remaining = money(weekly.remainingCredits)
    if (cap !== undefined && cap > 0 && remaining !== undefined) windows.push({ id: "weekly-credits", kind: "weekly", unit: "USD", limit: cap, used: Math.max(0, cap - remaining), remaining,
      ...(reset(weekly) ? { resetAt: reset(weekly) } : {}) })
  }
  return result
}

export interface SyntheticOptions { account: string; apiKey: () => Promise<string | undefined>; fetch?: HttpTransport; now?: () => Date }
export function syntheticCollector(options: SyntheticOptions): Collector {
  return { id: "synthetic", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "synthetic", account: options.account, pool: `synthetic:${options.account}`, routes: [], source: URL }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    try {
      const response = await (options.fetch ?? fetch)(URL, { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", signal })
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      return parseSyntheticQuota(await response.json() as unknown, options.account, now) ?? unavailable(base, "invalid_response", now)
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
