import type { Observation } from "./core.js"

export interface ConnectedQuotaAccount {
  integration: string
  label: string
  connectionId?: string
}

export interface QuotaCommandInput {
  accounts: readonly ConnectedQuotaAccount[]
  collectors: readonly { integration: string; connectionId: string; account: string; collect: () => Promise<Observation> }[]
  unsupported: ReadonlySet<string>
  now?: () => Date
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.name || "Error"
  return "Error"
}

function display(observation: Observation): string {
  const facts: string[] = []
  for (const window of observation.windows) {
    const amounts = window.used !== undefined && window.limit !== undefined
      ? `${window.used}/${window.limit} ${window.unit}`
      : window.remaining !== undefined ? `${window.remaining} ${window.unit} remaining` : "usage reported"
    facts.push(`${window.id}: ${amounts}${window.resetAt ? ` (resets ${window.resetAt})` : ""}`)
  }
  for (const credit of observation.credits ?? []) facts.push(`${credit.id}: ${credit.amount} ${credit.unit}${credit.expiresAt ? ` (expires ${credit.expiresAt})` : ""}`)
  for (const amount of observation.usage ?? []) facts.push(`${amount.id}: ${amount.amount} ${amount.unit}${amount.period ? ` (${amount.period})` : ""}${amount.authority === "local" ? " [local estimate]" : ""}`)
  if (observation.serviceStatus) facts.push(`service: ${observation.serviceStatus}`)
  if (observation.reason) facts.push(`reason: ${observation.reason}`)
  const scope = observation.pool !== "unknown" ? `, pool ${observation.pool}` : ""
  const routes = observation.routes.length ? `, routes ${observation.routes.join(", ")}` : ""
  return `${observation.status}${facts.length ? ` — ${facts.join("; ")}` : " — no quota data reported"} [${observation.source}${scope}${routes}, observed ${observation.observedAt}, fresh until ${observation.freshUntil}]`
}

/** Produce a stable, secret-free report. Failures are isolated per connected account. */
export async function quotaReport(input: QuotaCommandInput): Promise<string> {
  if (input.accounts.length === 0) return "No connected providers found in this OpenCode location."
  const lines = await Promise.all(input.accounts.map(async (account) => {
    const header = `${account.integration}${account.label ? ` (${account.label})` : ""}`
    try {
      const collector = input.collectors.find((one) => one.integration === account.integration && one.connectionId === account.connectionId && one.account === account.label)
      if (collector) return `${header}: ${display(await collector.collect())}`
      if (input.unsupported.has(account.integration)) return `${header}: unsupported — no compatible quota collector is implemented for this connection.`
      return `${header}: unavailable — connected, but no explicitly selected compatible account/collector is configured.`
    } catch (error) {
      return `${header}: error — collection failed (${safeError(error)}); other accounts were still checked.`
    }
  }))
  return [`Quota status · ${ (input.now ?? (() => new Date()))().toISOString() }`, ...lines].join("\n")
}
