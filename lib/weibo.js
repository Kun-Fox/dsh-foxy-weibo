/**
 * Minimal Weibo web client used by the Foxy Weibo transport.
 *
 * Read endpoints use the public m.weibo.cn container API. Writing comments
 * needs a logged-in weibo.com cookie (SUB/SUBP plus XSRF-TOKEN).
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'

export class WeiboError extends Error {
  constructor(message, code = 'WEIBO_ERROR', detail = '') {
    super(message)
    this.name = 'WeiboError'
    this.code = code
    this.detail = detail
  }
}

export function parseCookie(cookie) {
  const out = {}
  for (const part of String(cookie || '').split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key) out[key] = value
  }
  return out
}

function cookieHeader(config) {
  return String(config.cookie || '').trim()
}

function xsrfToken(config) {
  const cookies = parseCookie(config.cookie)
  const raw = cookies['XSRF-TOKEN'] || cookies['_xsrf'] || ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function headersFor(config, mobile = false) {
  const headers = {
    accept: 'application/json, text/plain, */*',
    'user-agent': mobile ? MOBILE_UA : UA,
    referer: mobile ? 'https://m.weibo.cn/' : 'https://weibo.com/',
  }
  if (config.cookie) headers.cookie = cookieHeader(config)
  return headers
}

async function readJson(response) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new WeiboError(`微博返回了非 JSON 内容（HTTP ${response.status}）`, 'BAD_JSON', text.slice(0, 200))
  }
}

export function parseWeiboTime(value, now = Date.now()) {
  const text = String(value || '').trim()
  if (!text) return 0
  const current = new Date(now)
  const at = (year, month, day, hour = 0, minute = 0) =>
    new Date(year, month - 1, day, hour, minute).getTime()
  let match = text.match(/^(\d+)\s*秒前/)
  if (match) return now - Number(match[1]) * 1000
  match = text.match(/^(\d+)\s*分钟前/)
  if (match) return now - Number(match[1]) * 60_000
  match = text.match(/^(\d+)\s*小时前/)
  if (match) return now - Number(match[1]) * 3_600_000
  if (/^刚刚/.test(text)) return now
  match = text.match(/^今天\s*(\d{1,2}):(\d{2})/)
  if (match) return at(current.getFullYear(), current.getMonth() + 1, current.getDate(), Number(match[1]), Number(match[2]))
  match = text.match(/^昨天\s*(\d{1,2}):(\d{2})/)
  if (match) {
    const day = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1)
    return at(day.getFullYear(), day.getMonth() + 1, day.getDate(), Number(match[1]), Number(match[2]))
  }
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (match) return at(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] || 0), Number(match[5] || 0))
  match = text.match(/^(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (match) return at(current.getFullYear(), Number(match[1]), Number(match[2]), Number(match[3] || 0), Number(match[4] || 0))
  match = text.match(/^(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2}))?/)
  if (match) return at(current.getFullYear(), Number(match[1]), Number(match[2]), Number(match[3] || 0), Number(match[4] || 0))
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizePost(raw) {
  const mblog = raw?.mblog || raw || {}
  const mid = String(mblog.mid || mblog.id || mblog.mblogid || '')
  const id = String(mblog.mblogid || mid)
  const createdAt = String(mblog.created_at || '')
  return {
    id,
    mid,
    url: `https://m.weibo.cn/detail/${id || mid}`,
    text: stripHtml(mblog.text || mblog.longText?.longTextContent || ''),
    author: {
      uid: String(mblog.user?.id || mblog.user?.idstr || ''),
      name: String(mblog.user?.screen_name || ''),
    },
    createdAt,
    createdAtMs: parseWeiboTime(createdAt),
    commentsCount: Number(mblog.comments_count || 0),
    attitudesCount: Number(mblog.attitudes_count || 0),
    repostsCount: Number(mblog.reposts_count || 0),
    pics: Array.isArray(mblog.pics) ? mblog.pics.map((pic) => pic?.large?.url || pic?.url || '').filter(Boolean) : [],
  }
}

async function fetchWebTimeline(uid, config = {}, page = 1) {
  const target = String(uid || '').trim()
  const url =
    `https://weibo.com/ajax/statuses/mymblog?uid=${encodeURIComponent(target)}` +
    `&page=${Math.max(1, page)}&feature=0`
  const response = await fetch(url, { headers: headersFor(config, false) })
  if (!response.ok) throw new WeiboError(`读取微博失败：HTTP ${response.status}`, 'HTTP')
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new WeiboError(
      '微博返回了访客/登录页面，请填写有效的微博 Cookie 后重试',
      'LOGIN_REQUIRED',
      text.slice(0, 200),
    )
  }
  const list = Array.isArray(json?.data?.list) ? json.data.list : []
  return list.map(normalizePost).filter((post) => post.id && post.text)
}

function uniquePosts(posts) {
  const seen = new Set()
  const out = []
  for (const post of posts) {
    const key = post.id || post.mid
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(post)
  }
  return out
}

export async function fetchTimeline(uid, config = {}, options = {}) {
  const target = String(uid || '').trim()
  if (!/^\d{5,20}$/.test(target)) throw new WeiboError('微博 UID 格式不正确', 'BAD_UID')
  const maxPosts = Math.max(1, Math.min(3000, Number(options.maxPosts) || 20))
  const maxPages = Math.max(1, Math.min(150, Number(options.maxPages) || Math.ceil(maxPosts / 10) + 1))
  const collected = []

  for (let page = 1; page <= maxPages && collected.length < maxPosts; page += 1) {
    const url =
      `https://m.weibo.cn/api/container/getIndex?type=uid&value=${encodeURIComponent(target)}` +
      `&containerid=107603${encodeURIComponent(target)}&page=${page}`
    try {
      const response = await fetch(url, { headers: headersFor(config, true) })
      if (!response.ok) throw new WeiboError(`读取微博失败：HTTP ${response.status}`, 'HTTP')
      const json = await readJson(response)
      const cards = Array.isArray(json?.data?.cards) ? json.data.cards : []
      const posts = uniquePosts(
        cards
          .filter((card) => card?.mblog)
          .map((card) => normalizePost(card.mblog))
          .filter((post) => post.id && post.text),
      )
      if (!posts.length) break
      collected.push(...posts)
      if (posts.length < 10) break
    } catch (error) {
      if (config.cookie) {
        try {
          const posts = uniquePosts(await fetchWebTimeline(target, config, page))
          if (!posts.length) break
          collected.push(...posts)
          if (posts.length < 10) break
          continue
        } catch (webError) {
          if (collected.length) break
          throw new WeiboError(
            `${error.message}；备用接口也失败：${webError.message}`,
            'FETCH_FAILED',
            webError.detail,
          )
        }
      }
      if (collected.length) break
      throw new WeiboError(
        `${error.message}；微博接口可能要求登录 Cookie（设置 → Foxy-weibo → 微博 Cookie）`,
        'LOGIN_REQUIRED',
        error.detail,
      )
    }
  }

  return uniquePosts(collected).slice(0, maxPosts)
}

function normalizeComment(raw) {
  return {
    cid: String(raw?.id || raw?.cid || ''),
    rootid: String(raw?.rootid || raw?.root_id || ''),
    replyid: String(raw?.replyid || raw?.reply_id || ''),
    text: stripHtml(raw?.text || ''),
    author: {
      uid: String(raw?.user?.id || raw?.user?.idstr || ''),
      name: String(raw?.user?.screen_name || ''),
    },
    createdAt: String(raw?.created_at || ''),
    likeCount: Number(raw?.like_count || 0),
  }
}

function childCommentRows(raw) {
  const value = raw?.comments
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.data)) return value.data
  if (Array.isArray(value?.comments)) return value.comments
  return []
}

function flattenCommentRows(rows, parent = null, output = [], limit = 50) {
  for (const raw of Array.isArray(rows) ? rows : []) {
    if (output.length >= limit) break
    const item = normalizeComment(raw)
    if (item.cid && item.text) {
      if (parent) {
        if (!item.rootid) item.rootid = parent.rootid || parent.cid
        if (!item.replyid) item.replyid = parent.cid
      }
      output.push(item)
    }
    const children = childCommentRows(raw)
    if (children.length) {
      flattenCommentRows(children, item, output, limit)
    }
  }
  return output
}

export async function fetchChildComments(cid, config = {}, limit = 50) {
  const id = String(cid || '').trim()
  if (!id) return []
  const count = Math.max(1, Math.min(50, Number(limit) || 50))
  const url =
    `https://weibo.com/ajax/statuses/buildComments?flow=2&is_reload=1&id=${encodeURIComponent(id)}` +
    `&is_show_bulletin=2&count=${count}&fetch_level=1&locale=zh-CN`
  const response = await fetch(url, { headers: headersFor(config, false) })
  if (!response.ok) throw new WeiboError(`读取楼中楼失败：HTTP ${response.status}`, 'HTTP')
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new WeiboError('楼中楼返回了访客/登录页面，请填写有效 Cookie', 'LOGIN_REQUIRED')
  }
  const rows = Array.isArray(json?.data) ? json.data : []
  return flattenCommentRows(rows, null, [], count)
}

async function fetchWebComments(mid, config = {}, limit = 20) {
  const id = String(mid || '').trim()
  const url =
    `https://weibo.com/ajax/statuses/buildComments?flow=0&is_reload=1&id=${encodeURIComponent(id)}` +
    `&is_show_bulletin=2&count=${Math.max(1, Math.min(50, limit))}`
  const response = await fetch(url, { headers: headersFor(config, false) })
  if (!response.ok) throw new WeiboError(`读取微博评论失败：HTTP ${response.status}`, 'HTTP')
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new WeiboError('微博评论返回了访客/登录页面，请填写有效 Cookie', 'LOGIN_REQUIRED')
  }
  const rows = Array.isArray(json?.data) ? json.data : []
  return flattenCommentRows(rows, null, [], limit)
}

export async function fetchComments(mid, config = {}, limit = 20) {
  const id = String(mid || '').trim()
  if (!id) return []
  const url =
    `https://m.weibo.cn/comments/hotflow?id=${encodeURIComponent(id)}` +
    `&mid=${encodeURIComponent(id)}&max_id_type=0`
  try {
    const response = await fetch(url, { headers: headersFor(config, true) })
    if (!response.ok) throw new WeiboError(`读取微博评论失败：HTTP ${response.status}`, 'HTTP')
    const json = await readJson(response)
    const rows = Array.isArray(json?.data?.data) ? json.data.data : []
    return flattenCommentRows(rows, null, [], limit)
  } catch (error) {
    if (config.cookie) {
      try {
        return await fetchWebComments(id, config, limit)
      } catch (webError) {
        throw new WeiboError(
          `${error.message}；备用接口也失败：${webError.message}`,
          'FETCH_FAILED',
          webError.detail,
        )
      }
    }
    throw error
  }
}

export async function postComment({ mid, text, cid, config = {} }) {
  if (!config.cookie) throw new WeiboError('请先填写微博登录 Cookie', 'NO_LOGIN')
  const id = String(mid || '').trim()
  const message = String(text || '').trim()
  if (!id || !message) throw new WeiboError('微博评论参数不完整', 'BAD_COMMENT')
  const token = xsrfToken(config)
  if (!token) throw new WeiboError('Cookie 里缺少 XSRF-TOKEN，无法发布评论', 'NO_XSRF')
  const body = new URLSearchParams({
    id,
    comment: message.slice(0, 1000),
    pic_id: '',
    is_repost: '0',
    comment_ori: '0',
    ...(cid ? { cid: String(cid), without_mention: '1' } : {}),
    csrf_token: token,
  })
  const endpoint = new URL(
    cid ? 'https://weibo.com/ajax/comments/reply' : 'https://weibo.com/ajax/comments/create',
  )
  endpoint.searchParams.set('is_repost', '0')
  if (cid) endpoint.searchParams.set('cid', String(cid))
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...headersFor(config, false),
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-xsrf-token': token,
      'x-requested-with': 'XMLHttpRequest',
    },
    body,
  })
  const json = await readJson(response)
  const ok = json?.ok === 1 || json?.code === 100000
  if (!ok) {
    const detail = json?.message || json?.msg || json?.data?.message || JSON.stringify(json).slice(0, 300)
    throw new WeiboError(`微博评论发布失败：${detail}`, 'POST_FAILED', detail)
  }
  return {
    cid: String(json?.data?.id || json?.data?.cid || ''),
    raw: json,
    replyTo: cid ? String(cid) : '',
  }
}

export function postSummary(post) {
  const lines = [
    `博主：${post.author.name || post.author.uid}`,
    `时间：${post.createdAt}`,
    `正文：${post.text}`,
    `互动：${post.repostsCount} 转发 / ${post.commentsCount} 评论 / ${post.attitudesCount} 赞`,
    `链接：${post.url}`,
  ]
  return lines.join('\n')
}
