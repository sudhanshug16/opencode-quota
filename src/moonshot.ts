import type { Collector, Observation } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

export type MoonshotRegion = "global" | "china"
const ORIGINS: Record<MoonshotRegion, string> = { global: "https://api.moonshot.ai", china: "https://api.moonshot.cn" }
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Account balance and cash deficit are not subscription quota. */
export function parseMoonshotBalance(value: unknown, account: string, region: MoonshotRegion, now = new Date()): Observation | undefined {
  const root = record(value)
  const data = record(root?.data)
  if (!root || !data || !Number.isInteger(root.code) || typeof root.scode !== "string" || typeof root.status !== "boolean") return undefined
  if (root.code !== 0 || !root.status) return undefined
  const balance = data.available_balance
  const cash = data.cash_balance
  const voucher = data.voucher_balance
  if (![balance, cash, voucher].every(value => typeof value === "number" && Number.isFinite(value))) return undefined
  const unit = region === "china" ? "CNY" : "USD"
  return { schemaVersion: 1, provider: "moonshot", account, pool: `moonshot-${region}`, routes: [], status: "available",
    source: `${ORIGINS[region]}/v1/users/me/balance`, strategy: "moonshot.js", observedAt: now.toISOString(),
    freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows: [],
    credits: [{ id: "available", amount: balance as number, unit }, { id: "cash", amount: cash as number, unit }, { id: "voucher", amount: voucher as number, unit }],
  }
}

export interface MoonshotOptions {
  account: string
  region: MoonshotRegion
  apiKey: () => Promise<string | undefined>
  fetch?: HttpTransport
  now?: () => Date
}

export function moonshotCollector(options: MoonshotOptions): Collector {
  if (!(options.region in ORIGINS)) throw new Error("Moonshot region must be global or china")
  const url = `${ORIGINS[options.region]}/v1/users/me/balance`
  return { id: "moonshot", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "moonshot", account: options.account, pool: `moonshot-${options.region}`, routes: [], source: url }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    try {
      const response = await (options.fetch ?? fetch)(url, { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", signal })
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      return parseMoonshotBalance(await response.json() as unknown, options.account, options.region, now) ?? unavailable(base, "invalid_response", now)
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
