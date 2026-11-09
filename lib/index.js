import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fetchChildComments, fetchComments, fetchTimeline, postComment, postSummary } from './weibo.js'
import { fallbackPostMemory, judgePost, summarizePostMemory, summarizeRange } from './judge.js'
import { fetchAccount, loginPoll, loginStart } from './login.js'
import { DEFAULTS, foxyHome, loadSettings, normalizePatch, publicSettings, saveSettings } from './settings.js'

export const name = 'dsh-foxy-weibo'
export const inject = ['connection']

export const STATUS_ROUTE = '/api/dsh-foxy-weibo/status'
export const SETTINGS_ROUTE = '/api/dsh-foxy-weibo/settings'
export const RUN_ROUTE = '/api/dsh-foxy-weibo/run'
export const CHECK_NOW_ROUTE = '/api/dsh-foxy-weibo/check-now'
export const READ_NOW_ROUTE = '/api/dsh-foxy-weibo/read-now'
export const REPLY_NOW_ROUTE = '/api/dsh-foxy-weibo/reply-now'
export const LOGIN_START_ROUTE = '/api/dsh-foxy-weibo/login/start'
export const LOGIN_POLL_ROUTE = '/api/dsh-foxy-weibo/login/poll'
export const LOGOUT_ROUTE = '/api/dsh-foxy-weibo/logout'
export const EXTRACT_ROUTE = '/api/dsh-foxy-weibo/extract'

const ACTION_LABELS = {
  skip: '跳过',
  remember: '记录',
  comment: '评论',
  reply: '回复',
  'pending-reply': '待回复',
  error: '失败',
}

function statePath() {
  return join(foxyHome(), 'foxy-weibo', 'state.json')
}

function loadState() {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8'))
    return {
      seen: parsed.seen && typeof parsed.seen === 'object' ? parsed.seen : {},
      commentSeen:
        parsed.commentSeen && typeof parsed.commentSeen === 'object' ? parsed.commentSeen : {},
      postSeen: parsed.postSeen && typeof parsed.postSeen === 'object' ? parsed.postSeen : {},
      postMemory:
        parsed.postMemory && typeof parsed.postMemory === 'object' ? parsed.postMemory : {},
      days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, 50) : [],
      debug: Array.isArray(parsed.debug) ? parsed.debug.slice(0, 80) : [],
      lastRun: Number(parsed.lastRun) || 0,
      lastResult: parsed.lastResult || null,
    }
  } catch {
    return {
      seen: {},
      commentSeen: {},
      postSeen: {},
      postMemory: {},
      days: {},
      history: [],
      debug: [],
      lastRun: 0,
      lastResult: null,
    }
  }
}

function saveState(state) {
  const file = statePath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

const STATE_LOCK_STALE_MS = 5 * 60 * 1000

function stateLockPath() {
  return `${statePath()}.lock`
}

function acquireStateLock() {
  const file = stateLockPath()
  mkdirSync(dirname(file), { recursive: true })
  try {
    const fd = openSync(file, 'wx')
    writeFileSync(fd, `${process.pid}\n`, 'utf8')
    closeSync(fd)
    return true
  } catch (error) {
    if (error?.code !== 'EEXIST') return false
    try {
      if (Date.now() - statSync(file).mtimeMs > STATE_LOCK_STALE_MS) {
        unlinkSync(file)
        return acquireStateLock()
      }
    } catch {
      // Another process may have removed it between stat and unlink.
    }
    return false
  }
}

function releaseStateLock() {
  try {
    unlinkSync(stateLockPath())
  } catch {
    // Already gone.
  }
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

function entryReason(decision) {
  return (
    String(decision?.mood || decision?.memory || decision?.reason || '').trim() ||
    '模型判断不需要评论'
  )
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

async function rememberReply(ctx, config, state, post, comment, replyText) {
  if (!config.enableMemory) return { ok: false, reason: 'disabled' }
  const provider = memoryProvider(ctx)
  if (!provider?.record) return { ok: false, reason: 'no-provider' }
  const person = comment.author?.name || comment.author?.uid || '一位网友'
  const text = `我在微博回复了 ${person} 在自己博文「${firstLine(post.text, 60)}」下的评论：${replyText}`
  try {
    await provider.record({
      role: 'assistant',
      text,
      sessionId: `weibo-comment:${post.id}:${comment.cid}`,
      presetId: config.memoryPresetId || 'foxy3（Character）',
      platform: 'weibo',
      speakerKey: comment.author?.uid ? `weibo:${comment.author.uid}` : undefined,
      speakerLabel: comment.author?.name || undefined,
      sourceLabel: '微博评论回复',
      eventType: 'weibo_reply',
      channelType: 'weibo_comment',
      channelId: String(comment.cid),
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

async function rememberPost(ctx, config, state, post) {
  if (!config.enableMemory || config.learnPosts === false) {
    return { ok: false, reason: 'disabled' }
  }
  if (state.postMemory?.[post.id]) return { ok: false, reason: 'already' }
  const provider = memoryProvider(ctx)
  if (!provider?.record) return { ok: false, reason: 'no-provider' }
  const excerpt = firstLine(post.text, 180)
  const text = (await summarizePostMemory(config, post)) || fallbackPostMemory(post)
  try {
    await provider.record({
      role: 'assistant',
      text,
      sessionId: `weibo-post:${post.id}`,
      presetId: config.memoryPresetId || 'foxy3（Character）',
      platform: 'weibo',
      speakerKey: post.author?.uid ? `weibo:${post.author.uid}` : undefined,
      speakerLabel: post.author?.name || undefined,
      sourceLabel: '目标账号博文',
      eventType: 'weibo_owner_post',
      channelType: 'weibo_post',
      channelId: post.id,
      title: excerpt,
      url: post.url,
      scene: 'weibo',
    })
    state.postMemory = state.postMemory || {}
    state.postMemory[post.id] = Date.now()
    debugLog(state, config, {
      kind: 'memory',
      post: post.id,
      memory: 'written',
      eventType: 'weibo_owner_post',
      text: firstLine(text, 300),
    })
    return { ok: true, reason: 'written', text }
  } catch (error) {
    const reason = error?.message || String(error)
    debugLog(state, config, { kind: 'memory', post: post.id, memory: 'error', reason })
    return { ok: false, reason }
  }
}

async function scanNestedReplies(
  ctx,
  config,
  state,
  log,
  posts,
  loginUid,
  memoryContext = '',
  options = {},
) {
  const result = { checked: 0, replied: 0, skipped: 0, errors: 0, items: [] }
  if (!config.replyNested) return result
  const dryRun = options.dryRun === true
  const targetCid = String(options.cid || '')
  for (const post of posts) {
    let comments = []
    try {
      comments = await fetchComments(post.mid || post.id, config, 50)
    } catch (error) {
      result.errors += 1
      debugLog(state, config, {
        kind: 'nested-fetch',
        post: post.id,
        reason: error?.message || String(error),
      })
      continue
    }

    const botCids = new Set()
    const knownCid = String(state.postSeen?.[post.id]?.commentId || '')
    if (knownCid) botCids.add(knownCid)
    if (targetCid) botCids.add(targetCid)
    for (const comment of comments) {
      if (String(comment.author?.uid || '') === loginUid) botCids.add(comment.cid)
    }
    if (!botCids.size) continue

    const children = []
    for (const cid of botCids) {
      try {
        children.push(...(await fetchChildComments(cid, config, 50)))
      } catch (error) {
        debugLog(state, config, {
          kind: 'nested-child-fetch',
          post: post.id,
          comment: cid,
          reason: error?.message || String(error),
        })
      }
    }

    const pool = [...comments, ...children]
    const thread = new Set(botCids)
    let changed = true
    while (changed) {
      changed = false
      for (const comment of pool) {
        if (!comment.cid || thread.has(comment.cid)) continue
        if (thread.has(String(comment.rootid)) || thread.has(String(comment.replyid))) {
          thread.add(comment.cid)
          changed = true
        }
      }
    }

    const candidates = Array.from(
      new Map(
        pool
          .filter(
            (comment) =>
              comment.cid &&
              thread.has(comment.cid) &&
              !botCids.has(comment.cid) &&
              String(comment.author?.uid || '') !== loginUid &&
              !state.commentSeen?.[comment.cid],
          )
          .map((comment) => [comment.cid, comment]),
      ).values(),
    )
    for (const comment of candidates.slice(0, 2)) {
      result.checked += 1
      if (dryRun) {
        const entry = {
          at: Date.now(),
          kind: 'weibo-nested-check',
          postId: post.id,
          title: firstLine(post.text, 80),
          url: post.url,
          author: comment.author.name,
          action: 'pending-reply',
          text: firstLine(comment.text, 160),
          commentId: comment.cid,
          createdAt: comment.createdAt,
        }
        result.items.push(entry)
        continue
      }
      try {
        const decision = await judgePost(config, {
          summary: postSummary(post),
          comments: [],
          commentsText: '',
          targetComment: comment,
          memoryContext,
          mayComment: true,
          mayReply: true,
          forceComment: false,
        })
        if (decision.action !== 'comment' || !decision.comment) {
          result.skipped += 1
          state.commentSeen = state.commentSeen || {}
          state.commentSeen[comment.cid] = { status: 'skipped', at: Date.now() }
          continue
        }
        const published = await postComment({
          mid: post.mid || post.id,
          cid: comment.cid,
          text: decision.comment,
          config,
        })
        state.commentSeen = state.commentSeen || {}
        state.commentSeen[comment.cid] = { status: 'replied', at: Date.now() }
        const memory = await rememberReply(ctx, config, state, post, comment, decision.comment)
        const entry = {
          at: Date.now(),
          kind: 'weibo-reply',
          postId: post.id,
          title: firstLine(post.text, 80),
          url: post.url,
          author: comment.author.name,
          action: 'reply',
          comment: decision.comment,
          commentId: published.cid,
          memory: memory.ok ? 'written' : memory.reason,
        }
        pushHistory(state, entry)
        result.items.push(entry)
        result.replied += 1
        bumpComments(state)
        log(`[foxy-weibo] 回复楼中楼 ${comment.cid}：${firstLine(decision.comment, 80)}`)
        return result
      } catch (error) {
        result.errors += 1
        debugLog(state, config, {
          kind: 'nested-reply',
          post: post.id,
          comment: comment.cid,
          reason: error?.message || String(error),
        })
      }
    }
  }
  return result
}

async function scanTargetPosts(ctx, config, state, log, force = false, options = {}) {
  if (!config.enabled && !force) return { skipped: 'disabled' }
  const previewOnly = options.previewOnly === true
  const checkOnly = options.checkOnly === true
  const readOnly = options.readOnly === true
  const forceReply = options.forceReply === true
  const targetCid = String(options.cid || '')
  const canComment = !previewOnly && !checkOnly && !readOnly && (forceReply || config.replyMode === 'auto')
  const targetUid = String(config.targetUid || '').trim()
  const result = {
    mode: options.mode || 'target-posts',
    posts: 0,
    checked: 0,
    commented: 0,
    replied: 0,
    previewed: 0,
    skipped: 0,
    errors: 0,
    memories: 0,
    pendingReplies: 0,
    items: [],
  }
  if (!targetUid) return { ...result, skipped: 'no-target' }
  if (!config.cookie) return { ...result, errors: 1, error: '请先扫码登录微博账号' }
  const account = await fetchAccount(config.cookie)
  if (!account.uid) return { ...result, errors: 1, error: '微博登录态无效，请重新扫码登录后再检查' }
  const loginUid = String(config.accountUid || account.uid || '')
  const maxPosts = Math.max(1, Math.min(100, Number(options.maxPosts ?? config.maxPostsPerRun) || 5))
  const cutoff = config.replyAfter ? Date.parse(config.replyAfter) : 0
  const maxComments = Math.max(
    1,
    Math.min(10, Number(options.maxComments ?? config.maxCommentsPerDay) || 1),
  )
  let posts = []
  try {
    posts = await fetchTimeline(targetUid, config, {
      maxPosts,
      maxPages: Math.ceil(maxPosts / 10) + 1,
    })
    result.posts = posts.length
  } catch (error) {
    return { ...result, errors: 1, error: error?.message || String(error) }
  }
  debugLog(state, config, {
    kind: 'timeline',
    targetUid,
    posts: posts.length,
    replyAfter: config.replyAfter || '',
  })

  let memoryContext = ''
  if (!readOnly) {
    try {
      const provider = typeof ctx.get === 'function' ? ctx.get('foxyMemory') : undefined
      if (provider?.context) {
        memoryContext = String(
          (await provider.context({ presetId: config.memoryPresetId, limit: 8 })) || '',
        ).slice(0, 3000)
      }
    } catch (error) {
      debugLog(state, config, {
        kind: 'memory-context',
        reason: error?.message || String(error),
      })
    }
  }

  if (checkOnly) {
    result.items = posts.slice(0, 30).map((post) => ({
      postId: post.id,
      title: firstLine(post.text, 80),
      url: post.url,
      createdAt: post.createdAt || '',
      createdAtMs: post.createdAtMs || 0,
      seen: Boolean(state.postSeen?.[post.id]),
      belowCutoff: Boolean(cutoff && post.createdAtMs && post.createdAtMs < cutoff),
    }))
    if (config.replyNested) {
      const nested = await scanNestedReplies(ctx, config, state, log, posts, loginUid, memoryContext, {
        dryRun: true,
      })
      result.items.push(...nested.items)
      result.checked += nested.checked
      result.pendingReplies = nested.items.filter((item) => item.action === 'pending-reply').length
      result.errors += nested.errors
    }
    state.lastRun = Date.now()
    state.lastResult = result
    return result
  }

  for (const post of posts) {
    if (!post.id) continue
    if (readOnly) {
      if (state.postMemory?.[post.id]) continue
      const memory = await rememberPost(ctx, config, state, post)
      if (memory.ok) result.memories += 1
      result.checked += 1
      const entry = {
        at: Date.now(),
        kind: 'weibo-post',
        postId: post.id,
        title: firstLine(post.text, 80),
        url: post.url,
        action: 'read',
        memory: memory.ok ? 'written' : memory.reason,
      }
      pushHistory(state, entry)
      result.items.push(entry)
      continue
    }
    if (state.postSeen?.[post.id]) continue
    if (cutoff && post.createdAtMs && post.createdAtMs < cutoff) continue
    if (canComment && Number(post.commentsCount || 0) > 0) {
      let existing = []
      try {
        existing = await fetchComments(post.mid || post.id, config, 50)
      } catch (error) {
        debugLog(state, config, {
          kind: 'existing-comments',
          post: post.id,
          reason: error?.message || String(error),
        })
      }
      const own = existing.find(
        (comment) => String(comment.author?.uid || '') === loginUid,
      )
      if (own) {
        state.postSeen = state.postSeen || {}
        state.postSeen[post.id] = {
          status: 'commented',
          at: Date.now(),
          commentId: own.cid,
        }
        result.skipped += 1
        debugLog(state, config, {
          kind: 'existing-own-comment',
          post: post.id,
          comment: own.cid,
        })
        continue
      }
    }
    const memory = await rememberPost(ctx, config, state, post)
    if (memory.ok) result.memories += 1
    if (!canComment && config.replyMode === 'off' && !previewOnly) {
      // Still preview in check mode; normal runs with reply off only learn.
    }
    if (canComment && commentCount(state) >= maxComments) {
      result.skipped += 1
      debugLog(state, config, {
        kind: 'quota',
        post: post.id,
        message: '每日评论额度已用完',
      })
      continue
    }
    result.checked += 1
    let entry
    try {
      const decision = await judgePost(config, {
        summary: postSummary(post),
        comments: [],
        commentsText: '',
        targetPost: post,
        memoryContext,
        mayComment: true,
        mayReply: false,
        forceComment: forceReply,
      })
      const comment = String(decision.comment || '').trim()
      if (decision.action === 'comment' && comment && canComment) {
        const published = await postComment({ mid: post.mid || post.id, text: comment, config })
        result.commented += 1
        bumpComments(state)
        state.postSeen[post.id] = { status: 'commented', at: Date.now(), commentId: published.cid }
        entry = {
          at: Date.now(),
          kind: 'weibo-post',
          postId: post.id,
          title: firstLine(post.text, 80),
          url: post.url,
          author: post.author.name,
          action: 'comment',
          comment,
          commentId: published.cid,
          memory: memory.ok ? 'written' : memory.reason,
        }
        ctx.logger?.info?.(`[foxy-weibo] 评论博文 ${post.id}：${firstLine(comment, 80)}`)
      } else if (decision.action === 'comment' && comment) {
        result.previewed += 1
        entry = {
          at: Date.now(),
          kind: 'weibo-post',
          postId: post.id,
          title: firstLine(post.text, 80),
          url: post.url,
          author: post.author.name,
          action: 'preview',
          comment,
          memory: memory.ok ? 'written' : memory.reason,
        }
      } else {
        result.skipped += 1
        state.postSeen[post.id] = { status: 'skipped', at: Date.now() }
        entry = {
          at: Date.now(),
          kind: 'weibo-post',
          postId: post.id,
          title: firstLine(post.text, 80),
          url: post.url,
          author: post.author.name,
          action: 'skip',
          reason: entryReason(decision),
          memory: memory.ok ? 'written' : memory.reason,
        }
      }
      debugLog(state, config, {
        kind: 'target-judge',
        post: post.id,
        action: decision.action,
        memory: memory.ok ? 'written' : memory.reason,
        raw: String(decision.raw || '').slice(0, 500),
      })
    } catch (error) {
      result.errors += 1
      entry = {
        at: Date.now(),
        kind: 'weibo-post',
        postId: post.id,
        title: firstLine(post.text, 80),
        action: 'error',
        error: error?.message || String(error),
      }
    }
    if (entry) {
      pushHistory(state, entry)
      result.items.push(entry)
      log(
        `[foxy-weibo] 博文 ${entry.postId} 《${entry.title}》 -> ${ACTION_LABELS[entry.action] || entry.action}` +
          (entry.error ? `（${firstLine(entry.error, 100)}）` : ''),
      )
    }
    if (result.commented >= maxComments) break
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
  if (!checkOnly && !readOnly && canComment) {
    const nested = await scanNestedReplies(ctx, config, state, log, posts, loginUid, memoryContext, {
      cid: targetCid,
    })
    result.replied = nested.replied
    result.items.push(...nested.items)
    result.checked += nested.checked
    result.skipped += nested.skipped
    result.errors += nested.errors
    result.pendingReplies = nested.items.filter((item) => item.action === 'pending-reply').length
  }
  state.lastRun = Date.now()
  state.lastResult = result
  return result
}

function parseDateOnly(text) {
  const value = String(text || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00+08:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function dateKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function rangeForExtract(config) {
  const now = new Date()
  const customStart = parseDateOnly(config.extractStart)
  const customEnd = parseDateOnly(config.extractEnd)
  if (customStart || customEnd) {
    const start = customStart || new Date(now.getTime() - 30 * 86400000)
    const end = customEnd || now
    return { start, end, startText: dateKey(start), endText: dateKey(end) }
  }
  const unit = ['day', 'week', 'month', 'year'].includes(config.extractUnit) ? config.extractUnit : 'month'
  const count = Math.max(1, Math.min(365, Number(config.extractCount) || 1))
  const start = new Date(now)
  if (unit === 'day') start.setDate(start.getDate() - count)
  else if (unit === 'week') start.setDate(start.getDate() - count * 7)
  else if (unit === 'year') start.setFullYear(start.getFullYear() - count)
  else start.setMonth(start.getMonth() - count)
  return { start, end: now, startText: dateKey(start), endText: dateKey(end) }
}

async function extractMemories(ctx, config, state, log, force = false) {
  const provider = memoryProvider(ctx)
  if (!provider?.record) return { errors: 1, error: '记忆服务未就绪' }
  const range = rangeForExtract(config)
  if (range.start > range.end) return { errors: 1, error: '开始日期不能晚于结束日期' }
  const key = `${range.startText}:${range.endText}`
  if (!force && state.digests?.[key]?.status === 'done') {
    return { skipped: 'already', key, ...state.digests[key] }
  }
  const posts = await fetchTimeline(config.targetUid, config, { maxPosts: 300, maxPages: 30 })
  const startMs = range.start.getTime()
  const endMs = range.end.getTime() + 86400000 - 1
  const selected = posts.filter((post) => {
    const at = Number(post.createdAtMs) || new Date(post.createdAt).getTime()
    return Number.isFinite(at) && at >= startMs && at <= endMs
  })
  if (!selected.length) {
    state.digests = state.digests || {}
    state.digests[key] = { status: 'empty', at: Date.now(), posts: 0, events: 0 }
    return { key, posts: 0, events: 0, skipped: 'empty', summary: '' }
  }
  const chunks = []
  for (let i = 0; i < selected.length; i += 20) chunks.push(selected.slice(i, i + 20))
  const summaries = []
  const events = []
  for (const chunk of chunks) {
    const result = await summarizeRange(config, chunk, range)
    if (result.summary) summaries.push(result.summary)
    events.push(...result.events)
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  const summary = summaries.join('\n').slice(0, 1600)
  const topEvents = events.sort((a, b) => b.importance - a.importance).slice(0, 5)
  if (!summary && !topEvents.length) {
    state.digests = state.digests || {}
    state.digests[key] = { status: 'empty', at: Date.now(), posts: selected.length, events: 0 }
    return { key, posts: selected.length, events: 0, skipped: 'empty' }
  }
  const sessionId = `weibo-digest:${key}`
  const targetLabel = selected[0]?.author?.name || '目标账号'
  const digestText = `我在微博回顾了 ${range.startText} 至 ${range.endText} 的博文：${summary}`
  await provider.record({
    role: 'assistant',
    text: digestText,
    sessionId,
    presetId: config.memoryPresetId || 'foxy3（Character）',
    platform: 'weibo',
    speakerKey: config.targetUid ? `weibo:${config.targetUid}` : undefined,
    speakerLabel: config.accountName || '目标账号',
    sourceLabel: '微博阶段回顾',
    eventType: 'weibo_digest',
    channelType: 'weibo_digest',
    channelId: `weibo-digest:${key}`,
    title: `${range.startText} 至 ${range.endText}`,
    scene: 'weibo',
  })
  let writtenEvents = 0
  for (const [index, event] of topEvents.entries()) {
    try {
      await provider.record({
        role: 'assistant',
        text: `${range.startText} 至 ${range.endText} 的微博重要事件（${event.date || '未知日期'}）：${event.title}${event.details ? `。${event.details}` : ''}`,
        sessionId: `weibo-event:${key}:${index}`,
        presetId: config.memoryPresetId || 'foxy3（Character）',
        platform: 'weibo',
        speakerKey: config.targetUid ? `weibo:${config.targetUid}` : undefined,
        speakerLabel: config.accountName || '目标账号',
        sourceLabel: '微博重要事件',
        eventType: 'weibo_event',
        channelType: 'weibo_event',
        channelId: `weibo-event:${key}:${index}`,
        title: `${event.title}`.slice(0, 120),
        scene: 'weibo',
      })
      writtenEvents += 1
    } catch (error) {
      log(`[foxy-weibo] 事件记忆写入失败：${error?.message || error}`)
    }
  }
  state.digests = state.digests || {}
  state.digests[key] = {
    status: 'done',
    at: Date.now(),
    posts: selected.length,
    events: writtenEvents,
    summary: summary.slice(0, 300),
    start: range.startText,
    end: range.endText,
  }
  const entry = {
    at: Date.now(),
    kind: 'weibo-digest',
    action: 'extract',
    start: range.startText,
    end: range.endText,
    posts: selected.length,
    events: writtenEvents,
    summary: summary.slice(0, 300),
  }
  pushHistory(state, entry)
  debugLog(state, config, { kind: 'extract', ...entry })
  return entry
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

export { scanNestedReplies }

export function apply(ctx, rawConfig = {}) {
  const config = loadSettings({ ...DEFAULTS, ...rawConfig })
  const log = (message) => ctx.logger?.info?.(message)
  const state = loadState()
  let running = false
  let timer
  let startTimer

  const beginRun = () => {
    if (running) return false
    if (!acquireStateLock()) return false
    running = true
    Object.assign(state, loadState())
    return true
  }

  const endRun = () => {
    try {
      saveState(state)
    } finally {
      running = false
      releaseStateLock()
    }
  }

  const run = async (reason = 'timer', force = false) => {
    if (!beginRun()) return { skipped: 'busy' }
    try {
      log(`[foxy-weibo] 开始运行（${reason}）`)
      const result = await scanTargetPosts(ctx, config, state, log, force)
      log(`[foxy-weibo] 运行结束 ${JSON.stringify(result)}`)
      return result
    } catch (error) {
      ctx.logger?.warn?.(`[foxy-weibo] scan failed: ${error?.message || error}`)
      return { error: String(error?.message || error) }
    } finally {
      endRun()
    }
  }

  const checkNow = async () => {
    if (!beginRun()) return { skipped: 'busy' }
    try {
      log('[foxy-weibo] 开始立即检查')
      const result = await scanTargetPosts(ctx, config, state, log, true, {
        checkOnly: true,
        mode: 'target-posts-check',
      })
      log(`[foxy-weibo] 立即检查结束 ${JSON.stringify(result)}`)
      return result
    } catch (error) {
      ctx.logger?.warn?.(`[foxy-weibo] check failed: ${error?.message || error}`)
      return { error: String(error?.message || error) }
    } finally {
      endRun()
    }
  }

  const readNow = async () => {
    if (!beginRun()) return { skipped: 'busy' }
    try {
      log('[foxy-weibo] 开始立即读取')
      const result = await scanTargetPosts(ctx, config, state, log, true, {
        readOnly: true,
        maxPosts: Math.max(1, Math.min(100, Number(config.maxPostsPerRun) || 5)),
        mode: 'target-posts-read',
      })
      log(`[foxy-weibo] 立即读取结束 ${JSON.stringify(result)}`)
      return result
    } catch (error) {
      ctx.logger?.warn?.(`[foxy-weibo] read failed: ${error?.message || error}`)
      return { error: String(error?.message || error) }
    } finally {
      endRun()
    }
  }

  const replyNow = async (cid = '') => {
    if (!beginRun()) return { skipped: 'busy' }
    try {
      log(`[foxy-weibo] 开始立即回复${cid ? ` cid=${cid}` : ''}`)
      const result = await scanTargetPosts(ctx, config, state, log, true, {
        forceReply: true,
        maxPosts: Math.max(1, Math.min(100, Number(config.maxPostsPerRun) || 5)),
        maxComments: 1,
        cid,
        mode: 'target-posts-reply-now',
      })
      log(`[foxy-weibo] 立即回复结束 ${JSON.stringify(result)}`)
      return result
    } catch (error) {
      ctx.logger?.warn?.(`[foxy-weibo] reply-now failed: ${error?.message || error}`)
      return { error: String(error?.message || error) }
    } finally {
      endRun()
    }
  }

  const status = () => ({
    enabled: config.enabled === true,
    running,
    mode: 'target-posts',
    targetUid: config.targetUid || '',
    loginUid: config.accountUid || '',
    scheduleTimes: config.scheduleTimes,
    nextRunAt,
    replyMode: config.replyMode,
    lastRun: state.lastRun,
    lastResult: state.lastResult,
    recent: state.history.slice(0, 12),
    debugEnabled: config.debug === true,
    debug: state.debug.slice(0, 40),
    seen: Object.keys(state.seen).length,
    commentsToday: commentCount(state),
    cookieSet: Boolean(config.cookie),
    accountName: config.accountName || '',
    accountUid: config.accountUid || '',
    apiKeySet: Boolean(config.llmApiKey),
    postsSeen: Object.keys(state.postSeen || {}).length,
  })

  const capability = { version: 1, scan: () => run('manual', true), status }
  const foxy = typeof ctx.get === 'function' ? ctx.get('foxy') : undefined
  foxy?.registerCapability?.('weibo', async () => capability)
  ctx.provide?.('foxyWeibo', capability)

  let nextRunAt = 0
  const nextDelay = () => {
    const times = Array.isArray(config.scheduleTimes) ? config.scheduleTimes : []
    if (!times.length) return 60 * 60 * 1000
    const now = new Date()
    let best = Infinity
    for (const text of times) {
      const [hour, minute] = String(text).split(':').map(Number)
      if (!Number.isInteger(hour) || !Number.isInteger(minute)) continue
      for (let day = 0; day <= 1; day += 1) {
        const at = new Date(now)
        at.setDate(now.getDate() + day)
        at.setHours(hour, minute, 0, 0)
        const delay = at.getTime() - now.getTime()
        if (delay > 0 && delay < best) best = delay
      }
    }
    return Number.isFinite(best) ? best : 60 * 60 * 1000
  }
  const restartTimer = () => {
    clearTimeout(timer)
    const delay = nextDelay()
    nextRunAt = Date.now() + delay
    timer = setTimeout(async () => {
      await run('schedule').catch(() => {})
      restartTimer()
    }, delay)
    timer.unref?.()
  }
  restartTimer()
  ctx.effect?.(() => () => clearTimeout(timer), 'foxy-weibo: scan timer')

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
    route(LOGIN_START_ROUTE, ['POST'], async () => json({ ok: true, ...(await loginStart()) }))

    route(LOGIN_POLL_ROUTE, ['POST'], async (request) => {
      const { qrid } = await readJsonBody(request)
      const result = await loginPoll(qrid)
      if (result.state === 'ok' && result.cookie) {
        config.cookie = result.cookie
        config.accountName = result.account?.screenName || ''
        config.accountUid = result.account?.uid || ''
        saveSettings(config)
      }
      return json({ ok: true, ...result, settings: publicSettings(config), status: status() })
    })

    route(LOGOUT_ROUTE, ['POST'], async () => {
      config.cookie = ''
      config.accountName = ''
      config.accountUid = ''
      saveSettings(config)
      return json({ ok: true, settings: publicSettings(config), status: status() })
    })

    route(RUN_ROUTE, ['POST'], async () => {
      const result = await run('manual', true)
      return json({ ok: true, result, status: status() })
    })

    route(CHECK_NOW_ROUTE, ['POST'], async () => {
      const result = await checkNow()
      return json({ ok: true, result, status: status() })
    })

    route(READ_NOW_ROUTE, ['POST'], async () => {
      const result = await readNow()
      return json({ ok: true, result, status: status() })
    })

    route(REPLY_NOW_ROUTE, ['POST'], async (request) => {
      const body = await readJsonBody(request)
      const result = await replyNow(body?.cid)
      return json({ ok: true, result, status: status() })
    })
  })

  log(
    `[foxy-weibo] ready enabled=${config.enabled} target=${config.targetUid || 'unset'} ` +
      `times=${config.scheduleTimes.join(',')} reply=${config.replyMode}`,
  )
}






