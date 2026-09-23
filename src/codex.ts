import type { Collector, Observation, QuotaWindow } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"
import type { IntegrationDomain } from "@opencode/plugin/promise/integration"

const URL = "https://chatgpt.com/backend-api/wham/usage"
/** Prefer OpenCode's OAuth account metadata; a manual nonsecret selector is conditional only when metadata is absent. */
export function codexAccess(credential: { type: string; methodID?: string; metadata?: Readonly<Record<string, unknown>>; access?: string; expires?: number } | undefined, selectedAccountId?: string, now = Date.now()): { accessToken: string; accountId: string } | undefined {
  if (credential?.type !== "oauth" || !["chatgpt-browser", "chatgpt-headless"].includes(credential.methodID ?? "")) return undefined
  const stored = credential.metadata?.accountID
  if (stored !== undefined && (typeof stored !== "string" || !stored.trim())) return undefined
  const accountId = stored ?? selectedAccountId
  if (typeof accountId !== "string" || !accountId.trim() || /[\r\n]/.test(accountId) || (selectedAccountId && selectedAccountId !== accountId)) return undefined
  if (typeof credential.expires !== "number" || credential.expires <= now + 30_000) return undefined
  return typeof credential.access === "string" && credential.access ? { accessToken: credential.access, accountId } : undefined
}
/** IntegrationDomain is the installed @opencode/plugin 2.0.15 promise API contract. */
export async function selectedCodexOAuth(connection: IntegrationDomain["connection"], connectionId: string, accountId?: string): Promise<{ accessToken: string; accountId: string } | undefined> {
  const active = await connection.active("openai")
  if (active?.type !== "credential" || active.id !== connectionId || active.method !== "oauth") return undefined
  return codexAccess(await connection.resolve(active), accountId)
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
  /** One selected OpenCode OAuth credential resolved atomically with its account identity. */
  oauth: () => Promise<{ accessToken: string; accountId: string } | undefined>
  fetch?: HttpTransport
  now?: () => Date
  /** Opt-in account-bound dashboard extras; failures never erase wham quota. */
  includeExtras?: boolean
}

export function parseCodexResetCredits(value: unknown): number | undefined {
  const body = record(value)
  if (!Array.isArray(body?.credits) || !Number.isSafeInteger(body.available_count) || (body.available_count as number) < 0) return undefined
  return body.available_count as number
}

export function parseCodexMonthlySpend(value: unknown): QuotaWindow | undefined {
  const body = record(value)
  const effective = record(body?.effective_monthly_limit)
  const limit = finite(effective?.limit) ?? (typeof effective?.limit === "string" && effective.limit.trim() ? Number(effective.limit) : undefined)
  const used = finite(body?.current_month_usage) ?? (typeof body?.current_month_usage === "string" && body.current_month_usage.trim() ? Number(body.current_month_usage) : undefined)
  if (typeof effective?.enforcement_mode !== "string" && effective?.enforcement_mode != null) return undefined
  if (["none", "off", "disabled", "no_limit"].includes(effective?.enforcement_mode?.toLowerCase() ?? "")) return undefined
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0 || used === undefined || !Number.isFinite(used) || used < 0) return undefined
  return { id: "monthly-spend-control", kind: "monthly", unit: "credits", limit, used, remaining: Math.max(0, limit - used) }
}

export function parseCodexWorkspaceBalance(value: unknown): number | undefined {
  const raw = record(value)?.balance
  const balance = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : undefined
  return balance !== undefined && Number.isFinite(balance) ? Math.max(0, balance) : undefined
}

export function codexCollector(options: CodexOptions): Collector {
  return { id: "codex", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "codex", account: options.account, pool: "unknown", routes: [], source: URL }
    let oauth: Awaited<ReturnType<CodexOptions["oauth"]>>
    try { oauth = await options.oauth() } catch { return unavailable(base, "auth", now) }
    if (!oauth) return unavailable(base, "not_configured", now)
    const { accessToken, accountId } = oauth
    if (!accessToken.trim() || !accountId.trim() || /[\r\n]/.test(accountId)) return unavailable(base, "not_configured", now)
    base.pool = `chatgpt:${accountId}`
    try {
      const response = await (options.fetch ?? fetch)(URL, { method: "GET", headers: { Authorization: `Bearer ${accessToken}`, "ChatGPT-Account-Id": accountId, Accept: "application/json", "User-Agent": "opencode-quota/0.1" }, redirect: "manual", signal })
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      const payload: unknown = await response.json()
      const observation = parseCodexUsage(payload, options.account, accountId, now)
      if (!observation) return unavailable(base, "invalid_response", now)
      if (!options.includeExtras) return observation
      const http = options.fetch ?? fetch
      const sharedHeaders: Record<string, string> = { Authorization: `Bearer ${accessToken}`, "ChatGPT-Account-Id": accountId, Accept: "application/json", "User-Agent": "opencode-quota/0.1" }
      const extra = async (url: string, headers = sharedHeaders): Promise<unknown> => {
        try {
          const result = await http(url, { method: "GET", headers, redirect: "manual", signal })
          return result.ok && !result.redirected ? await result.json() as unknown : undefined
        } catch { return undefined }
      }
      const resetCredits = parseCodexResetCredits(await extra("https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
        { ...sharedHeaders, "OpenAI-Beta": "codex-1", originator: "Codex Desktop" }))
      if (resetCredits !== undefined) observation.credits = [...(observation.credits ?? []), { id: "rate-limit-resets", amount: resetCredits, unit: "reset-credits" }]
      const root = record(payload)
      const plan = root?.plan_type
      const individual = record(root?.individual_limit) ?? record(record(root?.rate_limit)?.individual_limit) ?? record(record(root?.spend_control)?.individual_limit)
      const consumer = ["guest", "free", "go", "plus", "pro"].includes(typeof plan === "string" ? plan : "")
      if (!consumer && root?.spend_control != null && !(finite(individual?.limit) && (finite(individual?.limit) ?? 0) > 0)) {
        const path = `https://chatgpt.com/backend-api/accounts/${encodeURIComponent(accountId)}/spend-controls/current-user/monthly-usage`
        const window = parseCodexMonthlySpend(await extra(path))
        if (window) observation.windows = [...observation.windows, window]
      }
      const whamCredits = record(root?.credits)
      if (!consumer && whamCredits?.has_credits === true && whamCredits.unlimited !== true && whamCredits.balance == null) {
        const balance = parseCodexWorkspaceBalance(await extra(`https://chatgpt.com/backend-api/accounts/${encodeURIComponent(accountId)}/remaining_balance`))
        if (balance !== undefined) observation.credits = [...(observation.credits ?? []), { id: "workspace-remaining", amount: balance, unit: "credits" }]
      }
      return observation
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
