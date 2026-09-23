import { Plugin } from "@opencode/plugin"
import { goCollector, unconfiguredCollector, unsupportedCollector } from "./collectors.js"
import { QuotaReader } from "./core.js"
import { QuotaRpc } from "./rpc.js"
import { openRouterCollector } from "./openrouter.js"
import { deepSeekCollector } from "./deepseek.js"
import { moonshotCollector } from "./moonshot.js"
import { zaiCollector } from "./zai.js"
import { fireworksCollector } from "./fireworks.js"
import { codexAccess, codexCollector } from "./codex.js"

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
      ctx.options.enableCodex === true && codexId && codexAccount && codexAccountId ? codexCollector({
        account: codexAccount, accountId: codexAccountId,
        accessToken: async () => {
          const connection = await ctx.integration.connection.active("openai")
          if (connection?.type !== "credential" || connection.id !== codexId || connection.method !== "oauth") return undefined
          const credential = await ctx.integration.connection.resolve(connection)
          return codexAccess(credential, codexAccountId)
        },
      }) : ctx.options.enableCodex === true ? unconfiguredCollector("codex", codexAccount || "unselected") : unsupportedCollector("codex", codexAccount || "unselected"),
    ])
    const registration = await ctx.rpc.register(QuotaRpc, {
      observations: async (_input, context) => ({ observations: await reader.read(context.signal) }),
    })
    return async () => { reader.close(); await registration.dispose() }
  },
})
