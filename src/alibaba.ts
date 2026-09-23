import type { Collector, Observation, QuotaWindow } from "./core.js"
import { unavailable } from "./core.js"
import type { HttpTransport } from "./contracts.js"

export type AlibabaRegion = "intl" | "cn"
const REGIONS = {
  intl: { host: "https://modelstudio.console.alibabacloud.com", region: "ap-southeast-1", commodity: "sfm_codingplan_public_intl", referer: "https://modelstudio.console.alibabacloud.com/ap-southeast-1/?tab=coding-plan#/efm/coding_plan" },
  cn: { host: "https://bailian.console.aliyun.com", region: "cn-beijing", commodity: "sfm_codingplan_public_cn", referer: "https://bailian.console.aliyun.com/cn-beijing/?tab=model#/efm/coding_plan" },
} as const
function row(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function nonnegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
function reset(value: unknown): string | undefined {
  const timestamp = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(timestamp) || timestamp <= 0) return undefined
  const millis = timestamp > 1e12 ? timestamp : timestamp * 1000
  return millis < 8.64e15 ? new Date(millis).toISOString() : undefined
}

/** Pinned Coding Plan instance/quota response; ambiguous multiple active instances fail closed. */
export function parseAlibabaQuota(value: unknown, account: string, region: AlibabaRegion, now = new Date()): Observation | undefined {
  const root = row(value)
  const data = row(root?.data) ?? root
  if (!root || !data || typeof root.code === "number" && root.code !== 0 && root.code !== 200) return undefined
  const instances = Array.isArray(data.codingPlanInstanceInfos) ? data.codingPlanInstanceInfos.flatMap(item => { const instance = row(item); return instance ? [instance] : [] }) : []
  const active = instances.filter(item => item.status === "VALID" || item.status === "ACTIVE" || item.isActive === true)
  if (active.length > 1 || instances.length > 1 && active.length !== 1) return undefined
  const instance = active[0] ?? instances[0]
  if (instance?.status === "EXPIRED" || instance?.status === "INACTIVE" || instance?.isActive === false) return undefined
  const quota = row(instance?.codingPlanQuotaInfo) ?? (instances.length <= 1 ? row(data.codingPlanQuotaInfo) : undefined)
  const windows: QuotaWindow[] = []
  if (quota) for (const item of [
    { id: "five-hour", kind: "rolling" as const, used: "per5HourUsedQuota", total: "per5HourTotalQuota", at: "per5HourQuotaNextRefreshTime" },
    { id: "weekly", kind: "weekly" as const, used: "perWeekUsedQuota", total: "perWeekTotalQuota", at: "perWeekQuotaNextRefreshTime" },
    { id: "monthly", kind: "monthly" as const, used: "perBillMonthUsedQuota", total: "perBillMonthTotalQuota", at: "perBillMonthQuotaNextRefreshTime" },
  ]) {
    const limit = nonnegative(quota[item.total])
    const used = nonnegative(quota[item.used])
    if (limit === undefined || used === undefined) continue
    const window: QuotaWindow = { id: item.id, kind: item.kind, unit: "provider-quota-units", limit, used, remaining: Math.max(0, limit - used) }
    const at = reset(quota[item.at])
    if (at) window.resetAt = at
    windows.push(window)
  }
  const plan = instance?.planName ?? data.planName
  if (!windows.length && !(active.length === 1 && typeof plan === "string")) return undefined
  const config = REGIONS[region]
  const result: Observation = { schemaVersion: 1, provider: "alibaba", account, pool: `alibaba-${region}:${account}`, routes: [], status: "available",
    source: `${config.host}/data/api.json`, strategy: "alibaba.api-fallback", observedAt: now.toISOString(), freshUntil: new Date(now.getTime() + 60_000).toISOString(), windows }
  if (typeof plan === "string") result.serviceStatus = plan
  return result
}

export interface AlibabaOptions { account: string; region: AlibabaRegion; apiKey: () => Promise<string | undefined>; fetch?: HttpTransport; now?: () => Date }
export function alibabaCollector(options: AlibabaOptions): Collector {
  if (!(options.region in REGIONS)) throw new Error("Invalid Alibaba region")
  const config = REGIONS[options.region]
  const url = new URL(`${config.host}/data/api.json`)
  url.searchParams.set("action", "zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2")
  url.searchParams.set("product", "broadscope-bailian")
  url.searchParams.set("api", "queryCodingPlanInstanceInfoV2")
  url.searchParams.set("currentRegionId", config.region)
  return { id: "alibaba", async collect(signal) {
    const now = options.now?.() ?? new Date()
    const base = { provider: "alibaba", account: options.account, pool: `alibaba-${options.region}:${options.account}`, routes: [], source: url.toString() }
    let key: string | undefined
    try { key = (await options.apiKey())?.trim() } catch { return unavailable(base, "auth", now) }
    if (!key) return unavailable(base, "not_configured", now)
    try {
      const response = await (options.fetch ?? fetch)(url.toString(), { method: "POST", body: JSON.stringify({ queryCodingPlanInstanceInfoRequest: { commodityCode: config.commodity } }),
        headers: { Authorization: `Bearer ${key}`, "x-api-key": key, "X-DashScope-API-Key": key, Accept: "application/json", "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
          Origin: config.host, Referer: config.referer }, redirect: "manual", signal })
      if (response.status === 401 || response.status === 403) return unavailable(base, "auth", now)
      if (!response.ok || response.redirected) return unavailable(base, "transport", now)
      return parseAlibabaQuota(await response.json() as unknown, options.account, options.region, now) ?? unavailable(base, "invalid_response", now)
    } catch { return unavailable(base, signal.aborted ? "timeout" : "transport", now) }
  } }
}
