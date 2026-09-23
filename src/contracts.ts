/** Credential lookup is explicit: no adapter may silently select another account. */
export interface AccountSelection {
  provider: string
  account: string
  source: string
}

export type Credential =
  | { kind: "bearer"; token: string }
  | { kind: "api-key"; key: string }
  | { kind: "cookie"; header: string }

export interface CredentialSource {
  readonly id: string
  resolve(selection: AccountSelection, signal: AbortSignal): Promise<Credential | undefined>
}

export type HttpTransport = (url: string, init: RequestInit) => Promise<Response>

/** Callers supply a reviewed fixed HTTPS URL; redirects never forward credentials. */
export async function readJson(url: string, init: RequestInit, transport: HttpTransport = fetch): Promise<{ status: number; body?: unknown }> {
  const response = await transport(url, { ...init, redirect: "manual" })
  if (response.redirected || (response.status >= 300 && response.status < 400)) return { status: response.status }
  if (!response.ok) return { status: response.status }
  return { status: response.status, body: await response.json() as unknown }
}
