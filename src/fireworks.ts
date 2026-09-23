import type { Collector, Observation } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Rated lines only; Fireworks has no credit-balance or subscription-quota API. */
export function parseFireworksSummary(value: unknown, account: string, slug: string, now = new Date()): Observation | undefined {
  const body = record(value)
  if (!body || (body.lineItems != null && !Array.isArray(body.lineItems))) return undefined
  let currency: string | undefined
  let total = 0
  for (const item of body.lineItems ?? []) {
    const cost = record(record(item)?.totalCost)
    if (!cost || typeof cost.units !== "string" || !/^-?\d+$/.test(cost.units) || !Number.isSafeInteger(cost.nanos) || typeof cost.currencyCode !== "string" || !cost.currencyCode.trim()) continue
    const amount = Number(cost.units) + (cost.nanos as number) / 1e9
    if (!Number.isFinite(amount)) return undefined
    currency ??= cost.currencyCode.trim()
    if (cost.currencyCode.trim() === currency) total += amount
  }
  if (!currency || !Number.isFinite(total)) return undefined
  return { schemaVersion: 1, provider: "fireworks", account, pool: `account:${slug}`, routes: [], status: "available",
    source: `https://api.fireworks.ai/v1/accounts/${slug}/billing/summary`, strategy: "billing-summary",
    observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows: [],
    usage: [{ id: "last-30-days-spend", unit: currency, amount: total, authority: "provider", period: "last-30-days", currency }],
  }
}

export interface FireworksOptions {
  account: string
  accountSlug: string
  apiKey: () => Promise<string | undefined>
  fetch?: HttpTransport
  now?: () => Date
}

export function fireworksCollector(options: FireworksOptions): Collector {
  if (!/^[a-zA-Z0-9._-]+$/.test(options.accountSlug)) throw new Error("Invalid Fireworks account slug")
  const baseURL = `https://api.fireworks.ai/v1/accounts/${options.accountSlug}/billing/summary`
  return { id: "fireworks", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "fireworks", account: options.account, pool: `account:${options.accountSlug}`, routes: [], source: baseURL }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    const url = new URL(baseURL)
    url.searchParams.set("startTime", new Date(now.getTime() - 30 * 86_400_000).toISOString().replace(/\.000Z$/, "Z"))
    url.searchParams.set("endTime", now.toISOString().replace(/\.000Z$/, "Z"))
    try {
      const response = await (options.fetch ?? fetch)(url.toString(), { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", signal })
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      return parseFireworksSummary(await response.json() as unknown, options.account, options.accountSlug, now) ?? unavailable(base, "invalid_response", now)
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
