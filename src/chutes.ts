import type { Collector, Observation, QuotaWindow } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

const URL = "https://api.chutes.ai/users/me/subscription_usage"
function row(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function finite(value: unknown): number | undefined {
  const result = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN
  return Number.isFinite(result) ? result : undefined
}
function date(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined
}

/** Direct Chutes subscription endpoint only; per-quota definition/enrichment is a separate acquisition route. */
export function parseChutesSubscription(value: unknown, account: string, now = new Date()): Observation | undefined {
  const body = row(value)
  if (!body) return undefined
  const data = row(body.data) ?? body
  const subscription = row(data.subscription)
  const windows: QuotaWindow[] = []
  const parse = (value: unknown, id: string, kind: QuotaWindow["kind"]): void => {
    const quota = row(value)
    if (!quota) return
    const limit = finite(quota.limit ?? quota.quota)
    const reportedUsed = finite(quota.used ?? quota.usage ?? quota.requests)
    const reportedRemaining = finite(quota.remaining)
    const percent = finite(quota.percent_used ?? quota.percentUsed)
    const inferred = limit !== undefined && limit > 0 ? reportedUsed ?? (reportedRemaining !== undefined ? limit - reportedRemaining : undefined) : undefined
    const used = percent !== undefined ? Math.max(0, Math.min(100, percent)) : inferred !== undefined && limit !== undefined ? Math.max(0, Math.min(100, inferred / limit * 100)) : undefined
    if (used === undefined) return
    const rawUsed = reportedUsed ?? (reportedRemaining !== undefined && limit !== undefined ? limit - reportedRemaining : undefined)
    const window: QuotaWindow = limit !== undefined && limit > 0 && rawUsed !== undefined
      ? { id, kind, unit: typeof quota.unit === "string" && quota.unit.trim() ? quota.unit : "credits", limit, used: rawUsed, remaining: Math.max(0, limit - rawUsed) }
      : { id, kind, unit: "percent", limit: 100, used, remaining: 100 - used }
    const reset = date(quota.resets_at ?? quota.reset_at ?? quota.resetsAt ?? subscription?.current_period_end)
    if (reset) window.resetAt = reset
    windows.push(window)
  }
  parse(data.rolling_window ?? data.rolling, "rolling", "rolling")
  parse(data.monthly ?? data.monthly_usage, "monthly", "monthly")
  if (!windows.length && subscription?.active !== false) return undefined
  const result: Observation = { schemaVersion: 1, provider: "chutes", account, pool: `chutes:${account}`, routes: [], status: "available", source: URL,
    strategy: "chutes.subscription-api", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows }
  if (subscription?.active === false) result.serviceStatus = "inactive"
  else if (typeof subscription?.plan_name === "string") result.serviceStatus = subscription.plan_name
  return result
}

export interface ChutesOptions {
  account: string
  apiKey: () => Promise<string | undefined>
  fetch?: HttpTransport
  now?: () => Date
}

export function chutesCollector(options: ChutesOptions): Collector {
  return { id: "chutes", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "chutes", account: options.account, pool: `chutes:${options.account}`, routes: [], source: URL }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    try {
      const response = await (options.fetch ?? fetch)(URL, { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", signal })
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      return parseChutesSubscription(await response.json() as unknown, options.account, now) ?? unavailable(base, "invalid_response", now)
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
