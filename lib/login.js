/**
 * Weibo QR login.
 *
 * The QR endpoint returns JSONP, and the actual login cookies are spread over
 * several redirects. Keep a tiny cookie jar instead of taking only the last
 * Set-Cookie header.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'

function parseJsonp(text) {
  const raw = String(text || '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('微博登录接口返回格式异常')
  return JSON.parse(raw.slice(start, end + 1))
}

function setCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie()
  }
  const raw = response.headers.get('set-cookie')
  return raw ? [raw] : []
}

class CookieJar {
  constructor(initial = '') {
    this.values = new Map()
    this.add(initial)
  }

  add(raw) {
    for (const part of String(raw || '').split(/;\s*(?=[^;=]+=)/)) {
      const text = part.trim()
      if (!text || text.includes('\n')) {
        for (const line of text.split('\n')) this.addOne(line)
      } else {
        this.addOne(text)
      }
    }
  }

  addOne(raw) {
    const text = String(raw || '').split(';')[0].trim()
    const index = text.indexOf('=')
    if (index <= 0) return
    const key = text.slice(0, index).trim()
    const value = text.slice(index + 1).trim()
    if (key && value) this.values.set(key, value)
  }

  absorb(response) {
    for (const cookie of setCookies(response)) this.addOne(cookie)
  }

  header() {
    return [...this.values.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
  }
}

async function request(url, { jar, mobile = false, ...options } = {}) {
  const headers = {
    accept: 'application/json, text/plain, */*',
    'user-agent': mobile ? MOBILE_UA : UA,
    referer: mobile ? 'https://m.weibo.cn/' : 'https://weibo.com/',
    ...(options.headers || {}),
  }
  if (jar?.header()) headers.cookie = jar.header()
  const response = await fetch(url, { ...options, headers, redirect: 'manual' })
  jar?.absorb(response)
  return response
}

async function follow(response, jar, mobile = false, depth = 0) {
  if (depth > 5) return response
  const location = response.headers.get('location')
  if (!location) return response
  let next
  try {
    next = new URL(location, response.url).toString()
  } catch {
    return response
  }
  const redirected = await request(next, { jar, mobile })
  return follow(redirected, jar, mobile, depth + 1)
}

export async function loginStart() {
  const stamp = Date.now()
  const url =
    `https://login.sina.com.cn/sso/qrcode/image?entry=weibo&size=180&callback=STK_${stamp}`
  const jar = new CookieJar()
  const response = await request(url, { jar })
  if (!response.ok) throw new Error(`获取微博二维码失败：HTTP ${response.status}`)
  const data = parseJsonp(await response.text())
  const row = data?.data || {}
  if (!row.qrid || !row.image) throw new Error(data?.msg || '微博没有返回二维码')
  const image = String(row.image).startsWith('//') ? `https:${row.image}` : String(row.image)
  // Returning a data URL keeps the QR usable even if the DSH page CSP blocks
  // hotlinked images; fall back to the remote URL if the image cannot be read.
  let qr = image
  try {
    const imageResponse = await fetch(image, {
      headers: { 'user-agent': UA, referer: 'https://weibo.com/' },
    })
    if (imageResponse.ok) {
      const type = imageResponse.headers.get('content-type') || 'image/png'
      const bytes = Buffer.from(await imageResponse.arrayBuffer())
      if (bytes.length && type.startsWith('image/')) {
        qr = `data:${type};base64,${bytes.toString('base64')}`
      }
    }
  } catch {
    // remote URL fallback
  }
  return { qrid: String(row.qrid), qr, retcode: data.retcode }
}

export async function loginPoll(qrid) {
  const key = String(qrid || '').trim()
  if (!key) throw new Error('缺少微博二维码 qrid')
  const stamp = Date.now()
  const url =
    `https://login.sina.com.cn/sso/qrcode/check?entry=weibo&qrid=${encodeURIComponent(key)}` +
    `&callback=STK_${stamp}`
  const jar = new CookieJar()
  const response = await request(url, { jar })
  const data = parseJsonp(await response.text())
  const retcode = Number(data.retcode)
  if (retcode === 50114001) return { state: 'waiting', retcode }
  if (retcode === 50114002) return { state: 'scanned', retcode }
  if (retcode === 50114004) return { state: 'expired', retcode }
  const alt = String(data?.data?.alt || data?.data?.url || '').trim()
  if (!alt) return { state: 'waiting', retcode, raw: data }

  const loginUrl =
    `https://login.sina.com.cn/sso/login.php?entry=weibo&returntype=TEXT&crossdomain=1` +
    `&cdult=3&domain=weibo.com&alt=${encodeURIComponent(alt)}&savestate=30`
  let login = await request(loginUrl, { jar })
  login = await follow(login, jar, false)
  await request('https://weibo.com/', { jar })
  const mobile = await request('https://m.weibo.cn/', { jar, mobile: true })
  await follow(mobile, jar, true, 0).catch(() => {})
  const cookie = jar.header()
  if (!cookie.includes('SUB=') && !cookie.includes('SUBP=')) {
    throw new Error('微博登录未返回 SUB/SUBP Cookie，请重试')
  }
  return { state: 'ok', cookie, account: await fetchAccount(cookie) }
}

export async function fetchAccount(cookie) {
  try {
    const response = await fetch('https://m.weibo.cn/api/config', {
      headers: {
        accept: 'application/json, text/plain, */*',
        'user-agent': MOBILE_UA,
        referer: 'https://m.weibo.cn/',
        cookie,
      },
    })
    const data = await response.json()
    return {
      uid: String(data?.data?.uid || ''),
      screenName: String(data?.data?.screen_name || ''),
    }
  } catch {
    return { uid: '', screenName: '' }
  }
}

export function maskCookie(cookie) {
  return String(cookie || '')
    .split(';')
    .map((part) => {
      const index = part.indexOf('=')
      if (index < 0) return part.trim()
      return `${part.slice(0, index).trim()}=***`
    })
    .filter(Boolean)
    .join('; ')
}
