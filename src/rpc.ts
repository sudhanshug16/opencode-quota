import { Rpc } from "@opencode/plugin/rpc"

/** Stable read-only wire entrypoint. The core Observation schemaVersion distinguishes future revisions. */
export const QuotaRpc = Rpc.define({
  id: "opencode-quota",
  methods: {
    observations: {
      input: { type: "object", additionalProperties: false },
      output: {
        type: "object",
        properties: { observations: { type: "array", items: { type: "object", additionalProperties: true } } },
        required: ["observations"],
        additionalProperties: false,
      },
    },
  },
  events: {},
} as const)
