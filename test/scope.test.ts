import { expect, test } from "bun:test"
import parity from "../docs/parity.json" with { type: "json" }
import scope from "../docs/opencode-scope.json" with { type: "json" }

test("every pinned provider is partitioned; only mapped routes count as OpenCode work", () => {
  expect(scope.codexBarSha).toBe(parity.upstreamSha)
  const registry = new Map(parity.providers.map(provider => [provider.id, provider]))
  const ids = [...scope.eligible.map(item => item.id), ...scope.excluded, ...scope.unresolved.map(item => item.id)]
  expect(ids).toHaveLength(registry.size)
  expect(new Set(ids).size).toBe(registry.size)
  expect([scope.eligible.length, scope.excluded.length, scope.unresolved.length]).toEqual([43, 32, 6])
  expect(ids.every(id => registry.has(id))).toBe(true)
  for (const item of scope.eligible) {
    expect(item.openCode.length).toBeGreaterThan(0)
    expect(item.routes.every(route => registry.get(item.id)?.strategies.includes(route))).toBe(true)
    if (!item.routes.length) expect(item.id).toBe("azureopenai")
  }
  expect(scope.eligible.flatMap(item => item.routes)).toHaveLength(71)
  const supported = scope.eligible.flatMap(item => item.routes.filter(route => {
    const provider = registry.get(item.id)
    return "supported" in provider! && provider.supported?.includes(route)
  }))
  expect(supported).toHaveLength(11)
})
