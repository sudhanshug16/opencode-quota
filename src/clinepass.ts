import type { Collector, Observation, QuotaWindow } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

const URL = "https://api.cline.bot/api/v1/users/me/plan/usage-limits"
function row(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Port of pinned Resources/Plugins/clinepass.ts accepted window types and validation. */
export function parseClinePassUsage(value: unknown, account: string, now = new Date()): Observation | undefined {
  const body = row(value)
  const data = row(body?.data)
  if (body?.success !== true || !Array.isArray(data?.limits)) return undefined
  const windows = new Map<string, QuotaWindow>()
  for (const value of data.limits) {
    const limit = row(value)
    if (!limit || typeof limit.type !== "string") return undefined
    if (!["five_hour", "weekly", "monthly"].includes(limit.type)) continue
    if (typeof limit.percentUsed !== "number" || !Number.isFinite(limit.percentUsed)) return undefined
    const used = Math.max(0, Math.min(100, limit.percentUsed))
    const window: QuotaWindow = { id: limit.type, kind: limit.type === "weekly" ? "weekly" : limit.type === "monthly" ? "monthly" : "rolling", unit: "percent", limit: 100, used, remaining: 100 - used }
    if (limit.resetsAt != null) {
      if (typeof limit.resetsAt !== "string" || !Number.isFinite(Date.parse(limit.resetsAt))) return undefined
      window.resetAt = new Date(limit.resetsAt).toISOString()
    }
    windows.set(limit.type, window)
  }
  return { schemaVersion: 1, provider: "clinepass", account, pool: `clinepass:${account}`, routes: [], status: "available", source: URL,
    strategy: "clinepass.api", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(),
    windows: ["five_hour", "weekly", "monthly"].flatMap(id => windows.has(id) ? [windows.get(id)!] : []) }
}

export interface ClinePassOptions {
  account: string
  apiKey: () => Promise<string | undefined>
  fetch?: HttpTransport
  now?: () => Date
}

export function clinePassCollector(options: ClinePassOptions): Collector {
  return { id: "clinepass", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "clinepass", account: options.account, pool: `clinepass:${options.account}`, routes: [], source: URL }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    try {
      const response = await (options.fetch ?? fetch)(URL, { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", signal })
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      return parseClinePassUsage(await response.json() as unknown, options.account, now) ?? unavailable(base, "invalid_response", now)
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
