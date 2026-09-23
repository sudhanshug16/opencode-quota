# opencode-quota

Read-only quota observations for OpenCode V2 and portable TypeScript consumers. This is an independent project, not an OpenCode or Neta release. Collectors read selected provider endpoints only when explicitly enabled with a matching key connection or caller-supplied credential. They never change models, accounts, billing settings, or routing.

## Support matrix

| Source | State | Authentication | Windows |
| --- | --- | --- | --- |
| OpenCode Go | Working collector; mocked transport tests, no live account proof | Opt-in existing OpenCode V2 `opencode-go` key connection, or caller-supplied key callback in the portable API | Server-reported five-hour, optional weekly/monthly percentages and reset timestamps |
| OpenRouter | Key cap and credits API collectors with mocked transport tests; no live account proof. Management Activity remains unported | Opt-in existing `openrouter` key connection with explicit account label and connection ID, or caller-supplied key callback | Key spending cap/window and separate account credits; key spend counters |
| DeepSeek | API balance collector with mocked transport tests; web platform spend history unported | Opt-in existing `deepseek` key connection with explicit account label and connection ID, or caller-supplied key callback | Paid/granted balance and availability; no synthetic percent quota |
| Moonshot | Regional API balance collector with mocked transport tests | Opt-in existing `moonshotai` key connection with explicit account label, connection ID and region, or caller-supplied key callback | Available/cash/voucher balances and cash deficit; no synthetic quota |
| z.ai Coding Plan | Quota API, optional model-token history and CN PAYG balance with mocked personal/team fixtures | Opt-in existing `zai-coding-plan` key connection with explicit account label, connection ID, region and `zaiScope: "personal"`; history needs `enableZaiModelUsage: true`, CN balance needs `enableZaiCnBalance: true`; portable callback also accepts explicit team organization/project | Credit/token/MCP lanes, plausible resets, separate historical token counts and CNY PAYG balance if authorized; no inferred model route mapping |
| Fireworks | Selected-account billing summary with mocked transport tests; account discovery unported | Opt-in existing `fireworks-ai` key connection with explicit account label, connection ID and `fireworksAccountSlug`, or caller-supplied key callback | Rated 30-day spend only; no synthetic credit balance or quota |
| Codex subscription | OAuth wham usage plus optional dashboard extras with mocked fixtures; no live token-audience proof | Selected OpenCode `openai` ChatGPT OAuth connection; stored account ID preferred, optional matching explicit ID or conditional manual ID when metadata absent; `enableCodexExtras: true` opts into additional account-bound reads | Primary/secondary and named quota windows, credits; optional reset-credit inventory count, monthly spend cap and workspace balance |
| GitHub Copilot | Public GitHub device OAuth with mocked direct and monthly fallback fixtures; enterprise host unported | Opt-in selected `github-copilot` OAuth credential with exact connection ID/account label | Premium/chat quota and reset, actual credits-used counter; no inferred included-credit ceiling |
| Poe | Point balance and up-to-30-day history with mocked transport; no live account proof | Opt-in selected `poe` OAuth-issued key or API key connection with exact ID/account label | Points balance and observed points/USD spend; no quota ceiling |
| DeepInfra | Two-endpoint billing observation with mocked fixtures; billing permission unverified | Opt-in selected `deepinfra` key connection with exact ID/account label | Available/owed USD balance, recent/month spend, conditional billing limit, suspension |
| ClinePass | Subscription-window endpoint with mocked fixture; key permission unverified | Opt-in selected `cline-pass` key connection with exact ID/account label | Five-hour, weekly and monthly quota windows with reset |
| Kimi Code | Regional Code API with mocked ratio and legacy-counter fixtures; entitlement unverified | Opt-in selected `kimi-code-plan-global` or `kimi-code-plan-cn` key connection and explicit matching region/account label | Five-hour, weekly and shared monthly-total quota lanes; no browser/CLI login |
| Chutes | Direct subscription endpoint with pinned-source fixture; bounded quota-list/per-chute usage fallback | Opt-in selected `chutes` key connection and account label | Rolling/monthly request or credit allowances and reset when returned; inactive plan distinct from zero quota |
| v0 | Billing and rate-limit endpoints with mocked token/legacy fixtures; scope permission unverified | Opt-in selected `v0` key connection and optional explicit project scope | Billing window, separate rate-limit window and optional on-demand balance; provider-defined units |
| Venice | API billing balance with mocked transport; billing permission unverified | Opt-in selected `venice` key connection and account label | USD and DIEM balances, optional DIEM epoch allocation; web subscription separate |
| Hyper | Credits endpoint with mocked transport; no live account proof | Opt-in selected `hyper` key connection and account label | HC balance only, no fabricated quota |
| Hugging Face | Bearer billing API and optional ZeroGPU with mocked fixtures; Billing read permission unverified | Opt-in selected `huggingface` token connection and account label | Inference gross/included/billable USD spend, conditional spending cap, optional GPU seconds; browser wallet separate |
| Neuralwatt | Pinned `/v1/quota` parser with mocked fixtures; catalog host acceptance unverified | Opt-in selected `neuralwatt` key connection and account label | kWh subscription window, USD prepaid balance/key allowance and monthly spend |
| Synthetic | Pinned generic and named quota fixtures; endpoint entitlement unverified | Opt-in selected `synthetic` key connection and account label | Five-hour, weekly-token, search-hourly or generic quota; optional separate weekly USD credit cap |
| MiniMax Coding Plan | Regional token-plan and legacy remains endpoints with mocked fixture; plan entitlement unverified | Opt-in exact `minimax-coding-plan` or `minimax-cn-coding-plan` key connection, account label and region | Model-scoped interval and text-model weekly prompt allowances; web billing history separate |
| Kilo | Pinned tRPC batch fixture; endpoint permission unverified | Opt-in selected `kilo` key connection, account label and optional explicit organization ID | Micro-USD credit-block balance and separate USD pass allowance/reset |
| Alibaba Coding Plan | Pinned regional console-gateway key POST with fixture; gateway key-mode entitlement unverified | Opt-in exact `alibaba-coding-plan` or `alibaba-coding-plan-cn` key connection, account label and region | Five-hour, weekly and monthly provider-unit plan windows; ambiguous multiple active instances fail closed |
| Claude subscription | Explicit `unsupported` observation | None in this MVP | None |

The implemented collectors do not read cookies, browser stores, keychains or local provider databases. An API or auth error reports `unavailable` with no windows; unknown is never zero. Go percentages are in whole-percent units (`1` = 1%, `0.5` = 0.5%). These are percentages, **not** dollar amounts or request counts. Missing resets remain absent. No model-to-pool mapping is inferred. The [pinned upstream inventory](docs/parity.json) has 81 CodexBar providers; the [OpenCode scope partition](docs/opencode-scope.json) identifies **43 mapped provider families and 71 acquisition routes**, 32 excluded external products and six unresolved aliases. Twenty-seven routes across twenty-two mapped providers have fixture-backed implementation; 44 acquisition routes remain, [triaged by capability/auth](docs/route-triage.json). Those routes are not 44 mandatory provider gaps: alternate auth and non-quota probes are tracked separately. The [credential-only completion matrix](docs/credential-matrix.json) separates eight source-aligned bridges, fourteen conditional bridges, and 21 mapped families unavailable **in this plugin**; no live account was verified. See [credential compatibility](docs/credential-compatibility.md). Native UI surfaces are inventoried in the upstream manifest but outside this TypeScript/OpenCode plugin surface.

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

No installation or config edit is performed by this repo. All `enable...` options default to false. New collectors require a non-empty `...AccountLabel` and `...ConnectionId` (the selected OpenCode credential connection ID, not a secret); the active connection must match the ID. Moonshot also requires `moonshotRegion: "global" | "china"`, z.ai requires `zaiRegion: "global" | "bigmodel-cn"` and `zaiScope: "personal"`, and Fireworks requires `fireworksAccountSlug`. Codex requires `enableCodex: true`, `codexConnectionId` and `codexAccountLabel`; optional `enableCodexExtras: true` adds account-bound dashboard reads; it takes the ChatGPT account ID from the selected OAuth credential metadata when present. Optional `codexAccountId` must match that metadata exactly; when metadata lacks an ID, it is an explicit nonsecret manual selector and endpoint acceptance remains conditional. Missing or malformed identity fails closed. Copilot requires `enableCopilot: true`, `copilotConnectionId` and `copilotAccountLabel`; enterprise-host credentials fail closed rather than sending a token to the public host. Poe requires `enablePoe: true`, `poeConnectionId` and `poeAccountLabel`; an OAuth-issued key must use the `browser` method and be unexpired. DeepInfra requires `enableDeepInfra: true`, `deepInfraConnectionId` and `deepInfraAccountLabel`, with billing permission for both endpoints. ClinePass requires `enableClinePass: true`, `clinePassConnectionId` and `clinePassAccountLabel`. Kimi requires `enableKimi: true`, `kimiConnectionId`, `kimiAccountLabel` and `kimiRegion: "china" | "international"`; the region selects the exact corresponding Code Plan integration. Chutes requires `enableChutes: true`, `chutesConnectionId` and `chutesAccountLabel`; its quota-list and per-chute usage fallback runs when a subscription window is missing. v0 requires `enableV0: true`, `v0ConnectionId`, `v0AccountLabel` and optional nonsecret `v0Scope`; both billing and rate endpoints must accept the key/scope. The OpenCode Go collector uses the active `opencode-go` key; `/quota` collects it only when `goConnectionId` matches that connected credential identity. Absent or mismatched credentials yield unavailable. The plugin does not export credentials or initiate authentication; **OpenCode's OAuth credential resolver can refresh a near-expiry login when Codex is enabled and observations are requested**. No live login was resolved during development. The RPC returns `{ observations: Observation[] }`; its definition is exported from `opencode-quota/rpc` for [`@opencode/client` callers](https://opencode.ai/v2/docs/build/plugins/rpc). Plugin unload disposes the RPC and reader.

The plugin also registers the OpenCode V2 `/quota` slash command. It enumerates credential and environment-backed connections in the current location and reports each connection identity separately, including unsupported and not-explicitly-selected entries. Only an exact configured credential connection ID/account-label match runs a compatible collector; no account is guessed. Provider failures are isolated and displayed without error payloads or credentials, while other accounts continue. The report includes observation source/time/freshness and provider-reported pool identity, plus available windows, resets, balances, credits and spend. The command reads provider endpoints only for collectors enabled in plugin options and uses synthetic session output to display its report.

Venice additionally requires `enableVenice: true`, `veniceConnectionId` and `veniceAccountLabel`. Hyper requires `enableHyper: true`, `hyperConnectionId` and `hyperAccountLabel`. Hugging Face requires `enableHuggingFace: true`, `huggingFaceConnectionId` and `huggingFaceAccountLabel`; Billing read may require a classic read token or fine-grained billing permission. Neuralwatt requires `enableNeuralwatt: true`, `neuralwattConnectionId` and `neuralwattAccountLabel`; its quota endpoint is fixed to the pinned catalog API host. Synthetic requires `enableSynthetic: true`, `syntheticConnectionId` and `syntheticAccountLabel`. MiniMax requires `enableMiniMax: true`, `miniMaxConnectionId`, `miniMaxAccountLabel` and `miniMaxRegion: "global" | "cn"`, selecting the matching Coding Plan integration. Kilo requires `enableKilo: true`, `kiloConnectionId`, `kiloAccountLabel` and optional nonsecret `kiloOrganizationId`. Alibaba Coding Plan requires `enableAlibaba: true`, `alibabaConnectionId`, `alibabaAccountLabel` and `alibabaRegion: "intl" | "cn"`, selecting the matching regional integration. All eight are selected key connections; browser sessions are separate routes.

The [privileged/cloud credential matrix](docs/privileged-credentials.md) lists the exact SDK-resolved credential shape and the additional account, project and permission requirements for eleven other routes. Six alias mappings remain unresolved without verified billing-pool identity.

The package is source-only and not published to npm. A Node consumer can import the built ESM artifacts with dependencies installed; Bun is used for project development and CI.

## Development

`bun run check` runs strict TypeScript, mocked tests and a Node-target build. Tests make no live provider requests. See [upstream review manifest](upstream.json) for the reviewed CodexBar snapshot and [maintenance](docs/maintenance.md) for the manual review policy.

## Attribution

The Go endpoint and percentage interpretation were reviewed against [CodexBar](https://github.com/steipete/CodexBar) at the SHA in `upstream.json`; the implementation here is independently written in TypeScript. CodexBar is MIT licensed; its copyright and license are linked in the manifest. No CodexBar source file is vendored.
