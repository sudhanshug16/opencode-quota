# opencode-quota

Read-only quota observations for OpenCode V2 and portable TypeScript consumers. This is an independent project, not an OpenCode or Neta release. The first implementation reads OpenCode Go's authenticated usage endpoint only when explicitly enabled and an existing OpenCode Go key connection is active. It never changes models, accounts, billing settings, or routing.

## Support matrix

| Source | State | Authentication | Windows |
| --- | --- | --- | --- |
| OpenCode Go | Working collector; mocked transport tests, no live account proof | Opt-in existing OpenCode V2 `opencode-go` key connection, or caller-supplied key callback in the portable API | Server-reported five-hour, optional weekly/monthly percentages and reset timestamps |
| Codex subscription | Explicit `unsupported` observation | None in this MVP | None |
| Claude subscription | Explicit `unsupported` observation | None in this MVP | None |

No cookies, browser stores, keychains or local provider databases are read. An API or auth error reports `unavailable` with no windows; unknown is never zero. Go percentages are in whole-percent units (`1` = 1%, `0.5` = 0.5%). These are percentages, **not** dollar amounts or request counts. Missing resets remain absent. The API response does not establish a defensible model-to-pool mapping, so `routes` is empty and no model is inferred to share another's quota.

## Portable API

```ts
import { goCollector } from "opencode-quota/collectors"
import { QuotaReader } from "opencode-quota"

const reader = new QuotaReader([
  goCollector({ account: "my-go-account", apiKey: async () => process.env.OPENCODE_API_KEY }),
])
try {
  console.log(JSON.stringify(await reader.read(), null, 2))
} finally {
  reader.close()
}
```

The caller supplies its credential deliberately. Keep the account label non-secret. `read(signal)` accepts an AbortSignal; concurrent refreshes share work, successful observations cache for 60 seconds, and `close()` aborts outstanding requests and clears cache. The transport has a five-second timeout by default. No background polling. Facts have `schemaVersion`, account and pool identities, observed/fresh timestamps, source, and independent windows. A consumer must check `status === "available"` and freshness before using facts; it must not treat missing windows as spare capacity. Local demand estimation, price conversions and route decisions are outside this interface.

## OpenCode V2 plugin

Build with `bun install && bun run build`. The plugin entry is `./dist/plugin.js`; load it using OpenCode V2's [`plugins` configuration](https://opencode.ai/v2/docs/build/plugins):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{ "package": "/absolute/path/to/opencode-quota/dist/plugin.js", "options": { "enableGo": true, "accountLabel": "my-go-account" } }]
}
```

No installation or config edit is performed by this repo. `enableGo` defaults to false. The plugin resolves only the active existing `opencode-go` **key** connection when the read-only `opencode-quota.observations` RPC method is called; OAuth and absent credentials yield unavailable. It does not export credentials, inspect another provider's integration or initiate authentication. The RPC returns `{ observations: Observation[] }`; its definition is exported from `opencode-quota/rpc` for [`@opencode/client` callers](https://opencode.ai/v2/docs/build/plugins/rpc). Plugin unload disposes the RPC and reader.

The package is source-only and not published to npm. A Node consumer can import the built ESM artifacts with dependencies installed; Bun is used for project development and CI.

## Development

`bun run check` runs strict TypeScript, mocked tests and a Node-target build. Tests make no live provider requests. See [upstream review manifest](upstream.json) for the reviewed CodexBar snapshot and [maintenance](docs/maintenance.md) for the manual review policy.

## Attribution

The Go endpoint and percentage interpretation were reviewed against [CodexBar](https://github.com/steipete/CodexBar) at the SHA in `upstream.json`; the implementation here is independently written in TypeScript. CodexBar is MIT licensed; its copyright and license are linked in the manifest. No CodexBar source file is vendored.
