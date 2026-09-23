import { expect, test } from "bun:test"
import { miniMaxCollector, parseMiniMaxRemains } from "../src/minimax.js"

const now = new Date("2026-09-23T12:00:00Z")
const body = { base_resp: { status_code: 0 }, current_subscribe_title: "Max", model_remains: [{ model_name: "MiniMax-M2",
  current_interval_total_count: 1000, current_interval_usage_count: 250, start_time: 1790164800000, end_time: 1790182800000,
  current_weekly_total_count: 2000, current_weekly_usage_count: 1500, weekly_end_time: 1790812800000 }] }

test("MiniMax remaining counts are not used counts; weekly only for text models", () => {
  expect(parseMiniMaxRemains(body, "selected", "global", now)).toMatchObject({ serviceStatus: "Max", windows: [
    { id: "MiniMax-M2:rolling", scope: "MiniMax-M2", used: 750, limit: 1000, remaining: 250, unit: "prompts" },
    { id: "MiniMax-M2:weekly", kind: "weekly", used: 500, limit: 2000, remaining: 1500 },
  ] })
  expect(parseMiniMaxRemains({ ...body, model_remains: [{ ...body.model_remains[0], model_name: "video" }] }, "selected", "cn", now)?.windows).toHaveLength(1)
  expect(parseMiniMaxRemains({ base_resp: { status_code: 1004 } }, "selected", "cn", now)).toBeUndefined()
})

test("selected region key stays on exact region; legacy fallback and auth failure", async () => {
  const urls: string[] = []
  const collector = miniMaxCollector({ account: "selected", region: "cn", apiKey: async () => "fake", now: () => now, fetch: async (url, init) => {
    urls.push(url)
    expect(init).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer fake", "MM-API-Source": "CodexBar" } })
    return url.includes("token_plan") ? new Response("denied", { status: 403 }) : Response.json(body)
  } })
  const result = await collector.collect(new AbortController().signal)
  expect(urls).toEqual(["https://api.minimaxi.com/v1/token_plan/remains", "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains"])
  expect(result.status).toBe("available")
  expect(JSON.stringify(result)).not.toContain("fake")
  expect(await miniMaxCollector({ account: "selected", region: "cn", apiKey: async () => "fake", fetch: async () => new Response("denied", { status: 403 }) }).collect(new AbortController().signal)).toMatchObject({ status: "unavailable", reason: "auth", windows: [] })
})
