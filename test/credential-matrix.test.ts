import { expect, test } from "bun:test"
import matrix from "../docs/credential-matrix.json" with { type: "json" }
import scope from "../docs/opencode-scope.json" with { type: "json" }
import parity from "../docs/parity.json" with { type: "json" }

test("credential-only matrix tracks supported provider families without claiming live accounts", () => {
  const supported = parity.providers.filter(provider => "supported" in provider).map(provider => provider.id)
  expect(matrix.implemented.map(item => item.id).sort()).toEqual(supported.sort())
  expect(matrix.implemented.filter(item => item.bridge === "source-aligned")).toHaveLength(8)
  expect(matrix.implemented.filter(item => item.bridge === "conditional")).toHaveLength(12)
  expect(scope.eligible.length - matrix.implemented.length).toBe(23)
  expect(matrix.implemented.every(item => item.facts.length && item.condition)).toBe(true)
})
