import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fetchComments, fetchTimeline, postComment, postSummary, WeiboError } from './weibo.js'
import { judgePost } from './judge.js'
import { DEFAULTS, foxyHome, loadSettings, normalizePatch, publicSettings, saveSettings } from './settings.js'

export const name = 'dsh-foxy-weibo'
export const inject = ['connection']

export const STATUS_ROUTE = '/api/dsh-foxy-weibo/status'
export const SETTINGS_ROUTE = '/api/dsh-foxy-weibo/settings'
export const RUN_ROUTE = '/api/dsh-foxy-weibo/run'

const ACTION_LABELS = { skip: '跳过', remember: '记录', comment: '评论', error: '失败' }

function statePath() {
  return join(foxyHome(), 'foxy-weibo', 'state.json')
}

function loadState() {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8'))
    return {
      seen: parsed.seen && typeof parsed.seen === 'object' ? parsed.seen : {},
      days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, 50) : [],
      debug: Array.isArray(parsed.debug) ? parsed.debug.slice(0, 80) : [],
      lastRun: Number(parsed.lastRun) || 0,
      lastResult: parsed.lastResult || null,
    }
  } catch {
    return { seen: {}, days: {}, history: [], debug: [], lastRun: 0, lastResult: null }
  }
}

function saveState(state) {
  const file = statePath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function commentCount(state) {
  return Number(state.days?.[today()]?.comments || 0)
}

function bumpComments(state) {
  const day = today()
  if (!state.days[day]) state.days[day] = { comments: 0 }
  state.days[day].comments += 1
}

function firstLine(text, limit = 120) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function pushHistory(state, entry) {
  state.history = [entry, ...(Array.isArray(state.history) ? state.history : [])].slice(0, 50)
}

function debugLog(state, config, event) {
  if (config.debug !== true) return
  state.debug = [{ at: Date.now(), ...event }, ...(Array.isArray(state.debug) ? state.debug : [])].slice(0, 80)
}

function memoryProvider(ctx) {
  return typeof ctx.get === 'function' ? ctx.get('foxyMemory') : undefined
}

function commentsTextOf(comments) {
  return (Array.isArray(comments) ? comments : [])
    .slice(0, 10)
    .map((item) => `${item.author.name || item.author.uid}：${firstLine(item.text, 160)}`)
    .filter(Boolean)
    .join('\n')
}

function findComment(comments, cid) {
  const id = String(cid || '')
  if (!id || id === '0') return null
  return (Array.isArray(comments) ? comments : []).find((item) => item.cid === id) || null
}

async function remember(ctx, config, state, post, decision, extraText = '') {
  if (!config.enableMemory) return { ok: false, reason: 'disabled' }
  const provider = memoryProvider(ctx)
  if (!provider?.record) return { ok: false, reason: 'no-provider' }
  const body = String(decision.memory || extraText || '').trim()
  if (!body) return { ok: false, reason: 'empty' }
  const eventType = decision.action === 'comment' ? 'weibo_comment' : 'weibo_browse'
  const text = body.startsWith('我')
    ? body
    : eventType === 'weibo_comment'
      ? `我在微博评论了 ${post.author.name || '一位博主'} 的博文「${firstLine(post.text, 60)}」：${body}`
      : `我在微博看到 ${post.author.name || '一位博主'} 的博文「${firstLine(post.text, 60)}」，${body}`
  try {
    await provider.record({
      role: 'assistant',
      text,
      sessionId: `weibo:${post.id}`,
      presetId: config.memoryPresetId || 'foxy3（Character）',
      platform: 'weibo',
      sourceLabel: '微博',
      eventType,
      channelType: 'weibo_post',
      channelId: post.id,
      title: firstLine(post.text, 120),
      url: post.url,
      scene: 'weibo',
    })
    debugLog(state, config, { kind: 'memory', post: post.id, memory: 'written', text: firstLine(text, 300) })
    return { ok: true, reason: 'written', text }
  } catch (error) {
    const reason = error?.message || String(error)
    debugLog(state, config, { kind: 'memory', post: post.id, memory: 'error', reason })
    return { ok: false, reason }
  }
}

async function scanOnce(ctx, config, state, log, force = false) {
  if (!config.enabled && !force) return { skipped: 'disabled' }
  if (!config.targetUids.length) return { skipped: 'no-targets' }
  const maxPosts = Math.max(1, Math.min(20, Number(config.maxPostsPerRun) || 5))
  const result = { checked: 0, skipped: 0, remembered: 0, commented: 0, errors: 0, items: [] }
  let processed = 0

  for (const uid of config.targetUids) {
    if (processed >= maxPosts) break
    let posts = []
    try {
      posts = await fetchTimeline(uid, config)
    } catch (error) {
      result.errors += 1
      log(`[foxy-weibo] 读取 ${uid} 失败：${error?.message || error}`)
      continue
    }
    for (const post of posts) {
      if (processed >= maxPosts) break
      if (!post.id || state.seen[post.id]) continue
      processed += 1
      result.checked += 1
      let entry
      try {
        let comments = []
        try {
          comments = await fetchComments(post.mid, config, 12)
        } catch (error) {
          log(`[foxy-weibo] 读取评论失败 ${post.id}：${error?.message || error}`)
        }
        const decision = await judgePost(config, {
          summary: postSummary(post),
          comments,
          commentsText: commentsTextOf(comments),
          mayComment: config.commentMode === 'auto',
          mayReply: config.replyOthers === true && config.commentMode === 'auto',
        })
        entry = {
          at: Date.now(),
          post: post.id,
          uid,
          author: post.author.name,
          title: firstLine(post.text, 100),
          url: post.url,
          action: decision.action,
          comment: decision.comment,
          memory: '',
          reason: decision.mood || firstLine(decision.comment || decision.memory, 140),
        }
        debugLog(state, config, {
          kind: 'judge',
          post: post.id,
          action: decision.action,
          raw: String(decision.raw || '').slice(0, 500),
        })
        if (decision.action === 'skip') {
          result.skipped += 1
          entry.memory = 'skipped'
          state.seen[post.id] = { at: Date.now(), action: 'skip' }
        } else if (decision.action === 'remember') {
          const memory = await remember(ctx, config, state, post, decision)
          if (memory.ok) result.remembered += 1
          entry.memory = memory.ok ? 'written' : memory.reason
          state.seen[post.id] = { at: Date.now(), action: 'remember' }
        } else if (decision.action === 'comment') {
          if (config.commentMode !== 'auto') {
            entry.action = 'remember'
            entry.reason = '评论模式未开启'
            state.seen[post.id] = { at: Date.now(), action: 'remember' }
          } else if (commentCount(state) >= Number(config.maxCommentsPerDay || 0)) {
            entry.action = 'remember'
            entry.reason = '今日评论额度已用完'
            state.seen[post.id] = { at: Date.now(), action: 'remember' }
          } else {
            const target = config.replyOthers ? findComment(comments, decision.replyTo) : null
            await postComment({
              mid: post.mid,
              text: decision.comment,
              cid: target?.cid || '',
              config,
            })
            result.commented += 1
            bumpComments(state)
            entry.action = 'comment'
            entry.comment = decision.comment
            entry.replyTo = target?.cid || ''
            state.seen[post.id] = { at: Date.now(), action: 'comment' }
          }
          const memory = await remember(ctx, config, state, post, decision, entry.comment ? `我评论说：${entry.comment}` : '')
          if (memory.ok) result.remembered += 1
          entry.memory = memory.ok ? 'written' : memory.reason
        }
      } catch (error) {
        result.errors += 1
        entry = {
          at: Date.now(),
          post: post.id,
          uid,
          author: post.author.name,
          title: firstLine(post.text, 100),
          url: post.url,
          action: 'error',
          reason: '处理微博时出错',
          error: error?.message || String(error),
        }
        state.seen[post.id] = { at: Date.now(), action: 'error' }
        log(`[foxy-weibo] ${post.id} failed: ${error?.message || error}`)
      }
      if (entry) {
        pushHistory(state, entry)
        result.items.push(entry)
        log(
          `[foxy-weibo] 浏览 ${entry.post} @${entry.author} -> ${ACTION_LABELS[entry.action] || entry.action}` +
            (entry.error ? `（${firstLine(entry.error, 100)}）` : ''),
        )
      }
    }
  }
  state.lastRun = Date.now()
  state.lastResult = result
  return result
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function readJsonBody(request) {
  if (typeof request?.json === 'function') {
    try {
      return await request.json()
    } catch {}
  }
  const raw = request?.body
  if (raw && typeof raw.getReader === 'function') {
    const text = await new Response(raw).text()
    return text ? JSON.parse(text) : {}
  }
  if (typeof raw === 'string') return raw ? JSON.parse(raw) : {}
  if (raw && (Buffer.isBuffer(raw) || raw instanceof Uint8Array)) {
    const text = Buffer.from(raw).toString('utf8')
    return text ? JSON.parse(text) : {}
  }
  return {}
}

export function apply(ctx, rawConfig = {}) {
  const config = loadSettings({ ...DEFAULTS, ...rawConfig })
  const log = (message) => ctx.logger?.info?.(message)
  const state = loadState()
  let running = false
  let timer
  let startTimer

  const run = async (reason = 'timer', force = false) => {
    if (running) return { skipped: 'busy' }
    running = true
    try {
      log(`[foxy-weibo] 开始运行（${reason}）`)
      const result = await scanOnce(ctx, config, state, log, force)
      saveState(state)
      log(`[foxy-weibo] 运行结束 ${JSON.stringify(result)}`)
      return result
    } catch (error) {
      saveState(state)
      ctx.logger?.warn?.(`[foxy-weibo] scan failed: ${error?.message || error}`)
      return { error: String(error?.message || error) }
    } finally {
      running = false
    }
  }

  const status = () => ({
    enabled: config.enabled === true,
    running,
    lastRun: state.lastRun,
    lastResult: state.lastResult,
    recent: state.history.slice(0, 12),
    debugEnabled: config.debug === true,
    debug: state.debug.slice(0, 40),
    seen: Object.keys(state.seen).length,
    commentsToday: commentCount(state),
    cookieSet: Boolean(config.cookie),
    apiKeySet: Boolean(config.llmApiKey),
    targetCount: config.targetUids.length,
  })

  const capability = { version: 1, scan: () => run('manual', true), status }
  const foxy = typeof ctx.get === 'function' ? ctx.get('foxy') : undefined
  foxy?.registerCapability?.('weibo', async () => capability)
  ctx.provide?.('foxyWeibo', capability)

  const restartTimer = () => {
    clearInterval(timer)
    const minutes = Math.max(5, Number(config.intervalMinutes) || 60)
    timer = setInterval(() => run('timer').catch(() => {}), minutes * 60 * 1000)
    timer.unref?.()
  }
  restartTimer()
  ctx.effect?.(() => () => clearInterval(timer), 'foxy-weibo: scan timer')

  if (config.runOnStart) {
    startTimer = setTimeout(() => run('start').catch(() => {}), 20_000)
    startTimer.unref?.()
    ctx.effect?.(() => () => clearTimeout(startTimer), 'foxy-weibo: start timer')
  }

  ctx.inject?.(['connection'], (host) => {
    const register = host?.connection?.fetch?.register
    if (typeof register !== 'function') return
    const route = (path, methods, handler) =>
      register({
        path,
        methods,
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            return await handler(request)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            ctx.logger?.warn?.(`[foxy-weibo] ${path} failed: ${message}`)
            return json({ ok: false, error: message }, 500)
          }
        },
      })

    route(STATUS_ROUTE, ['GET'], async () =>
      json({ ok: true, status: status(), settings: publicSettings(config) }),
    )
    route(SETTINGS_ROUTE, ['GET', 'POST'], async (request) => {
      if (request.method === 'POST') {
        const patch = await readJsonBody(request)
        Object.assign(config, normalizePatch(config, patch))
        saveSettings(config)
        restartTimer()
      }
      return json({ ok: true, settings: publicSettings(config), status: status() })
    })
    route(RUN_ROUTE, ['POST'], async () => {
      const result = await run('manual', true)
      return json({ ok: true, result, status: status() })
    })
  })

  log(
    `[foxy-weibo] ready enabled=${config.enabled} targets=${config.targetUids.length} ` +
      `interval=${config.intervalMinutes}m comment=${config.commentMode}`,
  )
}
