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

/** Opt-in only. Access to an existing OpenCode connection occurs only on observation requests. */
export default Plugin.define({
  id: "opencode-quota",
  async setup(ctx) {
    const enabled = ctx.options.enableGo === true
    const account = typeof ctx.options.accountLabel === "string" && ctx.options.accountLabel.trim() ? ctx.options.accountLabel.trim() : "active"
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
    const selectedKey = async (integration: string, id: string): Promise<string | undefined> => {
      const connection = await ctx.integration.connection.active(integration)
      if (connection?.type !== "credential" || connection.id !== id || connection.method !== "key") return undefined
      const credential = await ctx.integration.connection.resolve(connection)
      return credential?.type === "key" ? credential.key : undefined
    }
    const reader = new QuotaReader([
      enabled ? goCollector({
        account,
        apiKey: async () => {
          const connection = await ctx.integration.connection.active("opencode-go")
          if (!connection) return undefined
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
      }) : ctx.options.enableZai === true ? unconfiguredCollector("zai", zaiAccount || "unselected") : unsupportedCollector("zai", zaiAccount || "unselected"),
      ctx.options.enableFireworks === true && fireworksId && fireworksAccount && /^[a-zA-Z0-9._-]+$/.test(fireworksSlug) ? fireworksCollector({
        account: fireworksAccount, accountSlug: fireworksSlug, apiKey: () => selectedKey("fireworks-ai", fireworksId),
      }) : ctx.options.enableFireworks === true ? unconfiguredCollector("fireworks", fireworksAccount || "unselected") : unsupportedCollector("fireworks", fireworksAccount || "unselected"),
      ctx.options.enableCodex === true && codexId && codexAccount ? codexCollector({
        account: codexAccount,
        oauth: () => selectedCodexOAuth(ctx.integration.connection, codexId, codexAccountId || undefined),
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
    ])
    const registration = await ctx.rpc.register(QuotaRpc, {
      observations: async (_input, context) => ({ observations: await reader.read(context.signal) }),
    })
    return async () => { reader.close(); await registration.dispose() }
  },
})
