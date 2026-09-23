import { Plugin } from "@opencode/plugin"
import { goCollector, unconfiguredCollector, unsupportedCollector } from "./collectors.js"
import { QuotaReader } from "./core.js"
import { QuotaRpc } from "./rpc.js"
import { openRouterCollector } from "./openrouter.js"
import { deepSeekCollector } from "./deepseek.js"
import { moonshotCollector } from "./moonshot.js"
import { zaiCollector } from "./zai.js"
import { fireworksCollector } from "./fireworks.js"
import { codexCollector, selectedCodexOAuth } from "./codex.js"
import { copilotAccess, copilotCollector } from "./copilot.js"
import { poeCollector, selectedPoeToken } from "./poe.js"
import { deepInfraCollector } from "./deepinfra.js"
import { clinePassCollector } from "./clinepass.js"
import { kimiCollector } from "./kimi.js"
import { chutesCollector } from "./chutes.js"
import { v0Collector } from "./v0.js"
import { veniceCollector } from "./venice.js"
import { hyperCollector } from "./hyper.js"
import { huggingFaceCollector } from "./huggingface.js"
import { neuralwattCollector } from "./neuralwatt.js"
import { syntheticCollector } from "./synthetic.js"
import { miniMaxCollector } from "./minimax.js"
import { kiloCollector } from "./kilo.js"
import { alibabaCollector } from "./alibaba.js"
import { quotaReport } from "./quota-command.js"

/** Opt-in only. Access to an existing OpenCode connection occurs only on observation requests. */
export default Plugin.define({
  id: "opencode-quota",
  async setup(ctx) {
    const enabled = ctx.options.enableGo === true
    const account = typeof ctx.options.accountLabel === "string" && ctx.options.accountLabel.trim() ? ctx.options.accountLabel.trim() : "active"
    const goConnectionId = typeof ctx.options.goConnectionId === "string" ? ctx.options.goConnectionId.trim() : ""
    const openRouterAccount = typeof ctx.options.openRouterAccountLabel === "string" ? ctx.options.openRouterAccountLabel.trim() : ""
    const deepSeekAccount = typeof ctx.options.deepSeekAccountLabel === "string" ? ctx.options.deepSeekAccountLabel.trim() : ""
    const moonshotAccount = typeof ctx.options.moonshotAccountLabel === "string" ? ctx.options.moonshotAccountLabel.trim() : ""
    const moonshotRegion = ctx.options.moonshotRegion === "china" ? "china" : ctx.options.moonshotRegion === "global" ? "global" : undefined
    const zaiAccount = typeof ctx.options.zaiAccountLabel === "string" ? ctx.options.zaiAccountLabel.trim() : ""
    const zaiRegion = ctx.options.zaiRegion === "global" || ctx.options.zaiRegion === "bigmodel-cn" ? ctx.options.zaiRegion : undefined
    const zaiScope = ctx.options.zaiScope === "personal" ? { kind: "personal" as const } : undefined
    const selectedId = (value: unknown): string => typeof value === "string" ? value.trim() : ""
    const openRouterId = selectedId(ctx.options.openRouterConnectionId)
    const deepSeekId = selectedId(ctx.options.deepSeekConnectionId)
    const moonshotId = selectedId(ctx.options.moonshotConnectionId)
    const zaiId = selectedId(ctx.options.zaiConnectionId)
    const fireworksId = selectedId(ctx.options.fireworksConnectionId)
    const fireworksAccount = selectedId(ctx.options.fireworksAccountLabel)
    const fireworksSlug = selectedId(ctx.options.fireworksAccountSlug)
    const codexId = selectedId(ctx.options.codexConnectionId)
    const codexAccount = selectedId(ctx.options.codexAccountLabel)
    const codexAccountId = selectedId(ctx.options.codexAccountId)
    const copilotId = selectedId(ctx.options.copilotConnectionId)
    const copilotAccount = selectedId(ctx.options.copilotAccountLabel)
    const poeId = selectedId(ctx.options.poeConnectionId)
    const poeAccount = selectedId(ctx.options.poeAccountLabel)
    const deepInfraId = selectedId(ctx.options.deepInfraConnectionId)
    const deepInfraAccount = selectedId(ctx.options.deepInfraAccountLabel)
    const clinePassId = selectedId(ctx.options.clinePassConnectionId)
    const clinePassAccount = selectedId(ctx.options.clinePassAccountLabel)
    const kimiId = selectedId(ctx.options.kimiConnectionId)
    const kimiAccount = selectedId(ctx.options.kimiAccountLabel)
    const kimiRegion = ctx.options.kimiRegion === "china" || ctx.options.kimiRegion === "international" ? ctx.options.kimiRegion : undefined
    const chutesId = selectedId(ctx.options.chutesConnectionId)
    const chutesAccount = selectedId(ctx.options.chutesAccountLabel)
    const v0Id = selectedId(ctx.options.v0ConnectionId)
    const v0Account = selectedId(ctx.options.v0AccountLabel)
    const v0Scope = selectedId(ctx.options.v0Scope)
    const veniceId = selectedId(ctx.options.veniceConnectionId)
    const veniceAccount = selectedId(ctx.options.veniceAccountLabel)
    const hyperId = selectedId(ctx.options.hyperConnectionId)
    const hyperAccount = selectedId(ctx.options.hyperAccountLabel)
    const hfId = selectedId(ctx.options.huggingFaceConnectionId)
    const hfAccount = selectedId(ctx.options.huggingFaceAccountLabel)
    const neuralwattId = selectedId(ctx.options.neuralwattConnectionId)
    const neuralwattAccount = selectedId(ctx.options.neuralwattAccountLabel)
    const syntheticId = selectedId(ctx.options.syntheticConnectionId)
    const syntheticAccount = selectedId(ctx.options.syntheticAccountLabel)
    const miniMaxId = selectedId(ctx.options.miniMaxConnectionId)
    const miniMaxAccount = selectedId(ctx.options.miniMaxAccountLabel)
    const miniMaxRegion = ctx.options.miniMaxRegion === "global" || ctx.options.miniMaxRegion === "cn" ? ctx.options.miniMaxRegion : undefined
    const kiloId = selectedId(ctx.options.kiloConnectionId)
    const kiloAccount = selectedId(ctx.options.kiloAccountLabel)
    const kiloOrganization = selectedId(ctx.options.kiloOrganizationId)
    const alibabaId = selectedId(ctx.options.alibabaConnectionId)
    const alibabaAccount = selectedId(ctx.options.alibabaAccountLabel)
    const alibabaRegion = ctx.options.alibabaRegion === "intl" || ctx.options.alibabaRegion === "cn" ? ctx.options.alibabaRegion : undefined
    const selectedKey = async (integration: string, id: string): Promise<string | undefined> => {
      const connection = await ctx.integration.connection.active(integration)
      if (connection?.type !== "credential" || connection.id !== id || connection.method !== "key") return undefined
      const credential = await ctx.integration.connection.resolve(connection)
      return credential?.type === "key" ? credential.key : undefined
    }
    const collectors = [
      enabled ? goCollector({
        account,
        apiKey: async () => {
          const connection = await ctx.integration.connection.active("opencode-go")
          if (!connection || connection.type !== "credential" || (goConnectionId && connection.id !== goConnectionId)) return undefined
          const credential = await ctx.integration.connection.resolve(connection)
          return credential?.type === "key" ? credential.key : undefined
        },
      }) : unsupportedCollector("opencode-go", account),
      unsupportedCollector("claude"),
      ctx.options.enableOpenRouter === true && openRouterAccount && openRouterId ? openRouterCollector({
        account: openRouterAccount,
        apiKey: () => selectedKey("openrouter", openRouterId),
      }) : ctx.options.enableOpenRouter === true ? unconfiguredCollector("openrouter", openRouterAccount || "unselected") : unsupportedCollector("openrouter", openRouterAccount || "unselected"),
      ctx.options.enableDeepSeek === true && deepSeekAccount && deepSeekId ? deepSeekCollector({
        account: deepSeekAccount,
        apiKey: () => selectedKey("deepseek", deepSeekId),
      }) : ctx.options.enableDeepSeek === true ? unconfiguredCollector("deepseek", deepSeekAccount || "unselected") : unsupportedCollector("deepseek", deepSeekAccount || "unselected"),
      ctx.options.enableMoonshot === true && moonshotAccount && moonshotRegion && moonshotId ? moonshotCollector({
        account: moonshotAccount, region: moonshotRegion,
        apiKey: () => selectedKey("moonshotai", moonshotId),
      }) : ctx.options.enableMoonshot === true ? unconfiguredCollector("moonshot", moonshotAccount || "unselected") : unsupportedCollector("moonshot", moonshotAccount || "unselected"),
      ctx.options.enableZai === true && zaiAccount && zaiRegion && zaiScope && zaiId ? zaiCollector({
        account: zaiAccount, region: zaiRegion, scope: zaiScope,
        apiKey: () => selectedKey("zai-coding-plan", zaiId),
        includeCnBalance: ctx.options.enableZaiCnBalance === true,
        includeModelUsage: ctx.options.enableZaiModelUsage === true,
      }) : ctx.options.enableZai === true ? unconfiguredCollector("zai", zaiAccount || "unselected") : unsupportedCollector("zai", zaiAccount || "unselected"),
      ctx.options.enableFireworks === true && fireworksId && fireworksAccount && /^[a-zA-Z0-9._-]+$/.test(fireworksSlug) ? fireworksCollector({
        account: fireworksAccount, accountSlug: fireworksSlug, apiKey: () => selectedKey("fireworks-ai", fireworksId),
      }) : ctx.options.enableFireworks === true ? unconfiguredCollector("fireworks", fireworksAccount || "unselected") : unsupportedCollector("fireworks", fireworksAccount || "unselected"),
      ctx.options.enableCodex === true && codexId && codexAccount ? codexCollector({
        account: codexAccount,
        oauth: () => selectedCodexOAuth(ctx.integration.connection, codexId, codexAccountId || undefined),
        includeExtras: ctx.options.enableCodexExtras === true,
      }) : ctx.options.enableCodex === true ? unconfiguredCollector("codex", codexAccount || "unselected") : unsupportedCollector("codex", codexAccount || "unselected"),
      ctx.options.enableCopilot === true && copilotId && copilotAccount ? copilotCollector({
        account: copilotAccount,
        githubToken: async () => {
          const connection = await ctx.integration.connection.active("github-copilot")
          if (connection?.type !== "credential" || connection.id !== copilotId || connection.method !== "oauth") return undefined
          return copilotAccess(await ctx.integration.connection.resolve(connection))
        },
      }) : ctx.options.enableCopilot === true ? unconfiguredCollector("copilot", copilotAccount || "unselected") : unsupportedCollector("copilot", copilotAccount || "unselected"),
      ctx.options.enablePoe === true && poeId && poeAccount ? poeCollector({
        account: poeAccount, apiKey: () => selectedPoeToken(ctx.integration.connection, poeId),
      }) : ctx.options.enablePoe === true ? unconfiguredCollector("poe", poeAccount || "unselected") : unsupportedCollector("poe", poeAccount || "unselected"),
      ctx.options.enableDeepInfra === true && deepInfraId && deepInfraAccount ? deepInfraCollector({
        account: deepInfraAccount, apiKey: () => selectedKey("deepinfra", deepInfraId),
      }) : ctx.options.enableDeepInfra === true ? unconfiguredCollector("deepinfra", deepInfraAccount || "unselected") : unsupportedCollector("deepinfra", deepInfraAccount || "unselected"),
      ctx.options.enableClinePass === true && clinePassId && clinePassAccount ? clinePassCollector({
        account: clinePassAccount, apiKey: () => selectedKey("cline-pass", clinePassId),
      }) : ctx.options.enableClinePass === true ? unconfiguredCollector("clinepass", clinePassAccount || "unselected") : unsupportedCollector("clinepass", clinePassAccount || "unselected"),
      ctx.options.enableKimi === true && kimiId && kimiAccount && kimiRegion ? kimiCollector({
        account: kimiAccount, region: kimiRegion,
        apiKey: () => selectedKey(kimiRegion === "china" ? "kimi-code-plan-cn" : "kimi-code-plan-global", kimiId),
      }) : ctx.options.enableKimi === true ? unconfiguredCollector("kimi", kimiAccount || "unselected") : unsupportedCollector("kimi", kimiAccount || "unselected"),
      ctx.options.enableChutes === true && chutesId && chutesAccount ? chutesCollector({
        account: chutesAccount, apiKey: () => selectedKey("chutes", chutesId),
      }) : ctx.options.enableChutes === true ? unconfiguredCollector("chutes", chutesAccount || "unselected") : unsupportedCollector("chutes", chutesAccount || "unselected"),
      ctx.options.enableV0 === true && v0Id && v0Account && (!v0Scope || v0Scope.length <= 120 && !/[\r\n]/.test(v0Scope)) ? v0Collector({
        account: v0Account, scope: v0Scope || undefined, apiKey: () => selectedKey("v0", v0Id),
      }) : ctx.options.enableV0 === true ? unconfiguredCollector("v0", v0Account || "unselected") : unsupportedCollector("v0", v0Account || "unselected"),
      ctx.options.enableVenice === true && veniceId && veniceAccount ? veniceCollector({
        account: veniceAccount, apiKey: () => selectedKey("venice", veniceId),
      }) : ctx.options.enableVenice === true ? unconfiguredCollector("venice", veniceAccount || "unselected") : unsupportedCollector("venice", veniceAccount || "unselected"),
      ctx.options.enableHyper === true && hyperId && hyperAccount ? hyperCollector({
        account: hyperAccount, apiKey: () => selectedKey("hyper", hyperId),
      }) : ctx.options.enableHyper === true ? unconfiguredCollector("hyper", hyperAccount || "unselected") : unsupportedCollector("hyper", hyperAccount || "unselected"),
      ctx.options.enableHuggingFace === true && hfId && hfAccount ? huggingFaceCollector({
        account: hfAccount, apiKey: () => selectedKey("huggingface", hfId),
      }) : ctx.options.enableHuggingFace === true ? unconfiguredCollector("huggingface", hfAccount || "unselected") : unsupportedCollector("huggingface", hfAccount || "unselected"),
      ctx.options.enableNeuralwatt === true && neuralwattId && neuralwattAccount ? neuralwattCollector({
        account: neuralwattAccount, apiKey: () => selectedKey("neuralwatt", neuralwattId),
      }) : ctx.options.enableNeuralwatt === true ? unconfiguredCollector("neuralwatt", neuralwattAccount || "unselected") : unsupportedCollector("neuralwatt", neuralwattAccount || "unselected"),
      ctx.options.enableSynthetic === true && syntheticId && syntheticAccount ? syntheticCollector({
        account: syntheticAccount, apiKey: () => selectedKey("synthetic", syntheticId),
      }) : ctx.options.enableSynthetic === true ? unconfiguredCollector("synthetic", syntheticAccount || "unselected") : unsupportedCollector("synthetic", syntheticAccount || "unselected"),
      ctx.options.enableMiniMax === true && miniMaxId && miniMaxAccount && miniMaxRegion ? miniMaxCollector({
        account: miniMaxAccount, region: miniMaxRegion, apiKey: () => selectedKey(miniMaxRegion === "cn" ? "minimax-cn-coding-plan" : "minimax-coding-plan", miniMaxId),
      }) : ctx.options.enableMiniMax === true ? unconfiguredCollector("minimax", miniMaxAccount || "unselected") : unsupportedCollector("minimax", miniMaxAccount || "unselected"),
      ctx.options.enableKilo === true && kiloId && kiloAccount && (!kiloOrganization || /^[a-zA-Z0-9_-]{1,120}$/.test(kiloOrganization)) ? kiloCollector({
        account: kiloAccount, organization: kiloOrganization || undefined, apiKey: () => selectedKey("kilo", kiloId),
      }) : ctx.options.enableKilo === true ? unconfiguredCollector("kilo", kiloAccount || "unselected") : unsupportedCollector("kilo", kiloAccount || "unselected"),
      ctx.options.enableAlibaba === true && alibabaId && alibabaAccount && alibabaRegion ? alibabaCollector({
        account: alibabaAccount, region: alibabaRegion, apiKey: () => selectedKey(alibabaRegion === "cn" ? "alibaba-coding-plan-cn" : "alibaba-coding-plan", alibabaId),
      }) : ctx.options.enableAlibaba === true ? unconfiguredCollector("alibaba", alibabaAccount || "unselected") : unsupportedCollector("alibaba", alibabaAccount || "unselected"),
    ]
    const reader = new QuotaReader(collectors)
    const registration = await ctx.rpc.register(QuotaRpc, {
      observations: async (_input, context) => ({ observations: await reader.read(context.signal) }),
    })
    const command = await ctx.command.transform((editor) => {
      editor.add({
        name: "quota",
        description: "Show quota and usage for connected providers",
        execute: async ({ sessionID }) => {
          let accounts: { integration: string; label: string; connectionId?: string }[] = []
          let discoveryError: string | undefined
          try {
            const integrations = await ctx.integration.list()
            accounts = integrations.data.flatMap((integration) => integration.connections
              .map((connection) => connection.type === "credential"
                ? { integration: integration.id, label: connection.label, connectionId: connection.id }
                : { integration: integration.id, label: `environment ${connection.name}` }))
          } catch (error) {
            discoveryError = error instanceof Error ? error.name : "Error"
          }
          const mappings: [string, string, string][] = [
              ["openrouter", openRouterId, openRouterAccount], ["deepseek", deepSeekId, deepSeekAccount], ["moonshotai", moonshotId, moonshotAccount],
              ["zai-coding-plan", zaiId, zaiAccount], ["fireworks-ai", fireworksId, fireworksAccount], ["openai", codexId, codexAccount],
              ["github-copilot", copilotId, copilotAccount], ["poe", poeId, poeAccount], ["deepinfra", deepInfraId, deepInfraAccount],
              ["cline-pass", clinePassId, clinePassAccount], [kimiRegion === "china" ? "kimi-code-plan-cn" : "kimi-code-plan-global", kimiId, kimiAccount],
              ["chutes", chutesId, chutesAccount], ["v0", v0Id, v0Account], ["venice", veniceId, veniceAccount], ["hyper", hyperId, hyperAccount],
              ["huggingface", hfId, hfAccount], ["neuralwatt", neuralwattId, neuralwattAccount], ["synthetic", syntheticId, syntheticAccount],
              [miniMaxRegion === "cn" ? "minimax-cn-coding-plan" : "minimax-coding-plan", miniMaxId, miniMaxAccount], ["kilo", kiloId, kiloAccount],
              [alibabaRegion === "cn" ? "alibaba-coding-plan-cn" : "alibaba-coding-plan", alibabaId, alibabaAccount],
          ]
          const configured = [
            ...(enabled && goConnectionId ? [{ integration: "opencode-go", connectionId: goConnectionId, account, collect: async () => {
              const connection = await ctx.integration.connection.active("opencode-go")
              if (connection?.type !== "credential" || connection.id !== goConnectionId || connection.method !== "key") {
                throw new Error("selected connection is not active")
              }
              return collectors[0]!.collect(new AbortController().signal)
            } }] : []),
            ...mappings.flatMap(([integration, connectionId, label], index) => {
            if (!connectionId || !label) return []
            const collector = collectors[index + 2]
            return collector ? [{ integration, connectionId, account: label, collect: () => collector.collect(new AbortController().signal) }] : []
            }),
          ]
          const unsupported = new Set(["claude"])
          const report = await quotaReport({ accounts, collectors: configured, unsupported })
          await ctx.session.synthetic({ sessionID, text: discoveryError ? `${report}\nIntegration discovery failed (${discoveryError}); this report may be incomplete.` : report })
        },
      })
    })
    return async () => { reader.close(); await command.dispose(); await registration.dispose() }
  },
})
