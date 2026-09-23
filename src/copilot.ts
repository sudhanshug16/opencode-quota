import type { Collector, Observation, QuotaWindow, UsageAmount } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

const URL = "https://api.github.com/copilot_internal/user"
function row(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function number(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

/** OpenCode's GitHub device credential, not its short-lived Copilot model token. Enterprise requires separate host review. */
export function copilotAccess(credential: { type: string; methodID?: string; metadata?: Readonly<Record<string, unknown>>; access?: string; refresh?: string } | undefined): string | undefined {
  if (credential?.type !== "oauth" || credential.methodID !== "device" || credential.metadata?.enterpriseUrl) return undefined
  return typeof credential.refresh === "string" && credential.refresh && credential.refresh === credential.access ? credential.refresh : undefined
}

/** Pinned CodexBar CopilotUsageResponse: direct quota snapshots or monthly/limited fallback. */
export function parseCopilotUsage(value: unknown, account: string, now = new Date()): Observation | undefined {
  const body = row(value)
  if (!body) return undefined
  const snapshots = row(body.quota_snapshots)
  const monthly = row(body.monthly_quotas)
  const limited = row(body.limited_user_quotas)
  const reset = typeof body.quota_reset_date === "string" && Number.isFinite(Date.parse(body.quota_reset_date)) ? new Date(body.quota_reset_date).toISOString() : undefined
  const windows: QuotaWindow[] = []
  const usage: UsageAmount[] = []
  const add = (id: string, direct: unknown, monthlyValue: unknown, remainingValue: unknown): void => {
    const snapshot = row(direct)
    const credits = number(snapshot?.credits_used)
    const entitlement = number(snapshot?.entitlement)
    const remaining = number(snapshot?.remaining)
    if (credits !== undefined && credits >= 0 && (credits > 0 || body.token_based_billing === true || snapshot?.unlimited === true)) {
      usage.push({ id: `${id}-credits`, amount: credits, unit: "credits", authority: "provider", period: "monthly" })
    }
    if (snapshot?.unlimited !== true) {
      const percent = number(snapshot?.percent_remaining) ?? (entitlement !== undefined && entitlement > 0 && remaining !== undefined ? remaining / entitlement * 100 : undefined)
      const placeholder = entitlement === 0 && remaining === 0
      if (percent !== undefined && !placeholder && percent <= 100) {
        const window: QuotaWindow = { id, kind: "monthly", unit: "percent", limit: 100, used: Math.max(0, 100 - percent), remaining: percent }
        if (reset) window.resetAt = reset
        windows.push(window)
        return
      }
    }
    const limit = number(monthlyValue)
    const left = number(remainingValue)
    if (limit !== undefined && limit > 0 && left !== undefined) {
      const percent = Math.max(0, Math.min(100, left / limit * 100))
      const window: QuotaWindow = { id, kind: "monthly", unit: "percent", limit: 100, used: 100 - percent, remaining: percent }
      if (reset) window.resetAt = reset
      windows.push(window)
    }
  }
  add("premium", snapshots?.premium_interactions, monthly?.completions, limited?.completions)
  add("chat", snapshots?.chat, monthly?.chat, limited?.chat)
  if (!windows.length && !usage.length && body.token_based_billing !== true && typeof body.copilot_plan !== "string") return undefined
  const result: Observation = { schemaVersion: 1, provider: "copilot", account, pool: `copilot:${account}`, routes: [], status: "available",
    source: URL, strategy: "copilot.github-api", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows }
  if (usage.length) result.usage = usage
  if (typeof body.copilot_plan === "string") result.serviceStatus = body.copilot_plan
  return result
}

export interface CopilotOptions {
  account: string
  githubToken: () => Promise<string | undefined>
  fetch?: HttpTransport
  now?: () => Date
}

export function copilotCollector(options: CopilotOptions): Collector {
  return { id: "copilot", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "copilot", account: options.account, pool: `copilot:${options.account}`, routes: [], source: URL }
    let token: string | undefined
    try { token = (await options.githubToken())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!token) return unavailable(base, "not_configured", now)
    try {
      const response = await (options.fetch ?? fetch)(URL, { method: "GET", headers: { Authorization: `token ${token}`, Accept: "application/json", "Editor-Version": "vscode/1.96.2", "Editor-Plugin-Version": "copilot-chat/0.26.7", "User-Agent": "GitHubCopilotChat/0.26.7", "X-Github-Api-Version": "2025-04-01" }, redirect: "manual", signal })
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      return parseCopilotUsage(await response.json() as unknown, options.account, now) ?? unavailable(base, "invalid_response", now)
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
