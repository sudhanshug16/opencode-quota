import { Plugin } from "@opencode/plugin"
import { goCollector, unsupportedCollector } from "./collectors.js"
import { QuotaReader } from "./core.js"
import { QuotaRpc } from "./rpc.js"

/** Opt-in only. Access to an existing OpenCode connection occurs only on observation requests. */
export default Plugin.define({
  id: "opencode-quota",
  async setup(ctx) {
    const enabled = ctx.options.enableGo === true
    const account = typeof ctx.options.accountLabel === "string" && ctx.options.accountLabel.trim() ? ctx.options.accountLabel.trim() : "active"
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
    ])
    const registration = await ctx.rpc.register(QuotaRpc, {
      observations: async (_input, context) => ({ observations: await reader.read(context.signal) }),
    })
    return async () => { reader.close(); await registration.dispose() }
  },
})
