import type { Collector, Observation, QuotaWindow } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

export type MiniMaxRegion = "global" | "cn"
const HOSTS: Record<MiniMaxRegion, string> = { global: "https://api.minimax.io", cn: "https://api.minimaxi.com" }
function row(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function count(value: unknown): number | undefined { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined }
function date(value: unknown): string | undefined {
  const number = count(value)
  if (number === undefined || number <= 1e9) return undefined
  const timestamp = number > 1e12 ? number : number * 1000
  return Number.isFinite(timestamp) && timestamp < 8.64e15 ? new Date(timestamp).toISOString() : undefined
}

/** MiniMax's interval_usage_count and weekly_usage_count are REMAINING, not consumed. */
export function parseMiniMaxRemains(value: unknown, account: string, region: MiniMaxRegion, now = new Date()): Observation | undefined {
  const root = row(value)
  const data = row(root?.data) ?? root
  const baseResp = row(root?.base_resp) ?? row(data?.base_resp)
  if (!root || !data || baseResp?.status_code !== undefined && baseResp.status_code !== 0) return undefined
  const models = Array.isArray(data.model_remains) ? data.model_remains : []
  const windows: QuotaWindow[] = []
  for (const [index, value] of models.slice(0, 20).entries()) {
    const model = row(value)
    if (!model) continue
    const modelName = typeof model.model_name === "string" && model.model_name.length <= 120 && !/[\x00-\x1f]/.test(model.model_name) ? model.model_name : `model-${index}`
    for (const [prefix, kind] of [["current_interval", "rolling"], ["current_weekly", "weekly"]] as const) {
      const lower = modelName.toLowerCase()
      if (kind === "weekly" && lower !== "general" && !lower.includes("minimax-m") && !lower.startsWith("m2.")) continue
      const total = count(model[`${prefix}_total_count`])
      const remaining = count(model[`${prefix}_usage_count`])
      if (total === undefined || total <= 0 || remaining === undefined) continue
      const window: QuotaWindow = { id: `${modelName}:${kind}`, scope: modelName, kind, unit: "prompts", limit: total,
        used: Math.max(0, total - remaining), remaining }
      const end = date(model[prefix === "current_interval" ? "end_time" : "weekly_end_time"])
      if (end && Date.parse(end) > now.getTime()) window.resetAt = end
      windows.push(window)
    }
  }
  if (!windows.length) return undefined
  const result: Observation = { schemaVersion: 1, provider: "minimax", account, pool: `minimax-${region}:${account}`, routes: [], status: "available",
    source: `${HOSTS[region]}/v1/token_plan/remains`, strategy: "minimax.api", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows }
  const plan = data.current_subscribe_title ?? data.plan_name
  if (typeof plan === "string") result.serviceStatus = plan
  if (models.length > 20) result.serviceStatus = `${result.serviceStatus ? `${result.serviceStatus}; ` : ""}model-list-partial`
  return result
}

export interface MiniMaxOptions { account: string; region: MiniMaxRegion; apiKey: () => Promise<string | undefined>; fetch?: HttpTransport; now?: () => Date }
export function miniMaxCollector(options: MiniMaxOptions): Collector {
  if (!(options.region in HOSTS)) throw new Error("Invalid MiniMax region")
  const host = HOSTS[options.region]
  return { id: "minimax", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "minimax", account: options.account, pool: `minimax-${options.region}:${options.account}`, routes: [], source: `${host}/v1/token_plan/remains` }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    const headers = { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json", "MM-API-Source": "CodexBar" }
    let lastReason: "auth" | "transport" | "invalid_response" = "auth"
    let hadAuthFailure = false
    for (const path of ["/v1/token_plan/remains", "/v1/api/openplatform/coding_plan/remains"]) {
      try {
        const response = await (options.fetch ?? fetch)(`${host}${path}`, { method: "GET", headers, redirect: "manual", signal })
        if (response.redirected) return unavailable(base, "transport", now)
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) { hadAuthFailure = true; continue } // pinned legacy fallback within selected region
          lastReason = "transport"
          continue
        }
        const payload: unknown = await response.json()
        if (row(row(payload)?.base_resp)?.status_code === 1004) { hadAuthFailure = true; continue }
        const observation = parseMiniMaxRemains(payload, options.account, options.region, now)
        if (observation) { observation.source = `${host}${path}`; return observation }
        lastReason = "invalid_response"
      } catch { if (signal.aborted) return unavailable(base, "timeout", now); lastReason = "transport" }
    }
    return unavailable(base, hadAuthFailure ? "auth" : lastReason, now)
  } }
}
