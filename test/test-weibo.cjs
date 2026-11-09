const assert = require('node:assert/strict')

async function main() {
  const {
    parseCookie,
    stripHtml,
    normalizePost,
    fetchTimeline,
    fetchChildComments,
    postComment,
  } = await import('../lib/weibo.js')
  const { normalizeUids, normalizeScheduleTimes, publicSettings } = await import('../lib/settings.js')
  const { judgePost } = await import('../lib/judge.js')
  const { parseWeiboTime } = await import('../lib/weibo.js')
  const { groupPostsByUnit, scanNestedReplies } = await import('../lib/index.js')

  assert.deepEqual(parseCookie('SUB=abc; XSRF-TOKEN=x%2Fy'), { SUB: 'abc', 'XSRF-TOKEN': 'x%2Fy' })
  assert.equal(stripHtml('<p>你好<br/>微博</p>&amp;'), '你好\n微博&')
  assert.deepEqual(normalizeUids('123456, 123456，abc 987654321'), ['123456', '987654321'])
  assert.deepEqual(normalizeScheduleTimes(['20:00', '8:00', '20:00', '23:59', '00:00']), ['00:00', '20:00', '23:59'])
  const { normalizePatch } = await import('../lib/settings.js')
  assert.equal(normalizePatch({}, {}).replyNested, true)
  assert.equal(normalizePatch({}, { replyNested: false }).replyNested, false)
  const baseTime = new Date('2026-11-08T12:00:00+08:00').getTime()
  assert.equal(parseWeiboTime('2026-11-07', baseTime), new Date('2026-11-07T00:00:00+08:00').getTime())
  assert.equal(parseWeiboTime('11-07', baseTime), new Date('2026-11-07T00:00:00+08:00').getTime())
  const publicView = publicSettings({ cookie: 'secret', llmApiKey: 'sk-x' })
  assert.equal(publicView.cookie, undefined)
  assert.equal(publicView.cookieSet, true)
  assert.equal(publicView.llmApiKey, undefined)
  assert.equal(publicView.llmApiKeySet, true)

  const post = normalizePost({
    mblog: {
      id: '123',
      mblogid: '123',
      mid: '456',
      text: '<a>正文</a>',
      user: { id: 7, screen_name: 'Foxy' },
      comments_count: 3,
    },
  })
  assert.equal(post.id, '123')
  assert.equal(post.mid, '456')
  assert.equal(post.text, '正文')
  assert.equal(post.author.name, 'Foxy')

  let calls = 0
  globalThis.fetch = async (url, options = {}) => {
    calls += 1
    if (calls === 1) return new Response('bad', { status: 432 })
    return new Response(
      JSON.stringify({ data: { list: [{ mid: '1', text: 'hello', user: { id: 1, screen_name: 'u' } }] } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  const posts = await fetchTimeline('12345', { cookie: 'SUB=x' })
  assert.equal(posts.length, 1)
  assert.equal(posts[0].text, 'hello')

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: 1,
        data: [{ id: 'child-1', rootid: 'bot-1', user: { id: 9, screen_name: '网友' }, text: '楼中楼' }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  const children = await fetchChildComments('bot-1', { cookie: 'SUB=x' }, 10)
  assert.equal(children.length, 1)
  assert.equal(children[0].cid, 'child-1')
  assert.equal(children[0].rootid, 'bot-1')

  let captured
  globalThis.fetch = async (url, options = {}) => {
    captured = { url, options }
    return new Response(JSON.stringify({ ok: 1, data: { id: 99 } }), { status: 200 })
  }
  const result = await postComment({ mid: '456', text: '评论', cid: '88', config: { cookie: 'SUB=x; XSRF-TOKEN=t' } })
  assert.equal(result.cid, '99')
  assert.equal(captured.options.headers['x-xsrf-token'], 't')
  assert.match(String(captured.options.body), /comment=%E8%AF%84%E8%AE%BA/)
  assert.match(String(captured.options.body), /cid=88/)

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"remember","memory":"我在微博看到一条动态"}' } }] }), {
      status: 200,
    })
  const decision = await judgePost(
    { llmApiKey: 'test', llmBaseUrl: 'https://api.deepseek.com', llmModel: 'deepseek-chat' },
    { summary: '博文', comments: [], commentsText: '', mayComment: false, mayReply: false },
  )
  assert.equal(decision.action, 'remember')
  assert.match(decision.memory, /微博/)

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"comment","comment":"这句回复你"}' } }] }), {
      status: 200,
    })
  const replyDecision = await judgePost(
    { llmApiKey: 'test', llmBaseUrl: 'https://api.deepseek.com', llmModel: 'deepseek-chat' },
    {
      summary: '博文',
      comments: [{ cid: '88', text: '原评论', author: { uid: '9', name: '网友' } }],
      commentsText: '网友：原评论',
      targetComment: { cid: '88', text: '原评论', author: { uid: '9', name: '网友' } },
      mayComment: true,
      mayReply: true,
    },
  )
  assert.equal(replyDecision.action, 'comment')
  assert.equal(replyDecision.replyTo, '88')

  const postDecision = await judgePost(
    { llmApiKey: 'test', llmBaseUrl: 'https://api.deepseek.com', llmModel: 'deepseek-chat' },
    {
      summary: '目标账号发了一条博文',
      comments: [],
      commentsText: '',
      targetPost: { id: '5001', text: '博文正文', author: { name: '主人' } },
      mayComment: true,
      mayReply: false,
      forceComment: true,
    },
  )
  assert.equal(postDecision.action, 'comment')
  assert.equal(postDecision.replyTo, '')

  let nestedCaptured
  let nestedUrl
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url)
    if (target.includes('comments/hotflow')) {
      return new Response(
        JSON.stringify({
          data: {
            data: [
              {
                id: 'bot1',
                rootid: 'bot1',
                user: { id: 7, screen_name: 'AiFoxy' },
                text: 'bot comment',
                comments: [
                  {
                    id: 'child1',
                    rootid: 'bot1',
                    user: { id: 9, screen_name: 'kunfox' },
                    text: 'child comment',
                  },
                ],
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (target.includes('ajax/statuses/buildComments')) {
      return new Response(
        JSON.stringify({
          ok: 1,
          data: [
            {
              id: 'child1',
              rootid: 'bot1',
              user: { id: 9, screen_name: 'kunfox' },
              text: 'child comment',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (target.includes('comments/reply') || target.includes('comments/create')) {
      nestedUrl = target
      nestedCaptured = options
      return new Response(JSON.stringify({ ok: 1, data: { id: 'reply1' } }), { status: 200 })
    }
    if (target.includes('chat/completions')) {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"action":"comment","comment":"回复楼中楼"}' } }],
        }),
        { status: 200 },
      )
    }
    throw new Error(`unexpected fetch ${target}`)
  }
  const state = { postSeen: {}, commentSeen: {}, debug: [] }
  const ctx = {
    get: () => ({ record: async () => ({ ok: true }), context: async () => '' }),
    logger: { info() {}, warn() {} },
  }
  const nestedConfig = {
    cookie: 'SUB=x; XSRF-TOKEN=t',
    targetUid: '1',
    accountUid: '7',
    llmApiKey: 'x',
    llmBaseUrl: 'https://api.deepseek.com',
    llmModel: 'deepseek-chat',
    replyMode: 'auto',
    replyNested: true,
    maxPostsPerRun: 1,
    maxCommentsPerDay: 1,
    memoryPresetId: 'p',
    enableMemory: true,
  }
  const postsWithNested = [
    {
      id: 'post1',
      mid: 'post1',
      text: 'hi',
      author: { uid: '1', name: 'owner' },
      commentsCount: 1,
      url: 'https://weibo.com/1/post1',
    },
  ]
  const dry = await scanNestedReplies(
    ctx,
    nestedConfig,
    state,
    () => {},
    postsWithNested,
    '7',
    '',
    { dryRun: true },
  )
  assert.equal(dry.checked, 1)
  assert.equal(dry.items[0].action, 'pending-reply')
  assert.equal(dry.items[0].commentId, 'child1')
  assert.deepEqual(state.commentSeen, {})

  const actualReply = await scanNestedReplies(
    ctx,
    nestedConfig,
    state,
    () => {},
    postsWithNested,
    '7',
    '',
    {},
  )
  assert.equal(actualReply.replied, 1)
  assert.match(nestedUrl, /comments\/reply/);
  assert.match(String(nestedCaptured.body), /cid=child1/)
  assert.match(String(nestedCaptured.body), /without_mention=1/)
  assert.equal(state.commentSeen.child1.status, 'replied')

  const grouped = groupPostsByUnit(
    [
      { id: 'a', createdAtMs: new Date('2026-01-01T10:00:00+08:00').getTime() },
      { id: 'b', createdAtMs: new Date('2026-01-20T10:00:00+08:00').getTime() },
      { id: 'c', createdAtMs: new Date('2026-02-02T10:00:00+08:00').getTime() },
    ],
    'month',
  )
  assert.deepEqual(grouped.map((group) => group.key), ['2026-01', '2026-02'])
  assert.equal(grouped[0].posts.length, 2)
  assert.equal(grouped[0].startText, '2026-01-01')
  assert.equal(grouped[0].endText, '2026-01-31')

  const yearly = groupPostsByUnit(
    [
      { id: 'a', createdAtMs: new Date('2025-12-31T10:00:00+08:00').getTime() },
      { id: 'b', createdAtMs: new Date('2026-01-01T10:00:00+08:00').getTime() },
    ],
    'year',
  )
  assert.deepEqual(yearly.map((group) => group.key), ['2025', '2026'])

  console.log('foxy-weibo tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

