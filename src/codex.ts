import type { Collector, Observation, QuotaWindow } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

const URL = "https://chatgpt.com/backend-api/wham/usage"
/** Check audience method, account binding and expiry before sending a stored OAuth access token. */
export function codexAccess(credential: { type: string; methodID?: string; metadata?: Readonly<Record<string, unknown>>; access?: string; expires?: number } | undefined, accountId: string, now = Date.now()): string | undefined {
  if (credential?.type !== "oauth" || !["chatgpt-browser", "chatgpt-headless"].includes(credential.methodID ?? "")) return undefined
  if (credential.metadata?.accountID !== accountId || typeof credential.expires !== "number" || credential.expires <= now + 30_000) return undefined
  return typeof credential.access === "string" && credential.access ? credential.access : undefined
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** Only the pinned wham/usage OAuth route; CLI, PAT, cookies and refresh are separate. */
export function parseCodexUsage(value: unknown, account: string, accountId: string, now = new Date()): Observation | undefined {
  const body = record(value)
  if (!body) return undefined
  const reportedAccount = body.account_id ?? body.accountId
  if (reportedAccount !== undefined && reportedAccount !== accountId) return undefined
  const rate = record(body.rate_limit)
  const windows: QuotaWindow[] = []
  const parseWindow = (value: unknown, id: string): void => {
    if (value == null) return
    const row = record(value)
    if (!row || !Number.isSafeInteger(row.used_percent) || !Number.isSafeInteger(row.reset_at) || !Number.isSafeInteger(row.limit_window_seconds)) return
    const used = row.used_percent as number
    const reset = row.reset_at as number
    if (used < 0 || used > 100 || reset < 0 || reset * 1000 > 8.64e15) return
    const window: QuotaWindow = { id, kind: (row.limit_window_seconds as number) >= 604800 ? "weekly" : "rolling", unit: "percent", limit: 100, used, remaining: 100 - used }
    window.resetAt = new Date(reset * 1000).toISOString()
    windows.push(window)
  }
  parseWindow(rate?.primary_window, "primary")
  parseWindow(rate?.secondary_window, "secondary")
  if (Array.isArray(body.additional_rate_limits)) {
    for (const item of body.additional_rate_limits) {
      const entry = record(item)
      const name = entry?.limit_name ?? entry?.metered_feature
      if (typeof name !== "string" || !name.trim() || name.length > 100) continue
      const extra = record(entry?.rate_limit)
      parseWindow(extra?.primary_window, `${name}:primary`)
      parseWindow(extra?.secondary_window, `${name}:secondary`)
    }
  }
  const credits = record(body.credits)
  const balance = finite(credits?.balance) ?? (typeof credits?.balance === "string" ? Number(credits.balance) : undefined)
  if (!windows.length && (credits?.has_credits !== true || credits.unlimited === true || balance === undefined || !Number.isFinite(balance))) return undefined
  const result: Observation = { schemaVersion: 1, provider: "codex", account, pool: `chatgpt:${accountId}`, routes: [], status: "available",
    source: URL, strategy: "codex.oauth-wham", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows }
  if (credits?.has_credits === true && credits.unlimited !== true && balance !== undefined && Number.isFinite(balance)) result.credits = [{ id: "balance", amount: balance, unit: "credits" }]
  if (typeof body.plan_type === "string") result.serviceStatus = body.plan_type
  return result
}

export interface CodexOptions {
  account: string
  accountId: string
  /** Already-resolved OpenCode OAuth access token. No local CLI or refresh-token access. */
  accessToken: () => Promise<string | undefined>
  fetch?: HttpTransport
  now?: () => Date
}

export function codexCollector(options: CodexOptions): Collector {
  if (!options.accountId.trim() || /[\r\n]/.test(options.accountId)) throw new Error("Explicit ChatGPT account ID required")
  return { id: "codex", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "codex", account: options.account, pool: `chatgpt:${options.accountId}`, routes: [], source: URL }
    let token: string | undefined
    try { token = (await options.accessToken())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!token) return unavailable(base, "not_configured", now)
    try {
      const response = await (options.fetch ?? fetch)(URL, { method: "GET", headers: { Authorization: `Bearer ${token}`, "ChatGPT-Account-Id": options.accountId, Accept: "application/json", "User-Agent": "opencode-quota/0.1" }, redirect: "manual", signal })
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      return parseCodexUsage(await response.json() as unknown, options.account, options.accountId, now) ?? unavailable(base, "invalid_response", now)
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
