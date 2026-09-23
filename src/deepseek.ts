import type { Collector, Observation } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

const URL = "https://api.deepseek.com/user/balance"
type Row = { currency: string; total: number; granted: number; toppedUp: number }
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function balance(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** DeepSeek API keys expose balance, not the platform-session usage history. */
export function parseDeepSeekBalance(value: unknown, account: string, now = new Date()): Observation | undefined {
  const body = record(value)
  if (typeof body?.is_available !== "boolean" || !Array.isArray(body.balance_infos)) return undefined
  const rows: Row[] = []
  for (const entry of body.balance_infos) {
    const row = record(entry)
    if (!row || typeof row.currency !== "string" || !row.currency.trim()) return undefined
    const total = balance(row.total_balance)
    const granted = balance(row.granted_balance)
    const toppedUp = balance(row.topped_up_balance)
    if (total === undefined || granted === undefined || toppedUp === undefined) return undefined
    rows.push({ currency: row.currency, total, granted, toppedUp })
  }
  const selected = rows.find(row => row.currency === "USD" && row.total > 0)
    ?? rows.find(row => row.total > 0) ?? rows.find(row => row.currency === "USD") ?? rows[0]
  return {
    schemaVersion: 1, provider: "deepseek", account, pool: "api-balance", routes: [], status: "available",
    source: URL, strategy: "api-balance", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(),
    windows: [], serviceStatus: body.is_available ? "api-available" : "api-unavailable",
    credits: selected ? [
      { id: "total", amount: selected.total, unit: selected.currency },
      { id: "granted", amount: selected.granted, unit: selected.currency },
      { id: "topped-up", amount: selected.toppedUp, unit: selected.currency },
    ] : [],
  }
}

export interface DeepSeekOptions {
  account: string
  apiKey: () => Promise<string | undefined>
  fetch?: HttpTransport
  now?: () => Date
}

export function deepSeekCollector(options: DeepSeekOptions): Collector {
  return { id: "deepseek", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "deepseek", account: options.account, pool: "api-balance", routes: [], source: URL }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    try {
      const response = await (options.fetch ?? fetch)(URL, { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", signal })
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      return parseDeepSeekBalance(await response.json() as unknown, options.account, now) ?? unavailable(base, "invalid_response", now)
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
