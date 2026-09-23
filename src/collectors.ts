import { type Collector, type Observation, type QuotaWindow, unavailable } from "./core.js"

type Fetch = (input: string, init: RequestInit) => Promise<Response>
type ObjectValue = Record<string, unknown>
const GO_URL = "https://opencode.ai/zen/go/v1/usage"

function record(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : undefined
}

function percentWindow(value: unknown, id: string, kind: QuotaWindow["kind"], now: Date): QuotaWindow | undefined {
  const data = record(value)
  if (!data || typeof data.percent !== "number" || !Number.isFinite(data.percent) || data.percent < 0 || data.percent > 100) return undefined
  const result: QuotaWindow = { id, kind, unit: "percent", limit: 100, used: data.percent, remaining: 100 - data.percent }
  if (typeof data.resetInSec === "number" && Number.isFinite(data.resetInSec) && data.resetInSec >= 0) {
    const reset = now.getTime() + data.resetInSec * 1000
    if (Number.isFinite(reset) && reset <= 8.64e15) result.resetAt = new Date(reset).toISOString()
  } else if (typeof data.resetAt === "string" && !Number.isNaN(Date.parse(data.resetAt))) {
    result.resetAt = new Date(data.resetAt).toISOString()
  }
  return result
}

/** Public Go usage API reports whole percent units (1 means 1%, not 100%). */
export function parseGoUsage(value: unknown, account: string, now = new Date(), ttlMs = 60_000): Observation | undefined {
  const usage = record(record(value)?.usage)
  const rolling = percentWindow(usage?.rolling, "five-hour", "rolling", now)
  if (!rolling) return undefined
  const windows = [rolling]
  for (const [field, id, kind] of [["weekly", "week", "weekly"], ["monthly", "month", "monthly"]] as const) {
    if (usage?.[field] !== undefined && usage[field] !== null) {
      const parsed = percentWindow(usage[field], id, kind, now)
      if (!parsed) return undefined
      windows.push(parsed)
    }
  }
  return { schemaVersion: 1, provider: "opencode-go", account, pool: "go-usage", routes: [], status: "available", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + ttlMs).toISOString(), source: GO_URL, windows }
}

export interface GoOptions {
  /** Explicit API key from the caller; never returned in observations. */
  apiKey: () => Promise<string | undefined>
  account: string
  fetch?: Fetch
  now?: () => Date
}

export function goCollector(options: GoOptions): Collector {
  return {
    id: "opencode-go",
    async collect(signal) {
      const now = options.now?.() ?? new Date()
      const base = { provider: "opencode-go", account: options.account, pool: "go-usage", routes: [], source: GO_URL }
      let key: string | undefined
      try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
      if (!key) return unavailable(base, "not_configured", now)
      try {
        // Redirects are refused so bearer credentials cannot be forwarded to another host.
        const response = await (options.fetch ?? fetch)(GO_URL, { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "User-Agent": "opencode-quota/0.1" }, redirect: "manual", signal })
        if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
        if (!response.ok || response.redirected || (response.status >= 300 && response.status < 400)) return unavailable(base, "transport", now)
        return parseGoUsage(await response.json() as unknown, options.account, now) ?? unavailable(base, "invalid_response", now)
      } catch {
        return unavailable(base, signal.aborted ? "timeout" : "transport", now)
      }
    },
  }
}

/** Unsupported sources are explicit and never manufacture zero remaining. */
export function unsupportedCollector(provider: string, account = "unknown"): Collector {
  return { id: provider, async collect() { return unavailable({ provider, account, pool: "unknown", routes: [], source: "none" }, "unsupported") } }
}
