# opencode-quota

Read-only quota observations for OpenCode V2 and portable TypeScript consumers. This is an independent project, not an OpenCode or Neta release. Collectors read selected provider endpoints only when explicitly enabled with a matching key connection or caller-supplied credential. They never change models, accounts, billing settings, or routing.

## Support matrix

| Source | State | Authentication | Windows |
| --- | --- | --- | --- |
| OpenCode Go | Working collector; mocked transport tests, no live account proof | Opt-in existing OpenCode V2 `opencode-go` key connection, or caller-supplied key callback in the portable API | Server-reported five-hour, optional weekly/monthly percentages and reset timestamps |
| OpenRouter | Key cap and credits API collectors with mocked transport tests; no live account proof. Management Activity remains unported | Opt-in existing `openrouter` key connection with explicit account label and connection ID, or caller-supplied key callback | Key spending cap/window and separate account credits; key spend counters |
| DeepSeek | API balance collector with mocked transport tests; web platform spend history unported | Opt-in existing `deepseek` key connection with explicit account label and connection ID, or caller-supplied key callback | Paid/granted balance and availability; no synthetic percent quota |
| Moonshot | Regional API balance collector with mocked transport tests | Opt-in existing `moonshotai` key connection with explicit account label, connection ID and region, or caller-supplied key callback | Available/cash/voucher balances and cash deficit; no synthetic quota |
| z.ai Coding Plan | Quota API collector with mocked personal/team fixtures; model history and CN balance unported | Opt-in existing `zai-coding-plan` key connection with explicit account label, connection ID, region and `zaiScope: "personal"`; portable callback also accepts explicit team organization/project | Credit/token/MCP lanes and plausible resets; no inferred model route mapping |
| Fireworks | Selected-account billing summary with mocked transport tests; account discovery unported | Opt-in existing `fireworks-ai` key connection with explicit account label, connection ID and `fireworksAccountSlug`, or caller-supplied key callback | Rated 30-day spend only; no synthetic credit balance or quota |
| Codex subscription | OAuth wham usage collector with mocked fixtures; no live token-audience proof | Opt-in existing selected OpenCode `openai` ChatGPT OAuth credential with exact connection/account ID; no Codex CLI or browser store | Primary/secondary and named quota windows, reset, credits |
| GitHub Copilot | Public GitHub device OAuth with mocked direct and monthly fallback fixtures; enterprise host unported | Opt-in selected `github-copilot` OAuth credential with exact connection ID/account label | Premium/chat quota and reset, actual credits-used counter; no inferred included-credit ceiling |
| Claude subscription | Explicit `unsupported` observation | None in this MVP | None |

The implemented collectors do not read cookies, browser stores, keychains or local provider databases. An API or auth error reports `unavailable` with no windows; unknown is never zero. Go percentages are in whole-percent units (`1` = 1%, `0.5` = 0.5%). These are percentages, **not** dollar amounts or request counts. Missing resets remain absent. No model-to-pool mapping is inferred. The [pinned upstream inventory](docs/parity.json) has 81 CodexBar providers; the [OpenCode scope partition](docs/opencode-scope.json) identifies **43 eligible provider families and 71 relevant routes** (38 families excluded or awaiting a verified mapping). Nine routes across eight eligible providers have fixture-backed implementation; 62 eligible routes remain. Eligibility does not mean credential compatibility or live verification. See [credential compatibility](docs/credential-compatibility.md). Native UI surfaces are inventoried in the upstream manifest but outside this TypeScript/OpenCode plugin surface.

## Portable API

```ts
import { goCollector } from "opencode-quota/collectors"
import { openRouterCollector } from "opencode-quota/openrouter"
import { deepSeekCollector } from "opencode-quota/deepseek"
import { moonshotCollector } from "opencode-quota/moonshot"
import { zaiCollector } from "opencode-quota/zai"
import { fireworksCollector } from "opencode-quota/fireworks"
import { QuotaReader } from "opencode-quota"

const reader = new QuotaReader([
  goCollector({ account: "my-go-account", apiKey: async () => process.env.OPENCODE_API_KEY }),
  openRouterCollector({ account: "selected-openrouter-account", apiKey: async () => process.env.OPENROUTER_API_KEY }),
  deepSeekCollector({ account: "selected-deepseek-account", apiKey: async () => process.env.DEEPSEEK_API_KEY }),
  moonshotCollector({ account: "selected-moonshot-account", region: "global", apiKey: async () => process.env.MOONSHOT_API_KEY }),
  zaiCollector({ account: "selected-zai-account", region: "global", scope: { kind: "personal" }, apiKey: async () => process.env.Z_AI_API_KEY }),
  fireworksCollector({ account: "selected-fireworks-account", accountSlug: "my-account", apiKey: async () => process.env.FIREWORKS_API_KEY }),
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

No installation or config edit is performed by this repo. All `enable...` options default to false. New key collectors require a non-empty `...AccountLabel` and `...ConnectionId` (the selected OpenCode credential connection ID, not a secret); the active connection must match the ID. Moonshot also requires `moonshotRegion: "global" | "china"`, z.ai requires `zaiRegion: "global" | "bigmodel-cn"` and `zaiScope: "personal"`, and Fireworks requires `fireworksAccountSlug`. Codex requires `enableCodex: true`, `codexConnectionId`, `codexAccountLabel` and `codexAccountId`; only OpenCode's unexpired ChatGPT OAuth connection with matching account metadata is accepted. Copilot requires `enableCopilot: true`, `copilotConnectionId` and `copilotAccountLabel`; enterprise-host credentials fail closed rather than sending a token to the public host. The Go path retains its existing active `opencode-go` key behavior. Absent or mismatched credentials yield unavailable. The plugin does not export credentials or initiate authentication; **OpenCode's OAuth credential resolver can refresh a near-expiry login when Codex is enabled and observations are requested**. No live login was resolved during development. The RPC returns `{ observations: Observation[] }`; its definition is exported from `opencode-quota/rpc` for [`@opencode/client` callers](https://opencode.ai/v2/docs/build/plugins/rpc). Plugin unload disposes the RPC and reader.

The package is source-only and not published to npm. A Node consumer can import the built ESM artifacts with dependencies installed; Bun is used for project development and CI.

## Development

`bun run check` runs strict TypeScript, mocked tests and a Node-target build. Tests make no live provider requests. See [upstream review manifest](upstream.json) for the reviewed CodexBar snapshot and [maintenance](docs/maintenance.md) for the manual review policy.

## Attribution

The Go endpoint and percentage interpretation were reviewed against [CodexBar](https://github.com/steipete/CodexBar) at the SHA in `upstream.json`; the implementation here is independently written in TypeScript. CodexBar is MIT licensed; its copyright and license are linked in the manifest. No CodexBar source file is vendored.
