import type { Collector, Observation, UsageAmount } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

const CHECKLIST = "https://api.deepinfra.com/payment/checklist?compute_owed=true"
const USAGE = "https://api.deepinfra.com/payment/usage?from=current"
function row(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** Pinned DeepInfra checklist monetary fields are USD; usage.months[].total_cost is cents. */
export function parseDeepInfraUsage(checklistValue: unknown, usageValue: unknown, account: string, now = new Date()): Observation | undefined {
  const checklist = row(checklistValue)
  const usage = row(usageValue)
  const stripe = finite(checklist?.stripe_balance)
  const recent = finite(checklist?.recent)
  if (!checklist || !usage || stripe === undefined || recent === undefined || !Array.isArray(usage.months)) return undefined
  const months = usage.months
  const latest = months.length ? row(months.at(-1)) : undefined
  const cents = latest ? finite(latest.total_cost) : undefined
  if (latest && (typeof latest.period !== "string" || cents === undefined)) return undefined
  const net = stripe + Math.max(0, recent)
  const currentMonth = cents !== undefined ? Math.max(0, cents / 100) : Math.max(0, recent)
  const limit = finite(checklist.limit)
  const result: Observation = { schemaVersion: 1, provider: "deepinfra", account, pool: `deepinfra:${account}`, routes: [], status: "available",
    source: CHECKLIST, strategy: "deepinfra.api", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows: [],
    credits: [{ id: "available-balance", amount: Math.max(0, -net), unit: "USD" }] }
  const amounts: UsageAmount[] = [
    { id: "recent-spend", amount: Math.max(0, recent), unit: "USD", currency: "USD", authority: "provider", period: "billing-cycle" },
    { id: "current-month-spend", amount: currentMonth, unit: "USD", currency: "USD", authority: "provider", period: "current-month" },
  ]
  if (net > 0) amounts.push({ id: "amount-owed", amount: net, unit: "USD", currency: "USD", authority: "provider" })
  result.usage = amounts
  if (limit !== undefined && limit > 0) result.windows = [{ id: "spending-limit", kind: "credit", unit: "USD", limit, used: Math.max(0, recent), remaining: Math.max(0, limit - Math.max(0, recent)) }]
  if (checklist.suspended === true) result.serviceStatus = "suspended"
  return result
}

export interface DeepInfraOptions {
  account: string
  apiKey: () => Promise<string | undefined>
  fetch?: HttpTransport
  now?: () => Date
}

export function deepInfraCollector(options: DeepInfraOptions): Collector {
  return { id: "deepinfra", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "deepinfra", account: options.account, pool: `deepinfra:${options.account}`, routes: [], source: CHECKLIST }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    const http = options.fetch ?? fetch
    const init: RequestInit = { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", signal }
    try {
      const checklist = await http(CHECKLIST, init)
      if (checklist.status === 401 || checklist.status === 403) return unavailable(base, "auth", now)
      if (!checklist.ok || checklist.redirected) return unavailable(base, "transport", now)
      const body = await checklist.json() as unknown
      const usage = await http(USAGE, init)
      if (usage.status === 401 || usage.status === 403) return unavailable(base, "auth", now)
      if (!usage.ok || usage.redirected) return unavailable(base, "transport", now)
      return parseDeepInfraUsage(body, await usage.json() as unknown, options.account, now) ?? unavailable(base, "invalid_response", now)
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
