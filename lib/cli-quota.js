import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const CACHE_MS = 5 * 60 * 1000
const ERROR_RETRY_MS = 60 * 1000

let cache = { at: 0, windows: [] }
let inflight = null

function parseLine(line) {
  const [group, label, percent, reset] = String(line).split('\t').map((part) => part.trim())
  if (!group || !label || !percent) return null
  const title = /^gemini/i.test(group) ? 'Gemini'
    : /^claude/i.test(group) ? 'Claude and GPT'
      : ''
  if (!title) return null
  const remaining = Number(percent.replace('%', ''))
  if (!Number.isFinite(remaining)) return null
  const windowName = /weekly/i.test(label) ? 'weekly'
    : /five.?hour/i.test(label) ? '5h'
      : ''
  if (!windowName) return null
  const resetAt = Date.parse(reset)
  return {
    id: title + ':' + windowName,
    en: title + ' · ' + windowName,
    zh: title + ' · ' + windowName,
    usedPercent: Math.max(0, Math.min(100, 100 - remaining)),
    ...(Number.isFinite(resetAt) && resetAt > 0 ? { resetAt } : {}),
  }
}

/**
 * The Antigravity CLI exposes a weekly Gemini cap that the Code Assist summary
 * response currently omits. Read its read-only /quota output when needed and
 * cache it briefly; failures are silent so users without the CLI are unaffected.
 * Set DSH_SUBSCRIPTIONS_CLI_QUOTA=0 to disable this fallback entirely.
 */
export async function readCliQuota() {
  if (process.env.DSH_SUBSCRIPTIONS_CLI_QUOTA === '0') return []
  if (Date.now() - cache.at < CACHE_MS) return cache.windows
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const { stdout } = await execFileAsync(process.env.AGY_BIN || 'agy', ['-p', '/quota'], {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      })
      const windows = []
      for (const line of String(stdout || '').split(/\r?\n/)) {
        const window = parseLine(line)
        if (window) windows.push(window)
      }
      cache = { at: Date.now(), windows }
      return windows
    } catch {
      // Missing CLI, timeout, or an unparseable output: retry later, not on
      // every status poll.
      cache = { at: Date.now() - CACHE_MS + ERROR_RETRY_MS, windows: [] }
      return []
    } finally {
      inflight = null
    }
  })()
  return inflight
}
