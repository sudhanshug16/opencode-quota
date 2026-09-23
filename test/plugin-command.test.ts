import { describe, expect, test } from "bun:test"
import plugin from "../src/plugin.js"

describe("OpenCode /quota command registration", () => {
  test("registers slash command and renders current integration connections", async () => {
    let command: { name: string; execute: (input: { sessionID: string }) => Promise<void> } | undefined
    let output = ""
    const ctx = {
      options: {},
      rpc: { register: async () => ({ dispose: async () => undefined }) },
      command: { transform: async (callback: (editor: { add(definition: typeof command): void }) => void) => {
        callback({ add: (definition) => { command = definition as typeof command } })
        return { dispose: async () => undefined }
      } },
      integration: { list: async () => ({ data: [
        { id: "claude", connections: [{ type: "credential", id: "c-1", label: "work", method: "oauth" }] },
        { id: "openrouter", connections: [{ type: "credential", id: "o-1", label: "personal", method: "key" }] },
      ] }) },
      session: { synthetic: async (input: { text: string }) => { output = input.text } },
    }
    const cleanup = await plugin.setup(ctx as never)
    expect(command?.name).toBe("quota")
    await command?.execute({ sessionID: "session" })
    expect(output).toContain("claude (work): unsupported")
    expect(output).toContain("openrouter (personal): unavailable")
    if (cleanup) await cleanup()
  })
})
