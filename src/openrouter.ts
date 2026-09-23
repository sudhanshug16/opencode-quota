import type { Collector, Observation, QuotaWindow, UsageAmount } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

const BASE = "https://openrouter.ai/api/v1"
type Data = Record<string, unknown>
function object(value: unknown): Data | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Data : undefined
}
function amount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Selected inference key, never a provider-wide management key. */
export interface OpenRouterOptions {
  account: string
  apiKey: () => Promise<string | undefined>
  fetch?: HttpTransport
  now?: () => Date
}

/** Key limits and credits are independently optional in the upstream plugin. */
export function parseOpenRouter(keyPayload: unknown, creditsPayload: unknown, account: string, now = new Date()): Observation | undefined {
  const rawKey = object(object(keyPayload)?.data)
  const rawCredits = object(object(creditsPayload)?.data)
  const key = rawKey && ["limit", "limit_remaining", "usage", "usage_daily", "usage_weekly", "usage_monthly"].every(field => rawKey[field] == null || amount(rawKey[field]) !== undefined) && (rawKey.limit_reset == null || typeof rawKey.limit_reset === "string") ? rawKey : undefined
  const credits = rawCredits && amount(rawCredits.total_credits) !== undefined && amount(rawCredits.total_usage) !== undefined ? rawCredits : undefined
  const total = amount(credits?.total_credits)
  const spent = amount(credits?.total_usage)
  const limit = amount(key?.limit)
  const cumulative = amount(key?.usage)
  const remaining = amount(key?.limit_remaining)
  const reset = key?.limit_reset
  const windowField = reset === "daily" ? "usage_daily" : reset === "weekly" ? "usage_weekly" : reset === "monthly" ? "usage_monthly" : undefined
  const periodUsed = windowField ? amount(key?.[windowField]) : undefined
  if ((!key || [limit, cumulative, remaining, amount(key.usage_daily), amount(key.usage_weekly), amount(key.usage_monthly)].every(value => value === undefined)) && !credits) return undefined
  const windows: QuotaWindow[] = []
  if (limit !== undefined && limit > 0) {
    const used = remaining !== undefined ? limit - Math.min(limit, remaining) : periodUsed ?? cumulative
    if (used !== undefined) windows.push({ id: "api-key", kind: "credit", unit: "USD", limit, used: Math.max(0, used), remaining: Math.max(0, limit - Math.max(0, used)), scope: typeof reset === "string" ? reset : undefined })
  }
  const usage: UsageAmount[] = []
  for (const [id, field] of [["daily", "usage_daily"], ["weekly", "usage_weekly"], ["monthly", "usage_monthly"]] as const) {
    const value = amount(key?.[field])
    if (value !== undefined) usage.push({ id: `key-${id}`, unit: "USD", amount: value, authority: "provider", period: id, currency: "USD" })
  }
  if (cumulative !== undefined) usage.push({ id: "key-total", unit: "USD", amount: cumulative, authority: "provider", currency: "USD" })
  if (spent !== undefined) usage.push({ id: "account-total", unit: "USD", amount: spent, authority: "provider", currency: "USD" })
  return {
    schemaVersion: 1, provider: "openrouter", account, pool: "selected-api-key", routes: [], status: "available",
    source: `${BASE}/key + ${BASE}/credits`, strategy: "openrouter.js", observedAt: now.toISOString(),
    freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows, usage,
    ...(total !== undefined && spent !== undefined ? { credits: [{ id: "account-balance", amount: Math.max(0, total - spent), unit: "USD" }] } : {}),
  }
}

export function openRouterCollector(options: OpenRouterOptions): Collector {
  return { id: "openrouter", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "openrouter", account: options.account, pool: "selected-api-key", routes: [], source: BASE }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    const transport = options.fetch ?? fetch
    const headers = { Authorization: `Bearer ${key}`, Accept: "application/json", "X-Title": "opencode-quota" }
    const results = await Promise.all(["key", "credits"].map(async endpoint => {
      try {
        const response = await transport(`${BASE}/${endpoint}`, { method: "GET", headers, redirect: "manual", signal })
        if (response.redirected || !response.ok) return { status: response.status }
        return { status: response.status, body: await response.json() as unknown }
      } catch { return { status: 0 } }
    }))
    if (results.some(result => result.status === 401 || result.status === 403)) return unavailable(base, "auth", now)
    const [keyResult, creditResult] = results
    const parsed = parseOpenRouter(keyResult?.body, creditResult?.body, options.account, now)
    return parsed ?? unavailable(base, results.some(result => result.status === 200) ? "invalid_response" : "transport", now)
  } }
}
