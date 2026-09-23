/** Provider facts never imply that another route shares the same pool. */
export type WindowKind = "rolling" | "weekly" | "monthly" | "credit" | "other"
export type Availability = "available" | "unavailable"

export interface QuotaWindow {
  id: string
  kind: WindowKind
  unit: string
  limit?: number
  used?: number
  remaining?: number
  resetAt?: string
  expiresAt?: string
}

export interface Observation {
  schemaVersion: 1
  provider: string
  account: string
  pool: string
  /** A route belongs to a pool only when the upstream source explicitly says so. */
  routes: readonly string[]
  status: Availability
  observedAt: string
  freshUntil: string
  source: string
  windows: readonly QuotaWindow[]
  reason?: "not_configured" | "auth" | "transport" | "timeout" | "invalid_response" | "unsupported"
}

export interface Collector {
  id: string
  collect(signal: AbortSignal): Promise<Observation>
}

export function unavailable(input: Pick<Observation, "provider" | "account" | "pool" | "routes" | "source">, reason: NonNullable<Observation["reason"]>, now = new Date()): Observation {
  const time = now.toISOString()
  return { schemaVersion: 1, ...input, status: "unavailable", observedAt: time, freshUntil: time, source: input.source, windows: [], reason }
}

/** Cache successes until expiry; failures never masquerade as last-known-live facts. */
export class QuotaReader {
  private cache = new Map<string, Observation>()
  private inflight = new Map<string, Promise<Observation>>()
  private controllers = new Set<AbortController>()
  private closed = false
  private readonly collectors: readonly Collector[]
  private readonly timeoutMs: number
  private readonly now: () => Date

  constructor(collectors: readonly Collector[], timeoutMs = 5000, now = () => new Date()) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be positive")
    this.collectors = collectors
    this.timeoutMs = timeoutMs
    this.now = now
  }

  async read(signal?: AbortSignal): Promise<Observation[]> {
    if (this.closed) throw new Error("reader closed")
    return Promise.all(this.collectors.map(async (collector) => {
      const cached = this.cache.get(collector.id)
      if (cached && Date.parse(cached.freshUntil) > this.now().getTime()) return cached
      let job = this.inflight.get(collector.id)
      if (!job) {
        job = this.fetch(collector)
        this.inflight.set(collector.id, job)
        void job.finally(() => { if (this.inflight.get(collector.id) === job) this.inflight.delete(collector.id) })
      }
      if (!signal) return job
      if (signal.aborted) throw signal.reason
      return new Promise<Observation>((resolve, reject) => {
        const onAbort = () => reject(signal.reason)
        signal.addEventListener("abort", onAbort, { once: true })
        job!.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort))
      })
    }))
  }

  private async fetch(collector: Collector): Promise<Observation> {
    const controller = new AbortController()
    this.controllers.add(controller)
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        collector.collect(controller.signal),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error("timeout")) }, this.timeoutMs) }),
      ])
      if (result.status === "available" && Date.parse(result.freshUntil) > this.now().getTime()) this.cache.set(collector.id, result)
      else this.cache.delete(collector.id)
      return result
    } catch {
      this.cache.delete(collector.id)
      return unavailable({ provider: collector.id, account: "unknown", pool: "unknown", routes: [], source: collector.id }, timedOut ? "timeout" : "transport", this.now())
    } finally {
      if (timer) clearTimeout(timer)
      this.controllers.delete(controller)
    }
  }

  close(): void {
    this.closed = true
    for (const controller of this.controllers) controller.abort()
    this.cache.clear()
  }
}
