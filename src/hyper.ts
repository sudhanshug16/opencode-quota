import type { Collector, Observation } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

const URL = "https://hyper.charm.land/v1/credits"
/** The pinned Hyper API returns HC balance only; it is not a usage percentage. */
export function parseHyperBalance(value: unknown, account: string, now = new Date()): Observation | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined
  const balance = (value as Record<string, unknown>).balance
  if (typeof balance !== "number" || !Number.isFinite(balance) || balance < 0) return undefined
  return { schemaVersion: 1, provider: "hyper", account, pool: `hyper:${account}`, routes: [], status: "available", source: URL,
    strategy: "hyper.api", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows: [],
    credits: [{ id: "balance", amount: balance, unit: "HC" }] }
}

export interface HyperOptions { account: string; apiKey: () => Promise<string | undefined>; fetch?: HttpTransport; now?: () => Date }
export function hyperCollector(options: HyperOptions): Collector {
  return { id: "hyper", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "hyper", account: options.account, pool: `hyper:${options.account}`, routes: [], source: URL }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    try {
      const response = await (options.fetch ?? fetch)(URL, { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", signal })
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      return parseHyperBalance(await response.json() as unknown, options.account, now) ?? unavailable(base, "invalid_response", now)
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
