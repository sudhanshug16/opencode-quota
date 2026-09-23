import type { IntegrationDomain } from "@opencode/plugin/promise/integration"
import type { Collector, CreditBalance, Observation, UsageAmount } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

const ROOT = "https://api.poe.com/usage/"
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function number(value: unknown): number | undefined {
  if (value == null || typeof value === "string" && !value.trim()) return undefined
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}
function date(value: unknown): Date | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return undefined
  const raw = Number(value)
  const timestamp = Number.isFinite(raw) ? raw > 1e14 ? raw / 1000 : raw > 1e12 ? raw : raw * 1000 : Date.parse(value as string)
  const result = new Date(timestamp)
  return Number.isFinite(result.getTime()) ? result : undefined
}

/** Poe OAuth browser method stores a Poe API key in access; it cannot refresh an expired key. */
export async function selectedPoeToken(connection: IntegrationDomain["connection"], connectionId: string, now = Date.now()): Promise<string | undefined> {
  const active = await connection.active("poe")
  if (active?.type !== "credential" || active.id !== connectionId) return undefined
  const value = await connection.resolve(active)
  if (active.method === "key" && value?.type === "key") return value.key || undefined
  if (active.method === "oauth" && value?.type === "oauth" && value.methodID === "browser" && value.expires > now + 30_000) return value.access || undefined
  return undefined
}

export function parsePoeBalance(value: unknown): CreditBalance[] | undefined {
  const body = record(value)
  if (!body) return undefined
  const balance = number(body.current_point_balance)
  return balance !== undefined ? [{ id: "point-balance", amount: balance, unit: "points" }] : []
}

export interface PoeOptions {
  account: string
  apiKey: () => Promise<string | undefined>
  fetch?: HttpTransport
  now?: () => Date
}

/** Balance is authoritative; history is best effort and never yields a synthetic subscription ceiling. */
export function poeCollector(options: PoeOptions): Collector {
  return { id: "poe", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "poe", account: options.account, pool: `poe:${options.account}`, routes: [], source: ROOT }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    const http = options.fetch ?? fetch
    const init: RequestInit = { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "manual", signal }
    let credits: CreditBalance[] | undefined
    try {
      const response = await http(`${ROOT}current_balance`, init)
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      credits = parsePoeBalance(await response.json() as unknown)
      if (!credits) return unavailable(base, "invalid_response", now)
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
    const entries: { at: Date; points: number; usd?: number }[] = []
    const cutoff = now.getTime() - 30 * 86400000
    let cursor: string | undefined
    let historyComplete = true
    try {
      for (let page = 0; page < 5; page++) {
        const url = `${ROOT}points_history?limit=100${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ""}`
        const response = await http(url, init)
        if (!response.ok || response.redirected) { historyComplete = false; break }
        const root = record(await response.json() as unknown)
        if (!root) { historyComplete = false; break }
        const rows = Array.isArray(root.data) ? root.data : Array.isArray(root.items) ? root.items : Array.isArray(root.results) ? root.results : []
        for (const item of rows) {
          const entry = record(item)
          const at = date(entry?.creation_time ?? entry?.timestamp ?? entry?.created_at)
          if (!at || at.getTime() < cutoff || at.getTime() > now.getTime()) continue
          const points = number(entry?.cost_points ?? entry?.points ?? entry?.point_cost)
          const usd = number(entry?.cost_usd ?? entry?.usd)
          if (points === undefined || points < 0) continue
          entries.push({ at, points, ...(usd !== undefined && usd >= 0 ? { usd } : {}) })
        }
        const next = typeof root.next_cursor === "string" && root.next_cursor.trim() ? root.next_cursor.trim() : root.has_more === true ? record(rows.at(-1))?.query_id : undefined
        if (typeof next !== "string" || !next.trim() || next === cursor) break
        cursor = next
        if (page === 4) historyComplete = false
        const last = record(rows.at(-1))
        const lastAt = date(last?.creation_time ?? last?.timestamp ?? last?.created_at)
        if (lastAt && lastAt.getTime() < cutoff) break
      }
    } catch { historyComplete = false /* Pinned Poe route treats history errors as best effort. */ }
    const usage: UsageAmount[] = []
    for (const [period, since] of [["today", Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)], ["7d", now.getTime() - 7 * 86400000], ["30d", cutoff]] as const) {
      const selected = entries.filter(entry => entry.at.getTime() >= since)
      if (!selected.length) continue
      const coverage = historyComplete ? period : `observed-${period}`
      usage.push({ id: `points-${period}`, amount: selected.reduce((sum, item) => sum + item.points, 0), unit: "points", authority: "provider", period: coverage })
      if (selected.some(item => item.usd !== undefined)) usage.push({ id: `spend-${period}`, amount: selected.reduce((sum, item) => sum + (item.usd ?? 0), 0), unit: "USD", currency: "USD", authority: "provider", period: coverage })
    }
    const result: Observation = { schemaVersion: 1, ...base, status: "available", strategy: "poe.api", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows: [] }
    if (credits.length) result.credits = credits
    if (usage.length) result.usage = usage
    return result
  } }
}
