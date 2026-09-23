import { expect, test } from "bun:test"
import parity from "../docs/parity.json" with { type: "json" }
import scope from "../docs/opencode-scope.json" with { type: "json" }
import triage from "../docs/route-triage.json" with { type: "json" }

test("all unimplemented mapped acquisition routes have exactly one disposition", () => {
  expect(triage.codexBarSha).toBe(parity.upstreamSha)
  const sources = new Map(parity.providers.map(provider => [provider.id, provider]))
  const pending = scope.eligible.flatMap(entry => entry.routes.filter(route => {
    const source = sources.get(entry.id)
    return !("supported" in source! && source.supported?.includes(route))
  }).map(route => `${entry.id}:${route}`))
  const assigned = Object.values(triage.dispositions).flatMap(group => group.routes)
  expect(assigned).toHaveLength(pending.length)
  expect(new Set(assigned).size).toBe(pending.length)
  expect([...assigned].sort()).toEqual([...pending].sort())
  expect(Object.keys(triage.unresolvedAliases).sort()).toEqual(scope.unresolved.map(item => item.id).sort())
})
