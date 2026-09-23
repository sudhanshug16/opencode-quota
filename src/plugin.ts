import { Plugin } from "@opencode/plugin"
import { goCollector, unsupportedCollector } from "./collectors.js"
import { QuotaReader } from "./core.js"
import { QuotaRpc } from "./rpc.js"
import { openRouterCollector } from "./openrouter.js"
import { deepSeekCollector } from "./deepseek.js"
import { moonshotCollector } from "./moonshot.js"
import { zaiCollector } from "./zai.js"

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
      unsupportedCollector("codex"),
      unsupportedCollector("claude"),
      ctx.options.enableOpenRouter === true && openRouterAccount ? openRouterCollector({
        account: openRouterAccount,
        apiKey: async () => {
          const connection = await ctx.integration.connection.active("openrouter")
          if (!connection) return undefined
          const credential = await ctx.integration.connection.resolve(connection)
          return credential?.type === "key" ? credential.key : undefined
        },
      }) : unsupportedCollector("openrouter", openRouterAccount || "unselected"),
      ctx.options.enableDeepSeek === true && deepSeekAccount ? deepSeekCollector({
        account: deepSeekAccount,
        apiKey: async () => {
          const connection = await ctx.integration.connection.active("deepseek")
          if (!connection) return undefined
          const credential = await ctx.integration.connection.resolve(connection)
          return credential?.type === "key" ? credential.key : undefined
        },
      }) : unsupportedCollector("deepseek", deepSeekAccount || "unselected"),
      ctx.options.enableMoonshot === true && moonshotAccount && moonshotRegion ? moonshotCollector({
        account: moonshotAccount, region: moonshotRegion,
        apiKey: async () => {
          const connection = await ctx.integration.connection.active("moonshotai")
          if (!connection) return undefined
          const credential = await ctx.integration.connection.resolve(connection)
          return credential?.type === "key" ? credential.key : undefined
        },
      }) : unsupportedCollector("moonshot", moonshotAccount || "unselected"),
      ctx.options.enableZai === true && zaiAccount && zaiRegion && zaiScope ? zaiCollector({
        account: zaiAccount, region: zaiRegion, scope: zaiScope,
        apiKey: async () => {
          const connection = await ctx.integration.connection.active("zai-coding-plan")
          if (!connection) return undefined
          const credential = await ctx.integration.connection.resolve(connection)
          return credential?.type === "key" ? credential.key : undefined
        },
      }) : unsupportedCollector("zai", zaiAccount || "unselected"),
    ])
    const registration = await ctx.rpc.register(QuotaRpc, {
      observations: async (_input, context) => ({ observations: await reader.read(context.signal) }),
    })
    return async () => { reader.close(); await registration.dispose() }
  },
})
