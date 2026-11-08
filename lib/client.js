window.__ModuleLoader__.load({
  id: 'dsh-foxy-weibo',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/dsh-foxy-weibo'
    const PANEL_ID = 'dsh-foxy-weibo'

    async function request(path, options = {}) {
      const response = await fetch(API + path, {
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
        ...options,
      })
      let body = {}
      try {
        body = await response.json()
      } catch {}
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`)
      return body
    }

    const css = `
      .fw-page { padding: 28px 32px 44px; max-width: 880px; color: var(--dsw-alias-label-primary, #1f2328); height: 100%; overflow: auto; box-sizing: border-box; overflow-anchor: none; }
      .fw-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
      .fw-eyebrow { margin: 0 0 6px; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
      .fw-head h1 { margin: 0; font-size: 22px; line-height: 1.25; }
      .fw-head p { margin: 6px 0 0; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 12px; }
      .fw-badge { flex: none; border: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); border-radius: 999px; padding: 4px 10px; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 11px; }
      .fw-card { margin-bottom: 14px; padding: 18px 20px; border: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #fff); }
      .fw-card h2 { margin: 0; font-size: 15px; }
      .fw-card > p { margin: 5px 0 14px; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 12px; line-height: 1.6; }
      .fw-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 18px; }
      .fw-field { min-width: 0; }
      .fw-field label { display: block; color: var(--dsw-alias-label-secondary, #4b5563); font-size: 12px; font-weight: 600; }
      .fw-field small { display: block; margin-top: 3px; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 11px; line-height: 1.45; }
      .fw-field input, .fw-field select { width: 100%; box-sizing: border-box; margin-top: 5px; padding: 7px 9px; border: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); border-radius: 7px; background: var(--dsw-alias-bg-layer-2, #f7f7f8); color: inherit; font: inherit; font-size: 12px; }
      .fw-field textarea { width: 100%; box-sizing: border-box; margin-top: 5px; padding: 8px 9px; min-height: 90px; resize: vertical; border: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); border-radius: 7px; background: var(--dsw-alias-bg-layer-2, #f7f7f8); color: inherit; font: inherit; font-size: 12px; }
      .fw-toggle { display: flex; position: relative; align-items: flex-start; gap: 10px; margin-top: 12px; cursor: pointer; }
      .fw-toggle button { position: relative; flex: none; width: 32px; height: 18px; margin-top: 1px; border: 0; border-radius: 999px; background: var(--dsw-alias-bg-layer-3, #d1d5db); padding: 0; cursor: pointer; }
      .fw-toggle button::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .15s ease; }
      .fw-toggle[data-on="true"] button { background: #2f7d4a; }
      .fw-toggle[data-on="true"] button::after { transform: translateX(14px); }
      .fw-toggle strong { display: block; font-size: 12px; }
      .fw-toggle small { display: block; margin-top: 2px; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 11px; }
      .fw-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
      .fw-qr { display: flex; align-items: center; gap: 14px; margin-top: 12px; padding: 10px; border: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); border-radius: 8px; }
      .fw-qr img { display: block; flex: none; width: 180px; height: 180px; background: #fff; }
      .fw-qr p { margin: 0; color: var(--dsw-alias-label-secondary, #4b5563); font-size: 12px; }
      .fw-btn { border: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); border-radius: 7px; padding: 7px 12px; background: transparent; color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
      .fw-btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
      .fw-btn:disabled { opacity: .55; cursor: default; }
      .fw-alert { margin: 10px 0 0; padding: 8px 10px; border-radius: 7px; font-size: 12px; }
      .fw-error { color: #a33; background: rgba(180, 40, 40, .08); }
      .fw-ok { color: #2f7d4a; background: rgba(40, 130, 70, .08); }
      .fw-muted { margin: 8px 0; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 12px; }
      .fw-stats { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 12px; }
      .fw-stats div { min-width: 80px; }
      .fw-stats strong { display: block; font-size: 18px; }
      .fw-stats small { color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 11px; }
      .fw-log { margin-top: 10px; border-top: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); }
      .fw-row { padding: 9px 0; border-bottom: 1px solid var(--dsw-alias-bg-layer-3, #e5e7eb); }
      .fw-row a { display: block; color: inherit; font-size: 12px; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fw-row a:hover { text-decoration: underline; }
      .fw-row small, .fw-row p { color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 11px; }
      .fw-row p { margin: 3px 0 0; }
      .fw-debug pre { margin: 5px 0 0; max-height: 140px; overflow: auto; white-space: pre-wrap; word-break: break-word; color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 10px; }
      @media (max-width: 720px) { .fw-page { padding: 20px 16px 32px; } .fw-grid { grid-template-columns: 1fr; } }
    `

    function Icon({ size = 18 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M4 6h16v10H9l-5 4V6Z' }),
        h('path', { d: 'M8 10h8M8 13h5' }),
        h('circle', { cx: 18, cy: 5, r: 2 }),
      )
    }

    function Toggle({ checked, onChange, label, hint, disabled }) {
      return h(
        'div',
        { className: 'fw-toggle', 'data-on': checked ? 'true' : 'false' },
        h('button', { type: 'button', role: 'switch', 'aria-checked': !!checked, disabled, onClick: () => onChange(!checked) }),
        h('span', null, h('strong', null, label), hint ? h('small', null, hint) : null),
      )
    }

    function Field({ label, hint, children }) {
      return h('div', { className: 'fw-field' }, h('label', null, label), hint ? h('small', null, hint) : null, children)
    }

    function SectionHead({ title, description }) {
      return h('div', null, h('h2', null, title), description ? h('p', null, description) : null)
    }

    function Panel() {
      const [settings, setSettings] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const [cookieDraft, setCookieDraft] = React.useState('')
      const [apiKeyDraft, setApiKeyDraft] = React.useState('')
      const [targetText, setTargetText] = React.useState('')
      const [scheduleText, setScheduleText] = React.useState('')
      const [qr, setQr] = React.useState('')
      const [qrState, setQrState] = React.useState('')
      const qrTimer = React.useRef(null)
      const [busy, setBusy] = React.useState('')
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const mounted = React.useRef(true)

      const refresh = React.useCallback(async () => {
        const data = await request('/status')
        if (!mounted.current) return
        setSettings(data.settings)
        setStatus(data.status)
        setTargetText((data.settings?.targetUids || []).join(', '))
        setScheduleText((data.settings?.scheduleTimes || []).join(', '))
      }, [])

      React.useEffect(() => {
        mounted.current = true
        refresh().catch((e) => setError(e.message))
        return () => {
          mounted.current = false
          if (qrTimer.current) clearTimeout(qrTimer.current)
        }
      }, [refresh])

      const setField = (key, value) => setSettings((current) => (current ? { ...current, [key]: value } : current))

      const save = async () => {
        if (!settings) return
        setBusy('save'); setError(''); setNotice('')
        try {
          const patch = { ...settings, targetUids: targetText, scheduleTimes: scheduleText }
          if (cookieDraft.trim()) patch.cookie = cookieDraft.trim()
          if (apiKeyDraft.trim()) patch.llmApiKey = apiKeyDraft.trim()
          const data = await request('/settings', { method: 'POST', body: JSON.stringify(patch) })
          setSettings(data.settings)
          setStatus(data.status)
          setCookieDraft('')
          setApiKeyDraft('')
          setNotice('设置已保存')
        } catch (e) { setError(e.message) } finally { setBusy('') }
      }

      const pollLogin = async (qrid, attempt = 0) => {
        if (!mounted.current || attempt > 90) return
        try {
          const data = await request('/login/poll', {
            method: 'POST',
            body: JSON.stringify({ qrid }),
          })
          if (!mounted.current) return
          if (data.state === 'ok') {
            setQrState('ok')
            setQr('')
            setSettings(data.settings)
            setStatus(data.status)
            setNotice(`已登录${data.account?.screenName ? `：${data.account.screenName}` : ''}`)
            return
          }
          if (data.state === 'expired') {
            setQrState('expired')
            setQr('')
            return
          }
          setQrState(data.state)
          qrTimer.current = setTimeout(() => pollLogin(qrid, attempt + 1), 2000)
        } catch (e) {
          if (mounted.current) setError(e.message)
        }
      }

      const startLogin = async () => {
        if (qrTimer.current) clearTimeout(qrTimer.current)
        setBusy('login')
        setError('')
        setNotice('')
        try {
          const data = await request('/login/start', { method: 'POST', body: '{}' })
          setQr(data.qr)
          setQrState('waiting')
          pollLogin(data.qrid)
        } catch (e) {
          setError(e.message)
        } finally {
          setBusy('')
        }
      }

      const logout = async () => {
        setBusy('logout')
        setError('')
        setNotice('')
        try {
          const data = await request('/logout', { method: 'POST', body: '{}' })
          setSettings(data.settings)
          setStatus(data.status)
          setQr('')
          setNotice('已退出微博登录')
        } catch (e) {
          setError(e.message)
        } finally {
          setBusy('')
        }
      }

      const runNow = async () => {
        setBusy('run'); setError(''); setNotice('')
        try {
          const data = await request('/run', { method: 'POST', body: '{}' })
          setStatus(data.status)
          const result = data.result || {}
          if (result.error) {
            setError(`检查失败：${result.error}`)
            return
          }
          setNotice(
            result.skipped === 'disabled'
              ? '未开始：自动浏览已关闭'
              : result.skipped === 'busy'
                ? '正在运行，请稍候'
                : result.skipped === 'no-target'
                  ? '未开始：请先填写监控账号 UID'
                  : `运行完成：检查 ${result.checked || 0} 条，回复 ${result.replied || 0} 条` +
                    (result.previewed ? `，预览 ${result.previewed} 条` : '') +
                    `，跳过 ${result.skipped || 0} 条`,
          )
        } catch (e) { setError(e.message) } finally { setBusy('') }
      }

      const checkNow = async () => {
        setBusy('check'); setError(''); setNotice('')
        try {
          const data = await request('/check-now', { method: 'POST', body: '{}' })
          setStatus(data.status)
          const result = data.result || {}
          if (result.error) {
            setError(`检查失败：${result.error}`)
            return
          }
          setNotice(
            result.skipped === 'no-target'
              ? '未开始：请先填写监控账号 UID'
              : result.skipped === 'busy'
                ? '正在运行，请稍候'
                : `检查完成：检查 ${result.checked || 0} 条评论，预览 ${result.previewed || 0} 条，跳过 ${result.skipped || 0} 条` +
                  (result.errors ? `，失败 ${result.errors} 条` : ''),
          )
        } catch (e) { setError(e.message) } finally { setBusy('') }
      }

      const replyNow = async () => {
        if (!window.confirm('立即回复会真实发布到微博，确定继续？')) return
        setBusy('reply'); setError(''); setNotice('')
        try {
          const data = await request('/reply-now', { method: 'POST', body: '{}' })
          setStatus(data.status)
          const result = data.result || {}
          if (result.error) {
            setError(`回复失败：${result.error}`)
            return
          }
          setNotice(
            result.replied > 0
              ? `已立即回复 ${result.replied} 条，可在下方日志查看`
              : result.skipped === 'no-target'
                ? '未开始：请先填写监控账号 UID'
                : '没有可立即回复的评论（可能已处理或模型选择跳过）',
          )
        } catch (e) { setError(e.message) } finally { setBusy('') }
      }

      if (!settings) return h('div', { className: 'fw-page' }, h('p', { className: 'fw-muted' }, error || '正在读取微博设置…'))

      const recent = Array.isArray(status?.recent) ? status.recent : []
      const debugEvents = Array.isArray(status?.debug) ? status.debug : []
      return h(
        'div',
        { className: 'fw-page' },
        h('style', null, css),
        h('div', { className: 'fw-head' },
          h('div', null,
            h('p', { className: 'fw-eyebrow' }, 'FOXY EXTENSION'),
            h('h1', null, '微博评论'),
            h('p', null, 'Foxy 按 foxy3 预设关注微博账号，阅读、判断、评论并写入记忆。'),
          ),
          h('span', { className: 'fw-badge' }, settings.enabled ? '自动浏览已开启' : '自动浏览已关闭'),
        ),

        h('section', { className: 'fw-card' },
          h(SectionHead, { title: '账号与登录', description: '扫码登录后即可回复评论；Cookie 输入保留为备用方式。' }),
          h('div', { className: 'fw-grid' },
            h(Field, { label: '当前账号', hint: '扫码成功后自动显示' },
              h('input', { value: settings.accountName ? `${settings.accountName}（${settings.accountUid || '?'}）` : settings.cookieSet ? '已登录' : '未登录', readOnly: true }),
            ),
            h(Field, { label: '监控账号 UID', hint: '要检查博文评论的目标账号；不是登录的机器人账号' },
              h('input', { value: settings.targetUid || '', placeholder: '例如 1234567890', onChange: (e) => setField('targetUid', e.target.value) })),
          ),
          h('div', { className: 'fw-actions' },
            h('button', { className: 'fw-btn primary', disabled: !!busy, onClick: startLogin }, busy === 'login' ? '获取二维码…' : qr ? '刷新二维码' : '扫码登录'),
            h('button', { className: 'fw-btn', disabled: !!busy || !settings.cookieSet, onClick: logout }, busy === 'logout' ? '退出中…' : '退出登录'),
          ),
          qr
            ? h('div', { className: 'fw-qr' },
                h('img', { src: qr, alt: '微博登录二维码', width: 180, height: 180 }),
                h('p', null, qrState === 'scanned' ? '已扫码，请在手机上确认登录' : qrState === 'expired' ? '二维码已过期，请刷新' : '请用微博 App 扫码'),
              )
            : null,
          h(Field, { label: '微博 Cookie（备用）', hint: settings.cookieSet ? '已保存；留空表示不修改' : '从浏览器复制 SUB、SUBP、XSRF-TOKEN 等 Cookie' },
            h('textarea', { value: cookieDraft, placeholder: settings.cookieSet ? '已保存，留空不修改' : 'SUB=...; SUBP=...; XSRF-TOKEN=...', onChange: (e) => setCookieDraft(e.target.value) })),
        ),

        h('section', { className: 'fw-card' },
          h(SectionHead, { title: 'AI 模型', description: '直连 OpenAI 兼容 API；Key 只保存在本机，不回传前端。' }),
          h('div', { className: 'fw-grid' },
            h(Field, { label: '接口地址', hint: '自动补 /chat/completions' },
              h('input', { value: settings.llmBaseUrl || '', onChange: (e) => setField('llmBaseUrl', e.target.value) })),
            h(Field, { label: '模型名', hint: '例如 deepseek-chat' },
              h('input', { value: settings.llmModel || '', onChange: (e) => setField('llmModel', e.target.value) })),
            h(Field, { label: 'API Key', hint: settings.llmApiKeySet ? '已保存；留空表示不修改' : '必填，否则无法判断' },
              h('input', { type: 'password', value: apiKeyDraft, placeholder: settings.llmApiKeySet ? '已保存，留空不修改' : 'sk-...', onChange: (e) => setApiKeyDraft(e.target.value) })),
          ),
        ),

        h('section', { className: 'fw-card' },
          h(SectionHead, { title: '博文评论回复', description: '每日按设定时间检查目标账号的新博文，并回复其评论区中尚未处理的他人评论。' }),
          h(Toggle, { checked: settings.enabled, onChange: (v) => setField('enabled', v), label: '启用自动检查', hint: '关闭后定时任务不运行，仍可使用「立即运行」。' }),
          h(Toggle, { checked: settings.replyOwnPosts, onChange: (v) => setField('replyOwnPosts', v), label: '仅监控目标账号的博文', hint: '关闭后回到旧模式，浏览关注账号的时间线并评论博文。' }),
          h('div', { className: 'fw-grid' },
            h(Field, { label: '每日检查时间', hint: 'HH:MM，多个用逗号分隔，最多 6 个，例如 08:30, 20:00' },
              h('input', { value: scheduleText, placeholder: '20:00', onChange: (e) => setScheduleText(e.target.value) })),
            h(Field, { label: '回复模式', hint: '自动才会发布回复；建议先仅记录' },
              h('select', { value: settings.replyMode, onChange: (e) => setField('replyMode', e.target.value) },
                h('option', { value: 'off' }, '仅检查，不回复'),
                h('option', { value: 'auto' }, '自动回复'),
              )),
            h(Field, { label: '每轮检查博文数', hint: '范围 1–20' },
              h('input', { type: 'number', min: 1, max: 20, value: settings.maxPostsPerRun, onChange: (e) => setField('maxPostsPerRun', e.target.value) })),
            h(Field, { label: '每日回复上限', hint: '0–10，同时限制评论' },
              h('input', { type: 'number', min: 0, max: 10, value: settings.maxCommentsPerDay, onChange: (e) => setField('maxCommentsPerDay', e.target.value) })),
          ),
          h('div', { className: 'fw-grid' },
            h(Field, { label: '时间线轮询（旧模式备用）', hint: '关闭“仅监控目标账号的博文”时使用，分钟' },
              h('input', { type: 'number', min: 5, max: 1440, value: settings.intervalMinutes, onChange: (e) => setField('intervalMinutes', e.target.value) })),
            h(Field, { label: '旧模式评论模式', hint: '浏览他人博文时是否发一级评论' },
              h('select', { value: settings.commentMode, onChange: (e) => setField('commentMode', e.target.value) },
                h('option', { value: 'off' }, '仅记录'),
                h('option', { value: 'auto' }, '自动评论'),
              )),
          ),
          h(Toggle, { checked: settings.replyOthers, onChange: (v) => setField('replyOthers', v), label: '回复他人评论', hint: '旧模式可从评论区选择一条评论回复。' }),
          h(Toggle, { checked: settings.enableMemory, onChange: (v) => setField('enableMemory', v), label: '写入 Foxy 记忆', hint: '通过 foxyMemory 写入微博事件，按 preset 召回。' }),
          h(Toggle, { checked: settings.runOnStart, onChange: (v) => setField('runOnStart', v), label: '启动 DSH 后自动运行', hint: '启动约 20 秒后执行一轮。' }),
          h(Toggle, { checked: settings.debug, onChange: (v) => setField('debug', v), label: '记录调试日志', hint: '保存模型输出与记忆写入结果，便于排查。' }),
          h('div', { className: 'fw-actions' },
            h('button', { className: 'fw-btn primary', disabled: !!busy, onClick: runNow }, busy === 'run' ? '正在运行…' : '立即运行'),
            h('button', { className: 'fw-btn', disabled: !!busy, onClick: checkNow }, busy === 'check' ? '检查中…' : '立即检查'),
            h('button', { className: 'fw-btn', disabled: !!busy, onClick: replyNow }, busy === 'reply' ? '回复中…' : '立即回复'),
            h('button', { className: 'fw-btn', disabled: !!busy, onClick: save }, busy === 'save' ? '保存中…' : '保存设置'),
          ),
          h('div', { className: 'fw-stats' },
            h('div', null, h('strong', null, status?.seen || 0), h('small', null, '已浏览')),
            h('div', null, h('strong', null, status?.commentsToday || 0), h('small', null, '今日评论')),
            h('div', null, h('strong', null, status?.targetCount || 0), h('small', null, '关注账号')),
            h('div', null, h('strong', null, status?.lastRun ? new Date(status.lastRun).toLocaleString() : '尚未运行'), h('small', null, '上次运行')),
          ),
        ),

        h('section', { className: 'fw-card' },
          h(SectionHead, { title: '运行与日志', description: '记录阅读过的博文、判断、评论与记忆结果。' }),
          recent.length
            ? h('div', { className: 'fw-log' }, recent.map((item, index) =>
                h('div', { className: 'fw-row', key: `${item.at}-${index}` },
                  h('a', { href: item.url, target: '_blank', rel: 'noreferrer' }, item.title || item.post),
                  h('small', null, `${item.author || ''} · ${new Date(item.at).toLocaleString()} · ${item.action}${item.memory ? ` · 记忆 ${item.memory}` : ''}`),
                  item.comment ? h('p', null, item.comment) : null,
                  item.error ? h('p', null, item.error) : null,
                ),
              ))
            : h('p', { className: 'fw-muted' }, '暂无运行记录。'),
          debugEvents.length
            ? h('div', { className: 'fw-debug' }, debugEvents.map((event, index) =>
                h('div', { className: 'fw-row', key: `${event.at}-${index}` },
                  h('small', null, `${new Date(event.at).toLocaleString()} · ${event.kind || 'event'}${event.post ? ` · ${event.post}` : ''}`),
                  h('p', null, [event.action ? `动作 ${event.action}` : '', event.memory || '', event.reason || ''].filter(Boolean).join(' · ')),
                  event.raw ? h('pre', null, event.raw) : null,
                ),
              ))
            : null,
        ),

        error ? h('p', { className: 'fw-alert fw-error' }, error) : null,
        notice ? h('p', { className: 'fw-alert fw-ok' }, notice) : null,
        h('p', { className: 'fw-muted' }, '微博评论有账号风控风险。建议先用「仅记录」观察，再开启自动评论；回复功能默认关闭。'),
      )
    }

    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-foxy-weibo')
        style.textContent = css
        document.head.appendChild(style)
        return () => style.remove()
      })
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, inject: () => ({ workbench: true }) }, () => h(Panel)))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 14, label: () => 'Foxy-weibo' }, Icon))
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'foxy-weibo', order: 32, label: 'Foxy-weibo' }, () => h(Panel)))
    }

    return { name: 'dsh-foxy-weibo', inject: ['slots'], apply }
  },
})
