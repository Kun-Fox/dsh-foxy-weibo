const assert = require('node:assert/strict')

async function main() {
  const { parseCookie, stripHtml, normalizePost, fetchTimeline, postComment } = await import('../lib/weibo.js')
  const { normalizeUids, normalizeScheduleTimes, publicSettings } = await import('../lib/settings.js')
  const { judgePost } = await import('../lib/judge.js')

  assert.deepEqual(parseCookie('SUB=abc; XSRF-TOKEN=x%2Fy'), { SUB: 'abc', 'XSRF-TOKEN': 'x%2Fy' })
  assert.equal(stripHtml('<p>你好<br/>微博</p>&amp;'), '你好\n微博&')
  assert.deepEqual(normalizeUids('123456, 123456，abc 987654321'), ['123456', '987654321'])
  assert.deepEqual(normalizeScheduleTimes(['20:00', '8:00', '20:00', '23:59', '00:00']), ['00:00', '20:00', '23:59'])
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

  console.log('foxy-weibo tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
