import type { Collector, Observation, QuotaWindow, UsageAmount } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

/** models.dev snapshot's neuralwatt API base + pinned CodexBar /v1/quota suffix. */
const URL = "https://api.neuralwatt.com/v1/quota"
function row(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function nonnegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}
function date(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined
}

export function parseNeuralwattQuota(value: unknown, account: string, now = new Date()): Observation | undefined {
  const root = row(value)
  const balance = row(root?.balance)
  if (!root || !balance) return undefined
  const remainingCredit = nonnegative(balance.credits_remaining_usd)
  const usedCredit = nonnegative(balance.credits_used_usd)
  const totalCredit = nonnegative(balance.total_credits_usd)
  if (remainingCredit === undefined && usedCredit === undefined && totalCredit === undefined) return undefined
  const subscription = row(root.subscription)
  const allowance = row(row(root.key)?.allowance)
  const windows: QuotaWindow[] = []
  const included = nonnegative(subscription?.kwh_included) ?? ((nonnegative(subscription?.kwh_used) ?? NaN) + (nonnegative(subscription?.kwh_remaining) ?? NaN))
  const consumed = nonnegative(subscription?.kwh_used) ?? (Number.isFinite(included) && nonnegative(subscription?.kwh_remaining) !== undefined ? Math.max(0, included - nonnegative(subscription?.kwh_remaining)!) : undefined)
  if (Number.isFinite(included) && included > 0 && consumed !== undefined) {
    const start = date(subscription?.current_period_start)
    const end = date(subscription?.current_period_end)
    const duration = start && end ? Date.parse(end) - Date.parse(start) : undefined
    const kind = duration !== undefined && duration >= 28 * 86400000 && duration <= 31 * 86400000 ? "monthly" : "other"
    const window: QuotaWindow = { id: "subscription-kwh", kind, unit: "kWh", limit: included, used: consumed, remaining: Math.max(0, included - consumed) }
    if (end) window.resetAt = end
    windows.push(window)
  }
  const keyLimit = nonnegative(allowance?.limit_usd)
  const keySpent = nonnegative(allowance?.spent_usd)
  const keyRemaining = nonnegative(allowance?.remaining_usd)
  if (keyLimit !== undefined && keyLimit > 0 && (keySpent !== undefined || keyRemaining !== undefined)) windows.push({
    id: "key-allowance", kind: "credit", unit: "USD", limit: keyLimit,
    used: keySpent ?? Math.max(0, keyLimit - keyRemaining!), remaining: keyRemaining ?? Math.max(0, keyLimit - keySpent!),
    ...(typeof allowance?.period === "string" ? { scope: allowance.period } : {}),
  })
  const usage: UsageAmount[] = []
  const current = row(row(root.usage)?.current_month)
  const cost = nonnegative(current?.cost_usd)
  const energy = nonnegative(current?.energy_kwh)
  if (cost !== undefined) usage.push({ id: "month-cost", unit: "USD", currency: "USD", amount: cost, authority: "provider", period: "current-month" })
  if (energy !== undefined) usage.push({ id: "month-energy", unit: "kWh", amount: energy, authority: "provider", period: "current-month" })
  const credit = remainingCredit ?? (totalCredit !== undefined && usedCredit !== undefined ? Math.max(0, totalCredit - usedCredit) : undefined)
  const result: Observation = { schemaVersion: 1, provider: "neuralwatt", account, pool: `neuralwatt:${account}`, routes: [], status: "available", source: URL,
    strategy: "neuralwatt.api", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows }
  if (credit !== undefined) result.credits = [{ id: "prepaid", amount: credit, unit: "USD" }]
  if (usage.length) result.usage = usage
  if (allowance?.blocked === true) result.serviceStatus = "key-blocked"
  else if (typeof subscription?.status === "string") result.serviceStatus = subscription.status
  return result
}

export interface NeuralwattOptions { account: string; apiKey: () => Promise<string | undefined>; fetch?: HttpTransport; now?: () => Date }
export function neuralwattCollector(options: NeuralwattOptions): Collector {
  return { id: "neuralwatt", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "neuralwatt", account: options.account, pool: `neuralwatt:${options.account}`, routes: [], source: URL }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    try {
      const response = await (options.fetch ?? fetch)(URL, { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", signal })
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      return parseNeuralwattQuota(await response.json() as unknown, options.account, now) ?? unavailable(base, "invalid_response", now)
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
