import manifest from "../upstream.json"
import { appendFileSync } from "node:fs"

const url = `https://api.github.com/repos/${manifest.repository}/compare/${manifest.reviewedSha}...HEAD`
const response = await fetch(url, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${process.env.GH_TOKEN ?? ""}`, "User-Agent": "opencode-quota-upstream-check" } })
if (!response.ok) throw new Error(`upstream comparison failed: HTTP ${response.status}`)
const data = await response.json() as { ahead_by?: number; files?: { filename: string; status: string }[] }
if (!Array.isArray(data.files) || data.files.length >= 300 || typeof data.ahead_by !== "number" || data.ahead_by >= 250) {
  throw new Error("GitHub compare result may be truncated; inspect upstream diff manually before updating the pin")
}
const relevant = (data.files ?? []).filter(file => manifest.reviewedPaths.includes(file.filename) || manifest.reviewedPrefixes.some(prefix => file.filename.startsWith(prefix)))
const summary = [`## CodexBar upstream`, `Reviewed: \`${manifest.reviewedSha}\``, `Commits ahead: ${data.ahead_by ?? "unknown"}`, ...relevant.map(file => `- ${file.status}: \`${file.filename}\``), relevant.length ? "Review source and fixtures manually before changing the pin." : "No reviewed paths changed in the comparison response."].join("\n") + "\n"
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
else console.log(summary)
