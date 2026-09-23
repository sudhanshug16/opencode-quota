import type { Collector, Observation, QuotaWindow } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

export type ZaiRegion = "global" | "bigmodel-cn"
export type ZaiScope = { kind: "personal" } | { kind: "team"; organization: string; project: string }
const ORIGINS: Record<ZaiRegion, string> = { global: "https://api.z.ai", "bigmodel-cn": "https://open.bigmodel.cn" }
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function integer(value: unknown): number | null | undefined {
  return value == null ? null : typeof value === "number" && Number.isSafeInteger(value) ? value : undefined
}

/** Coding Plan quota; model history and CN PAYG balance are distinct capabilities. */
export function parseZaiQuota(value: unknown, account: string, region: ZaiRegion, scope: ZaiScope, now = new Date()): Observation | undefined {
  const root = record(value)
  const data = record(root?.data)
  if (root?.success !== true || root.code !== 200 || !Array.isArray(data?.limits)) return undefined
  const windows: QuotaWindow[] = []
  const multipliers: Record<number, number> = { 1: 1440, 3: 60, 5: 1, 6: 10080 }
  for (const item of data.limits) {
    const row = record(item)
    if (!row || typeof row.type !== "string" || !Number.isSafeInteger(row.unit) || !Number.isSafeInteger(row.number) || !Number.isSafeInteger(row.percentage)) return undefined
    if (!["TOKENS_LIMIT", "TIME_LIMIT", "CREDIT_LIMIT"].includes(row.type)) continue
    const usage = integer(row.usage)
    const current = integer(row.currentValue)
    const remaining = integer(row.remaining)
    const reset = integer(row.nextResetTime)
    if ([usage, current, remaining, reset].some(x => x === undefined) || (row.usageDetails != null && !Array.isArray(row.usageDetails))) return undefined
    const unit = row.unit as number
    const number = row.number as number
    const minutes = number > 0 && multipliers[unit] ? number * multipliers[unit] : undefined
    const id = row.type === "TIME_LIMIT" ? "mcp" : minutes === 300 ? "five-hour" : minutes === 10080 ? "week" : `${String(row.type).toLowerCase()}-${unit}-${number}`
    const calculated = usage !== null && usage !== undefined && usage > 0
      ? remaining !== null && remaining !== undefined ? Math.max(usage - remaining, current ?? usage - remaining) : current
      : null
    const percent = calculated !== null && calculated !== undefined && usage !== null && usage !== undefined && usage > 0
      ? Math.max(0, Math.min(100, Math.max(0, Math.min(usage, calculated)) / usage * 100))
      : Math.max(0, Math.min(100, row.percentage as number))
    const window: QuotaWindow = { id, kind: minutes === 10080 ? "weekly" : "rolling", unit: "percent", limit: 100, used: percent, remaining: 100 - percent,
      scope: row.type === "TIME_LIMIT" ? "mcp" : row.type === "CREDIT_LIMIT" ? "credit" : "tokens" }
    if (reset !== null && reset !== undefined && reset >= 0 && reset <= 8.64e15 &&
      (row.type === "TIME_LIMIT" || minutes !== 300 || reset <= now.getTime() + (5 * 3600 + 60) * 1000)) window.resetAt = new Date(reset).toISOString()
    windows.push(window)
  }
  if (!windows.length) return undefined
  return { schemaVersion: 1, provider: "zai", account, pool: scope.kind === "team" ? `team:${scope.organization}/${scope.project}` : `personal-${region}`,
    routes: [], status: "available", source: `${ORIGINS[region]}/api/monitor/usage/quota/limit`, strategy: "zai.quota-api",
    observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows }
}

export interface ZaiOptions {
  account: string
  region: ZaiRegion
  scope: ZaiScope
  apiKey: () => Promise<string | undefined>
  /** Opt-in best-effort CN account balance, never treated as Coding Plan quota. */
  includeCnBalance?: boolean
  fetch?: HttpTransport
  now?: () => Date
}

export function zaiCollector(options: ZaiOptions): Collector {
  if (!(options.region in ORIGINS) || (options.scope.kind === "team" && (!options.scope.organization || !options.scope.project))) throw new Error("Invalid z.ai region or team selection")
  const origin = ORIGINS[options.region]
  const path = "/api/monitor/usage/quota/limit"
  const url = `${origin}${path}${options.scope.kind === "team" ? "?type=2" : ""}`
  return { id: "zai", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "zai", account: options.account, pool: options.scope.kind === "team" ? `team:${options.scope.organization}/${options.scope.project}` : `personal-${options.region}`, routes: [], source: url }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: "application/json" }
    if (options.scope.kind === "team") {
      headers["Bigmodel-Organization"] = options.scope.organization
      headers["Bigmodel-Project"] = options.scope.project
    }
    try {
      const response = await (options.fetch ?? fetch)(url, { method: "GET", headers, redirect: "manual", signal })
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      const observation = parseZaiQuota(await response.json() as unknown, options.account, options.region, options.scope, now)
      if (!observation) return unavailable(base, "invalid_response", now)
      if (options.includeCnBalance && options.region === "bigmodel-cn" && options.scope.kind === "personal") {
        try {
          const balanceResponse = await (options.fetch ?? fetch)("https://www.bigmodel.cn/api/biz/account/query-customer-account-report", {
            method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", signal,
          })
          if (balanceResponse.ok && !balanceResponse.redirected) {
            const balance = parseZaiCnBalance(await balanceResponse.json() as unknown)
            if (balance !== undefined) observation.credits = [{ id: "cn-payg", amount: balance, unit: "CNY" }]
          }
        } catch { /* optional account balance must not discard Coding Plan quota */ }
      }
      return observation
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}

/** Prefer availableBalance over balance; absent/null values must never become ¥0. */
export function parseZaiCnBalance(value: unknown): number | undefined {
  const root = record(value)
  if (root?.success !== true) return undefined
  const data = record(root.data)
  const numeric = (raw: unknown): number | undefined => {
    if (raw === null || raw === undefined || raw === "") return undefined
    const parsed = typeof raw === "string" || typeof raw === "number" ? Number(raw) : NaN
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return numeric(data?.availableBalance) ?? numeric(data?.balance)
}
