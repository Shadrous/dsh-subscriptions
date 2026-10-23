import { randomUUID } from 'node:crypto'
import { httpError, readJson } from './wire.js'
import { validationFromLoadCodeAssist, noticeFromLoadCodeAssist, validationRequiredError } from './google-validation.js'
import { asUsageSnapshot, usageWindows, deepestUsedPercent } from './usage.js'
import { readCliQuota } from './cli-quota.js'

export const CODE_ASSIST_PROD = 'https://cloudcode-pa.googleapis.com/v1internal'
export const CODE_ASSIST_STREAM = 'https://daily-cloudcode-pa.googleapis.com/v1internal'
// Quota summaries are served by the same daily backend the stream and the
// Antigravity CLI use. The production host answers with only the Claude/GPT
// group for consumer accounts, which made the header pill show 0% while the
// Gemini windows were already in use.
export const CODE_ASSIST_QUOTA = CODE_ASSIST_STREAM
export const CODE_ASSIST = CODE_ASSIST_PROD

export function antigravityPlatform() {
  if (process.platform === 'win32') return 'WINDOWS_AMD64'
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'DARWIN_ARM64' : 'DARWIN_AMD64'
  return process.arch === 'arm64' ? 'LINUX_ARM64' : 'LINUX_AMD64'
}

export function antigravityMetadata(projectId) {
  const meta = {
    ideType: 'ANTIGRAVITY',
    platform: antigravityPlatform(),
    pluginType: 'GEMINI',
  }
  if (projectId) meta.duetProject = projectId
  return meta
}

export function antigravityIdentityHeaders(projectId) {
  const uaPlat = process.platform === 'darwin' ? 'darwin/amd64' : process.platform === 'win32' ? 'windows/amd64' : 'linux/amd64'
  return {
    'user-agent': `antigravity/1.18.3 ${uaPlat}`,
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify(antigravityMetadata(projectId)),
  }
}

export function assistHeaders(token, extra) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(extra || {}),
  }
}

export async function postAssist(fetchImpl, method, token, body, extraHeaders, base = CODE_ASSIST) {
  const res = await fetchImpl(`${base}:${method}`, {
    method: 'POST',
    headers: assistHeaders(token, extraHeaders),
    body: JSON.stringify(body || {}),
  })
  return readJson(res)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function projectFrom(obj) {
  if (!obj || typeof obj !== 'object') return ''
  if (typeof obj.cloudaicompanionProject === 'string') return obj.cloudaicompanionProject
  const nested = obj.cloudaicompanionProject
  if (nested && typeof nested === 'object') return String(nested.id || nested.name || '')
  if (obj.response && obj.response.cloudaicompanionProject) {
    const r = obj.response.cloudaicompanionProject
    return typeof r === 'string' ? r : String(r.id || r.name || '')
  }
  return ''
}

export function accountFromLoad(load) {
  const current = load && load.currentTier && typeof load.currentTier === 'object' ? load.currentTier : {}
  const paidTierId = load?.paidTier?.id ? String(load.paidTier.id) : ''
  return {
    projectId: projectFrom(load),
    tierId: String(current.id || paidTierId || 'free-tier'),
    paidTierId,
    paidTierName: load?.paidTier?.name ? String(load.paidTier.name) : '',
  }
}

export async function resolveProjectId(fetchImpl, token, metadata, extraHeaders, currentProjectId) {
  const load = await postAssist(fetchImpl, 'loadCodeAssist', token, { metadata }, extraHeaders)
  const validation = validationFromLoadCodeAssist(load)
  if (validation) throw validationRequiredError(validation)
  const account = accountFromLoad(load)
  if (account.projectId) return { ...account, load }
  if (currentProjectId) return { ...account, projectId: currentProjectId, load }
  return { ...account, projectId: '', load }
}

function pickOnboardTier(load) {
  const current = load?.currentTier
  const paidTierId = load?.paidTier?.id ? String(load.paidTier.id) : ''
  if (paidTierId === 'g1-pro-tier') return 'standard-tier'
  for (const tier of load?.allowedTiers || []) {
    if (tier?.isDefault && tier?.id) return String(tier.id)
  }
  return String(current?.id || 'free-tier')
}

export async function discoverProject(fetchImpl, token, metadata, extraHeaders) {
  const resolved = await resolveProjectId(fetchImpl, token, metadata, extraHeaders, '')
  const { load } = resolved
  const account = accountFromLoad(load)
  if (account.projectId) {
    return {
      projectId: account.projectId,
      tierId: account.paidTierId || account.tierId,
      paidTierId: account.paidTierId,
      paidTierName: account.paidTierName,
    }
  }
  const tierId = pickOnboardTier(load)
  const onboardBody = {
    tierId,
    metadata,
    ...(tierId !== 'free-tier' && tierId !== 'FREE' ? { cloudaicompanionProject: metadata.duetProject } : {}),
  }
  let op = await postAssist(fetchImpl, 'onboardUser', token, onboardBody, extraHeaders).catch(() => null)
  let n = 0
  while (op && op.done === false && op.name && n < 8) {
    await sleep(400)
    try {
      op = await postAssist(fetchImpl, 'loadCodeAssist', token, { metadata }, extraHeaders)
    } catch {
      break
    }
    n += 1
  }
  const projectId = projectFrom(op) || account.projectId
  const after = accountFromLoad(op && op.response ? op.response : load)
  const notice = noticeFromLoadCodeAssist(op && op.response ? op.response : load)
  return {
    projectId,
    tierId: after.paidTierId || tierId,
    paidTierId: after.paidTierId,
    paidTierName: after.paidTierName,
    accountNotice: notice ? notice.message : '',
  }
}

function catalogFallback(fallbackIds, provider) {
  return (fallbackIds || []).map((row) => {
    if (typeof row === 'string') return { provider, id: row, name: row }
    const id = row && (row.id || row.name)
    if (!id) return null
    return { provider, id, name: row.name || id }
  }).filter(Boolean)
}

function catalogRows(json) {
  const raw = json?.models ?? json?.availableModels ?? json?.data ?? []
  if (Array.isArray(raw)) return raw.map((row) => (typeof row === 'string' ? { id: row } : row))
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([id, row]) => ({ ...(row || {}), id }))
  }
  return []
}

/** One Gemini Flash entry, with effort selectable instead of separate ids. */
export const ANTIGRAVITY_FLASH_REASONING = Object.freeze({
  efforts: Object.freeze([
    { id: 'low', name: 'Low' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
  ]),
  defaultEffort: 'medium',
})

function geminiFlashModel(raw) {
  const match = /^gemini-(3\.[78])-flash(?:-(?:low|medium|high|tiered))?$/.exec(String(raw || ''))
  return match ? { id: `gemini-${match[1]}-flash`, name: `Gemini ${match[1]} Flash` } : null
}

export function antigravityTieredAlias(model) {
  const match = /^gemini-(3\.[78])-flash(?:-(low|medium|high|tiered))?$/.exec(model || '')
  if (!match) return null
  const level = match[2] && match[2] !== 'tiered' ? match[2] : null
  return { model: `gemini-${match[1]}-flash-tiered`, thinkingLevel: level }
}

export async function fetchAvailableModels(fetchImpl, token, extraHeaders, fallbackIds, provider) {
  try {
    const json = await postAssist(fetchImpl, 'fetchAvailableModels', token, {}, extraHeaders)
    const out = []
    const catalog = catalogRows(json)
    const addFlash = (raw, row) => {
      const flash = geminiFlashModel(raw)
      if (!flash) return false
      if (!out.some((entry) => entry.id === flash.id)) {
        out.push({
          provider,
          id: flash.id,
          name: flash.name,
          description: 'Reasoning effort selectable',
          reasoning: ANTIGRAVITY_FLASH_REASONING,
          ...(row && row.maxTokens ? { contextWindow: row.maxTokens } : {}),
        })
      }
      return true
    }
    for (const row of catalog) {
      if (!row) continue
      if (typeof row === 'string') {
        if (addFlash(row, null)) continue
        if (row && !row.startsWith('chat_') && !row.startsWith('tab_')) out.push({ provider, id: row, name: row })
        continue
      }
      if (row.isInternal) continue
      const raw = String(row.id || row.name || row.model || '').replace(/^models\//, '')
      if (!raw || raw.startsWith('chat_') || raw.startsWith('tab_')) continue
      const display = row.displayName ?? row.display_name
      if (display === '' && !raw.endsWith('-tiered')) continue
      if (addFlash(raw, row)) continue
      out.push({
        provider,
        id: raw,
        name: display || raw,
        ...(row.recommended ? { description: 'Recommended' } : {}),
        ...(row.maxTokens ? { contextWindow: row.maxTokens } : {}),
      })
    }
    if (out.length) {
      out.sort((a, b) => Number(Boolean(b.description)) - Number(Boolean(a.description)) || a.name.localeCompare(b.name))
      return out
    }
  } catch { /* catalog fallback */ }
  return catalogFallback(fallbackIds, provider)
}

function quotaSummaryWindows(payload) {
  const root = payload && payload.response && typeof payload.response === 'object' ? payload.response : payload
  const groups = Array.isArray(root && root.groups) ? root.groups : []
  const windows = []
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue
    const title = String(group.displayName || group.name || group.groupId || 'quota').replace(/\s+models$/i, '').trim() || 'quota'
    const buckets = Array.isArray(group.buckets) ? group.buckets : []
    for (const bucket of buckets) {
      if (!bucket || typeof bucket !== 'object') continue
      const fraction = Number(bucket.remainingFraction ?? bucket.remaining_fraction)
      if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) continue
      const windowName = String(bucket.window || 'window')
      const resetAt = parseReset(bucket.resetTime ?? bucket.reset_time)
      windows.push({
        id: title + ':' + windowName,
        en: title + ' · ' + windowName,
        zh: title + ' · ' + windowName,
        usedPercent: (1 - fraction) * 100,
        ...(resetAt ? { resetAt } : {}),
      })
    }
  }
  return windows
}

function parseReset(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Per-model buckets from retrieveUserQuota. The summary endpoint stopped
 * returning the Gemini group for consumer accounts, but the per-model buckets
 * still carry the live Gemini 5-hour window. Reconstruct a group/window view
 * and let retrieveQuotaPercent merge it with the summary.
 */
function quotaBucketWindows(payload) {
  const root = payload && payload.response && typeof payload.response === 'object' ? payload.response : payload
  const buckets = Array.isArray(root && root.buckets) ? root.buckets : []
  const windows = new Map()
  const now = Date.now()
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== 'object') continue
    const model = String(bucket.modelId || bucket.model_id || '')
    const title = /^gemini/i.test(model) ? 'Gemini'
      : /^(claude|gpt)/i.test(model) ? 'Claude and GPT'
        : ''
    if (!title) continue
    const fraction = Number(bucket.remainingFraction ?? bucket.remaining_fraction)
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) continue
    const resetAt = parseReset(bucket.resetTime ?? bucket.reset_time)
    const remainingMs = resetAt && resetAt > now ? resetAt - now : 0
    const windowName = remainingMs > 0 && remainingMs <= 8 * 60 * 60 * 1000
      ? '5h'
      : remainingMs >= 4 * 24 * 60 * 60 * 1000 ? 'weekly' : 'window'
    const id = title + ':' + windowName
    const usedPercent = (1 - fraction) * 100
    const previous = windows.get(id)
    if (!previous || usedPercent > previous.usedPercent) {
      windows.set(id, {
        id,
        en: title + ' · ' + windowName,
        zh: title + ' · ' + windowName,
        usedPercent,
        ...(resetAt ? { resetAt } : {}),
      })
    }
  }
  return [...windows.values()]
}

export async function retrieveQuotaPercent(fetchImpl, token, extraHeaders, projectId) {
  try {
    const body = projectId ? { project: projectId } : {}
    const [summary, buckets] = await Promise.all([
      postAssist(fetchImpl, 'retrieveUserQuotaSummary', token, body, extraHeaders, CODE_ASSIST_QUOTA).catch(() => null),
      postAssist(fetchImpl, 'retrieveUserQuota', token, body, extraHeaders, CODE_ASSIST_QUOTA).catch(() => null),
    ])
    const windows = quotaSummaryWindows(summary)
    const seen = new Set(windows.map((window) => window.id))
    for (const window of quotaBucketWindows(buckets)) {
      if (seen.has(window.id)) continue
      seen.add(window.id)
      windows.push(window)
    }
    // The summary now omits the Gemini weekly group. The vendor's own CLI still
    // exposes it through its read-only /quota command; use it only to fill the
    // missing window, never to override the live API values.
    if (!seen.has('Gemini:weekly')) {
      try {
        for (const window of await readCliQuota()) {
          if (seen.has(window.id)) continue
          seen.add(window.id)
          windows.push(window)
        }
      } catch { /* CLI fallback is best-effort */ }
    }
    if (windows.length) {
      return {
        usedPercent: Math.max(...windows.map((window) => window.usedPercent)),
        windows,
      }
    }
    const snap = asUsageSnapshot(deepestUsedPercent(summary || buckets))
    if (snap) snap.windows = usageWindows(summary || buckets)
    return snap
  } catch {
    return null
  }
}

const G1_CREDIT_TYPE = 'GOOGLE_ONE_AI'

export function streamEnvelope({ projectId, model, request, userAgent, sessionId, paidTierId }) {
  const session = sessionId || randomUUID()
  const body = { ...(request || {}) }
  if (!body.session_id) body.session_id = session
  /** @type {Record<string, any>} */
  const envelope = {
    ...(projectId ? { project: projectId } : {}),
    model,
    user_prompt_id: randomUUID(),
    request: body,
    userAgent,
  }
  if (paidTierId === 'g1-pro-tier') envelope.enabled_credit_types = [G1_CREDIT_TYPE]
  return { envelope, sessionId: session }
}

export { httpError }

export async function inspectGoogleAccount(fetchImpl, token, { metadata, extraHeaders, projectId }) {
  try {
    const { projectId: resolvedProject, load } = await resolveProjectId(
      fetchImpl,
      token,
      metadata,
      extraHeaders,
      projectId || '',
    )
    const validation = validationFromLoadCodeAssist(load)
    if (validation) return { validation, notice: null, projectId: resolvedProject }
    const notice = noticeFromLoadCodeAssist(load)
    const account = accountFromLoad(load)
    return {
      validation: null,
      notice,
      accountNotice: notice ? notice.message : '',
      projectId: resolvedProject,
      paidTierId: account.paidTierId,
      paidTierName: account.paidTierName,
    }
  } catch (err) {
    if (err && err.code === 'VALIDATION_REQUIRED' && err.validationUrl) {
      return {
        validation: {
          message: String(err.message || ''),
          validationUrl: err.validationUrl,
          learnMoreUrl: err.learnMoreUrl || '',
        },
        notice: null,
        projectId: projectId || '',
      }
    }
    return { validation: null, notice: null, projectId: projectId || '' }
  }
}
