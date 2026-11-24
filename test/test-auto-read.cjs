const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

// 让 readFoxyPersona 读不到真实 preset，避免测试受本机配置影响。
process.env.DSH_HOME = join(tmpdir(), 'foxy-weibo-test-home')
mkdirSync(join(process.env.DSH_HOME, 'foxy-weibo'), { recursive: true })

const memoryText = '{"memory":"我在微博看到 kunfox 说今天有点累"}'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installFetch(routes) {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url)
    calls.push({ url: target, body: options.body ? String(options.body) : '' })
    for (const route of routes) {
      if (target.includes(route.match)) return route.reply(target, options)
    }
    throw new Error(`unexpected fetch: ${target}`)
  }
  return calls
}

function weiboPost(overrides = {}) {
  return {
    mblogid: '5001',
    mid: '5001',
    text: '今天有点累，插件慢慢写',
    created_at: '今天 10:00',
    comments_count: 0,
    user: { id: '6200420068', screen_name: 'kunfox' },
    ...overrides,
  }
}

function card(mblog) {
  return { card_type: 9, mblog }
}

function makeConfig(overrides = {}) {
  return {
    enabled: true,
    cookie: 'SUB=fake',
    accountUid: '',
    targetUid: '6200420068',
    replyMode: 'off',
    replyAfter: '',
    replyNested: false,
    learnPosts: true,
    enableMemory: true,
    maxPostsPerRun: 5,
    maxCommentsPerDay: 1,
    scheduleTimes: ['06:00'],
    memoryPresetId: 'foxy3',
    llmBaseUrl: 'https://api.deepseek.com',
    llmModel: 'deepseek-chat',
    llmApiKey: 'test-key',
    customPrompt: '',
    debug: true,
    ...overrides,
  }
}

function emptyState() {
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
    lastError: '',
    digests: {},
    extracting: false,
    extractProgress: null,
    lastExtract: null,
  }
}

function makeProvider(options = {}) {
  const records = []
  return {
    records,
    record: async (input) => {
      if (options.fail) throw new Error(options.fail)
      records.push(input)
      return { ok: true }
    },
    context: async () => '',
  }
}

function makeCtx(provider) {
  return {
    get: (name) => (name === 'foxyMemory' ? provider : undefined),
    logger: { info: () => {}, warn: () => {} },
  }
}

const noopLog = () => {}

async function main() {
  const { scanTargetPosts } = await import('../lib/index.js')
  const { fetchTimeline } = await import('../lib/weibo.js')

  // 1) 登录态校验接口被打回（fetchAccount 返回空 uid）时，仍然要读取博文并写记忆。
  {
    const calls = installFetch([
      { match: 'm.weibo.cn/api/config', reply: () => jsonResponse({ data: { login: false } }) },
      {
        match: 'm.weibo.cn/api/container/getIndex',
        reply: () => jsonResponse({ ok: 1, data: { cards: [card(weiboPost())] } }),
      },
      { match: 'api.deepseek.com', reply: () => jsonResponse({ choices: [{ message: { content: memoryText } }] }) },
    ])
    const provider = makeProvider()
    const state = emptyState()
    const result = await scanTargetPosts(
      makeCtx(provider),
      makeConfig(),
      state,
      noopLog,
      false,
    )
    assert.equal(result.posts, 1)
    assert.equal(result.memories, 1)
    assert.equal(result.errors, 0)
    assert.equal(result.commented, 0)
    assert.equal(state.postSeen['5001'].status, 'read')
    assert.equal(state.postMemory['5001'] > 0, true)
    assert.equal(state.lastRun > 0, true)
    assert.equal(state.lastError, '')
    assert.equal(provider.records.length, 1)
    assert.equal(provider.records[0].eventType, 'weibo_owner_post')
    assert.equal(provider.records[0].platform, 'weibo')
    assert.equal(provider.records[0].channelId, '5001')
    assert.match(provider.records[0].text, /今天有点累/)
    // 回复关闭时不应该调用评论/回复接口，也不应该跑判断模型（只有一次记忆整理请求）。
    assert.equal(calls.some((call) => /comments\/(create|reply)/.test(call.url)), false)
    assert.equal(calls.filter((call) => call.url.includes('api.deepseek.com')).length, 1)
    assert.equal(state.history[0].action, 'read')
    // 已经记过的博文下一轮不再重复写
    const second = await scanTargetPosts(makeCtx(provider), makeConfig(), state, noopLog, false)
    assert.equal(second.memories, 0)
    assert.equal(provider.records.length, 1)
  }

  // 2) Cookie 失效：不能静默返回“0 条”，要留下 lastError / history / debug。
  {
    installFetch([
      { match: 'm.weibo.cn/api/config', reply: () => jsonResponse({ data: { login: false } }) },
      { match: 'm.weibo.cn/api/container/getIndex', reply: () => new Response('', { status: 432 }) },
      {
        match: 'weibo.com/ajax/statuses/mymblog',
        reply: () => jsonResponse({ ok: 0, message: '前方有点拥堵，请登录后使用' }, 403),
      },
    ])
    const state = emptyState()
    const result = await scanTargetPosts(makeCtx(makeProvider()), makeConfig(), state, noopLog, true)
    assert.equal(result.errors, 1)
    assert.match(String(result.error), /登录/)
    assert.equal(state.lastRun > 0, true)
    assert.equal(state.lastResult.error, result.error)
    assert.match(state.lastError, /登录/)
    assert.equal(state.history[0].action, 'error')
    assert.equal(state.debug.some((item) => item.kind === 'run-error'), true)
  }

  // 3) 记忆 provider 写失败：不写 postSeen，下一轮会重试，并且错误可见。
  {
    installFetch([
      { match: 'm.weibo.cn/api/config', reply: () => jsonResponse({ data: { uid: '8013522915', login: true } }) },
      {
        match: 'm.weibo.cn/api/container/getIndex',
        reply: () => jsonResponse({ ok: 1, data: { cards: [card(weiboPost())] } }),
      },
      { match: 'api.deepseek.com', reply: () => jsonResponse({ choices: [{ message: { content: memoryText } }] }) },
    ])
    const state = emptyState()
    const failing = makeProvider({ fail: 'memory bridge down' })
    const failed = await scanTargetPosts(makeCtx(failing), makeConfig(), state, noopLog, false)
    assert.equal(failed.memories, 0)
    assert.equal(failed.errors, 1)
    assert.equal(state.postSeen['5001'], undefined)
    assert.equal(state.postMemory['5001'], undefined)
    assert.equal(state.history[0].action, 'error')
    assert.match(state.history[0].error, /记忆写入失败/)
    const working = makeProvider()
    const retried = await scanTargetPosts(makeCtx(working), makeConfig(), state, noopLog, false)
    assert.equal(retried.memories, 1)
    assert.equal(working.records.length, 1)
    assert.equal(state.postSeen['5001'].status, 'read')
  }

  // 4) 关闭记忆时只标记已读，不调用 provider、不报错。
  {
    installFetch([
      { match: 'm.weibo.cn/api/config', reply: () => jsonResponse({ data: { uid: '8013522915', login: true } }) },
      {
        match: 'm.weibo.cn/api/container/getIndex',
        reply: () => jsonResponse({ ok: 1, data: { cards: [card(weiboPost())] } }),
      },
    ])
    const provider = makeProvider()
    const state = emptyState()
    const result = await scanTargetPosts(
      makeCtx(provider),
      makeConfig({ enableMemory: false }),
      state,
      noopLog,
      false,
    )
    assert.equal(result.memories, 0)
    assert.equal(result.errors, 0)
    assert.equal(provider.records.length, 0)
    assert.equal(state.postSeen['5001'].status, 'read')
  }

  // 5) 插件关闭且非强制时保持原有语义：直接跳过，不落 lastRun。
  {
    const state = emptyState()
    const result = await scanTargetPosts(makeCtx(makeProvider()), makeConfig({ enabled: false }), state, noopLog, false)
    assert.equal(result.skipped, 'disabled')
    assert.equal(state.lastRun, 0)
  }

  // 6) 接口被风控/登录墙时 fetchTimeline 必须抛错，而不是返回空数组。
  {
    installFetch([
      {
        match: 'm.weibo.cn/api/container/getIndex',
        reply: () => jsonResponse({ ok: -100, url: 'https://passport.weibo.com/signin.php?x=1' }),
      },
      {
        match: 'weibo.com/ajax/statuses/mymblog',
        reply: () => jsonResponse({ ok: 0, message: '前方有点拥堵，请登录后使用' }, 403),
      },
    ])
    await assert.rejects(
      () => fetchTimeline('6200420068', { cookie: 'SUB=fake' }, { maxPosts: 5 }),
      (error) => {
        assert.match(error.message, /登录/)
        return true
      },
    )
  }

  // 7) 真的没有博文（ok:1 + 空 cards）仍然返回空数组，不误报登录失效。
  {
    installFetch([
      { match: 'm.weibo.cn/api/container/getIndex', reply: () => jsonResponse({ ok: 1, data: { cards: [] } }) },
    ])
    const posts = await fetchTimeline('6200420068', { cookie: 'SUB=fake' }, { maxPosts: 5 })
    assert.deepEqual(posts, [])
  }

  // 8) weibo.com 返回 200 + {ok:-100} 也要判定为登录失效。
  {
    installFetch([
      { match: 'm.weibo.cn/api/container/getIndex', reply: () => new Response('', { status: 432 }) },
      { match: 'weibo.com/ajax/statuses/mymblog', reply: () => jsonResponse({ ok: -100, url: 'https://weibo.com/login.php' }) },
    ])
    await assert.rejects(
      () => fetchTimeline('6200420068', { cookie: 'SUB=fake' }, { maxPosts: 5 }),
      (error) => {
        assert.match(error.message, /登录/)
        return true
      },
    )
  }

  // 9) apply() 端到端：定时器能起来，手动触发一次失败运行后状态落盘且错误可见。
  {
    const { writeFileSync, readFileSync } = require('node:fs')
    const { apply } = await import('../lib/index.js')
    const home = join(tmpdir(), `foxy-weibo-apply-${process.pid}`)
    mkdirSync(join(home, 'foxy-weibo'), { recursive: true })
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    writeFileSync(
      join(home, 'foxy-weibo', 'settings.json'),
      JSON.stringify({
        enabled: true,
        cookie: 'SUB=fake',
        targetUid: '6200420068',
        replyMode: 'off',
        scheduleTimes: ['06:00'],
        enableMemory: true,
        learnPosts: true,
        debug: true,
      }),
      'utf8',
    )
    installFetch([
      { match: 'm.weibo.cn/api/config', reply: () => jsonResponse({ data: { login: false } }) },
      { match: 'm.weibo.cn/api/container/getIndex', reply: () => new Response('', { status: 432 }) },
      {
        match: 'weibo.com/ajax/statuses/mymblog',
        reply: () => jsonResponse({ ok: 0, message: '前方有点拥堵，请登录后使用' }, 403),
      },
    ])
    const disposers = []
    let capability
    const ctx = {
      get: () => undefined,
      logger: { info: () => {}, warn: () => {} },
      effect: (fn) => disposers.push(fn),
      inject: () => {},
      provide: (name, value) => {
        if (name === 'foxyWeibo') capability = value
      },
    }
    try {
      apply(ctx, {})
      assert.ok(capability, 'apply 应该注册 foxyWeibo capability')
      assert.equal(capability.status().enabled, true)
      assert.equal(capability.status().lastRun, 0)
      const result = await capability.scan()
      assert.match(String(result.error), /登录/)
      const status = capability.status()
      assert.equal(status.lastRun > 0, true)
      assert.match(status.lastError, /登录/)
      assert.equal(status.recent[0].action, 'error')
      const saved = JSON.parse(readFileSync(join(home, 'foxy-weibo', 'state.json'), 'utf8'))
      assert.match(String(saved.lastError), /登录/)
      assert.equal(saved.lastResult.errors, 1)
      assert.equal(saved.debug.some((item) => item.kind === 'run-error'), true)
    } finally {
      for (const dispose of disposers) dispose()
      process.env.DSH_HOME = previousHome
    }
  }

  console.log('foxy-weibo auto-read tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
