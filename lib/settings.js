import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DEFAULTS = {
  enabled: false,
  cookie: '',
  targetUid: '',
  replyMode: 'off',
  replyAfter: '',
  learnPosts: true,
  scheduleTimes: ['20:00'],
  maxPostsPerRun: 5,
  maxCommentsPerDay: 1,
  enableMemory: true,
  memoryPresetId: 'foxy3（Character）',
  llmBaseUrl: 'https://api.deepseek.com',
  llmModel: 'deepseek-chat',
  llmApiKey: '',
  runOnStart: false,
  debug: false,
}

export const SETTING_KEYS = [
  'enabled',
  'targetUid',
  'replyMode',
  'replyAfter',
  'learnPosts',
  'scheduleTimes',
  'maxPostsPerRun',
  'maxCommentsPerDay',
  'enableMemory',
  'memoryPresetId',
  'llmBaseUrl',
  'llmModel',
  'runOnStart',
  'debug',
]

const TEXT_KEYS = new Set([
  'targetUid',
  'replyAfter',
  'replyMode',
  'memoryPresetId',
  'llmBaseUrl',
  'llmModel',
])
const BOOLEAN_KEYS = new Set([
  'enabled',
  'learnPosts',
  'enableMemory',
  'runOnStart',
  'debug',
])

export function foxyHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function settingsPath() {
  return join(foxyHome(), 'foxy-weibo', 'settings.json')
}

export function normalizeUids(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[\s,，]+/)
  const out = []
  for (const item of raw) {
    const uid = String(item || '').trim()
    if (!/^\d{5,20}$/.test(uid) || out.includes(uid)) continue
    out.push(uid)
    if (out.length >= 20) break
  }
  return out
}

export function normalizeScheduleTimes(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[\s,，]+/)
  const out = []
  for (const item of raw) {
    const text = String(item || '').trim()
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text) || out.includes(text)) continue
    out.push(text)
    if (out.length >= 6) break
  }
  return out.sort()
}

function clampNumber(key, value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  if (key === 'maxPostsPerRun') return Math.max(1, Math.min(100, Math.round(n)))
  if (key === 'maxCommentsPerDay') return Math.max(0, Math.min(10, Math.round(n)))
  return n
}

export function normalizePatch(current = {}, patch = {}) {
  const next = { ...DEFAULTS, ...current }
  for (const key of SETTING_KEYS) {
    if (patch[key] === undefined || key === 'scheduleTimes') continue
    if (BOOLEAN_KEYS.has(key)) next[key] = patch[key] === true
    else if (TEXT_KEYS.has(key)) next[key] = String(patch[key] ?? '').trim()
    else next[key] = clampNumber(key, patch[key], next[key])
  }
  if (patch.scheduleTimes !== undefined) next.scheduleTimes = normalizeScheduleTimes(patch.scheduleTimes)
  if (patch.cookie !== undefined) next.cookie = String(patch.cookie || '')
  if (patch.clearCookie === true) next.cookie = ''
  if (typeof patch.accountName === 'string') next.accountName = patch.accountName.trim()
  if (typeof patch.accountUid === 'string') next.accountUid = patch.accountUid.trim()
  if (typeof patch.llmApiKey === 'string' && patch.llmApiKey.trim()) {
    next.llmApiKey = patch.llmApiKey.trim()
  }
  if (patch.clearLlmApiKey === true) next.llmApiKey = ''
  next.enabled = next.enabled === true
  next.learnPosts = next.learnPosts !== false
  next.enableMemory = next.enableMemory !== false
  next.replyMode = next.replyMode === 'auto' ? 'auto' : 'off'
  next.scheduleTimes = normalizeScheduleTimes(next.scheduleTimes)
  for (const legacy of ['targetUids', 'replyOwnPosts', 'replyOthers', 'commentMode', 'intervalMinutes', 'selfUid']) {
    delete next[legacy]
  }
  return next
}

export function loadSettings(base = {}) {
  let next = normalizePatch(DEFAULTS, base)
  try {
    if (existsSync(settingsPath())) {
      const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8'))
      // Migrate 0.2.x/0.3.x fields without keeping the old modes in the model.
      const legacyTarget = Array.isArray(parsed.targetUids) ? parsed.targetUids[0] : ''
      const migratedTarget = legacyTarget || parsed.selfUid || ''
      next = normalizePatch(next, { ...parsed, ...(migratedTarget && !parsed.targetUid ? { targetUid: migratedTarget } : {}) })
      if (typeof parsed.cookie === 'string') next.cookie = parsed.cookie
      if (typeof parsed.llmApiKey === 'string') next.llmApiKey = parsed.llmApiKey
    }
  } catch {}
  return next
}

export function saveSettings(settings) {
  const file = settingsPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  return file
}

export function publicSettings(settings) {
  const out = {}
  for (const key of SETTING_KEYS) out[key] = settings[key]
  out.cookieSet = Boolean(settings.cookie)
  out.llmApiKeySet = Boolean(settings.llmApiKey)
  out.accountName = settings.accountName || ''
  out.accountUid = settings.accountUid || ''
  return out
}
