import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const FALLBACK_PERSONA =
  '你是 Foxy，一只有点懒、嘴硬心软、会自己刷微博的小狐狸。你说中文，第一人称，别像客服。'

function expand(value) {
  if (!value) return ''
  return resolve(String(value).replace(/^~(?=$|[\\/])/, homedir()))
}

function topLevelBlock(text, key) {
  const lines = String(text || '').split(/\r?\n/)
  const head = new RegExp(`^${key}\\s*:\\s*[|>]?\\s*$`)
  const start = lines.findIndex((line) => head.test(line))
  if (start < 0) return ''
  const out = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^[A-Za-z_][\w-]*\s*:/.test(line)) break
    out.push(line.replace(/^\s{2}/, ''))
  }
  return out.join('\n').trim()
}

export function readFoxyPersona(config = {}) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  for (const candidate of [
    config.presetPath,
    join(home, 'foxy', 'presets', `${config.presetId || 'foxy3'}.yml`),
  ]) {
    const file = expand(candidate)
    if (!file || !existsSync(file)) continue
    try {
      const text = readFileSync(file, 'utf8')
      const persona = topLevelBlock(text, 'persona') || topLevelBlock(text, 'system')
      if (persona) return persona
    } catch {}
  }
  return FALLBACK_PERSONA
}

function firstLine(text, limit = 160) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

function stripCodeFence(text) {
  return String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

function parseJson(text) {
  const raw = stripCodeFence(text)
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

function fallbackComment(text) {
  const raw = stripCodeFence(text)
  if (!raw || /^[{[]/.test(raw)) return ''
  return raw.replace(/^["'“”]+|["'“”]+$/g, '').trim().slice(0, 280)
}

export function chatEndpoint(baseUrl) {
  const base = String(baseUrl || 'https://api.deepseek.com').trim().replace(/\/+$/, '')
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`
}

async function directCompletion(config, persona, prompt) {
  const key = String(config.llmApiKey || '').trim()
  if (!key) throw new Error('直接 API 模式还没有填写 API Key（设置 → Foxy-weibo → AI 模型）')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  try {
    const response = await fetch(chatEndpoint(config.llmBaseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: config.llmModel || 'deepseek-chat',
        messages: [
          { role: 'system', content: persona },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
        max_tokens: 1200,
        stream: false,
      }),
      signal: controller.signal,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = data?.error?.message || JSON.stringify(data).slice(0, 300)
      throw new Error(`模型 API HTTP ${response.status}：${detail}`)
    }
    const text = String(data?.choices?.[0]?.message?.content || '').trim()
    if (!text) throw new Error('模型请求失败或返回为空（API 返回空内容）')
    return text
  } finally {
    clearTimeout(timer)
  }
}

function commentLines(comments, max = 10) {
  return (Array.isArray(comments) ? comments : [])
    .slice(0, max)
    .map((item) => `- cid=${item.cid} ${item.author.name || item.author.uid}：${firstLine(item.text, 180)}`)
}

function finalize(parsed, input, fallbackText) {
  const allowed = new Set(['skip', 'remember', 'comment'])
  let action = allowed.has(parsed.action) ? parsed.action : 'skip'
  let comment = String(parsed.comment || '').trim()
  if (!comment && fallbackText) comment = fallbackComment(fallbackText)
  if (input.forceComment && comment) action = 'comment'
  if (action === 'comment' && !input.mayComment) action = 'remember'
  if (action === 'comment' && !comment) action = 'remember'
  const replyTo = input.mayReply ? String(parsed.replyTo || '0') : '0'
  return {
    action,
    comment: comment.slice(0, 300),
    memory: String(parsed.memory || '').trim().slice(0, 500),
    replyTo: replyTo === '0' ? '' : replyTo,
    mood: String(parsed.mood || '').trim().slice(0, 40),
    raw: fallbackText.slice(0, 1000),
  }
}

export async function judgePost(config, input) {
  const persona = readFoxyPersona(config)
  const prompt = [
    '你正在浏览微博，不是回复 QQ/微信，也不是客服。',
    '下面是一个微博账号的博文与评论。请用 Foxy 的判断，决定：',
    '- skip：广告、无意义、纯转发抽奖、引战、没信息量，跳过；',
    '- remember：有点意思，但不必公开评论，自己记一笔；',
    '- comment：值得在评论区说一句，才评论。',
    input.mayComment ? '本次允许评论。' : '本次不允许评论，只能 skip 或 remember。',
    '',
    '评论要求：像 Foxy 自己刷到后随口说的，中文第一人称，不超过 100 字；不要客服腔，不要复述原文，不要写 @。',
    '记忆要求：如果值得记，用真实事件写第一人称，例如“我在微博看到 xx 说……，觉得……”。不要把所有事件都写成“我刷到”。不超过 180 字。',
    '',
    input.mayReply && input.comments.length
      ? [
          '回复规则：可以回复下面某条评论。replyTo 填要回复的 cid；只发一级评论时填 0。',
          '不要回复自己，不要回复广告/引战/辱骂/诈骗。',
          ...commentLines(input.comments),
        ].join('\n')
      : '本次不回复他人评论；replyTo 必须为 0。',
    '',
    '只输出一个 JSON 对象，不要 Markdown：',
    '{"action":"skip|remember|comment","comment":"...","memory":"...","replyTo":0,"mood":"..."}',
    '',
    '博文信息：',
    input.summary,
    input.commentsText ? `\n评论区：\n${input.commentsText.slice(0, 3000)}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  let text = await directCompletion(config, persona, prompt)
  let parsed = parseJson(text) || {}
  if (input.forceComment && !String(parsed.comment || '').trim()) {
    const retryPrompt = [
      '这次必须给出一条可以直接发布的微博评论。',
      '只输出 JSON：{"action":"comment","comment":"非空的中文评论","memory":"","replyTo":0}',
      '不要解释，不要 Markdown。',
      '',
      prompt,
    ].join('\n')
    text = await directCompletion(config, persona, retryPrompt)
    parsed = parseJson(text) || {}
  }
  return finalize(parsed, input, text)
}
