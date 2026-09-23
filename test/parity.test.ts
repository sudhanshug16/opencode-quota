import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import parity from "../docs/parity.json" with { type: "json" }
import pin from "../upstream.json" with { type: "json" }

test("pinned registry inventory keeps unique providers and only fixture-backed support", () => {
  expect(parity.upstreamSha).toBe(pin.reviewedSha)
  expect(parity.providers).toHaveLength(81)
  expect(new Set(parity.providers.map(provider => provider.id)).size).toBe(81)
  const supported = parity.providers.filter(provider => "supported" in provider)
  expect(supported.map(provider => provider.id)).toEqual(["codex", "opencodego", "fireworks", "zai", "moonshot", "openrouter", "deepseek"])
  for (const provider of supported) {
    if (!("supported" in provider) || !provider.supported || !("fixture" in provider) || !provider.fixture) throw new Error("Missing fixture")
    expect(provider.supported.every(strategy => provider.strategies.includes(strategy))).toBe(true)
    expect(existsSync(new URL(`../${provider.fixture}`, import.meta.url))).toBe(true)
  }
})
