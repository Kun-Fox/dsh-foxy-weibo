# dsh-foxy-weibo

Foxy 的微博子插件：按预设关注微博账号、阅读博文、判断是否评论或记录，并通过 `foxyMemory` 写入微博事件。

> 运行于 DSH。它依赖 `dsh-foxy`（人设）和可选的 `dsh-foxy-memory`（记忆）。

## 依赖关系

- 必需：`dsh-foxy`。
- 记忆：`dsh-foxy-memory`；跨平台落库时可连接 `koishi-plugin-chatluna-foxy-memory`，微博事件通过 `foxyMemory` provider 写入。
- QQ 侧记忆由 Koishi 插件管理，本插件不直接读写 Koishi 数据库。

## 功能

- **阅读目标账号博文**：按设定时间阅读监控账号的博文，每篇写入一条“目标账号博文”记忆，按博文 ID 去重；
- 可选对博文发表一级评论；可设置评论起始时间（`replyAfter`），只评论该时间之后的博文；
- 评论前按预设判断 `skip / comment`，不设最少字数，最多 80 字；
- 自检去重：已评论/已跳过的博文写入 `postSeen`，不会重复评论同一篇；
- 阅读、评论事件写入 Foxy 记忆，字段包含 `platform: weibo`、`channelType: weibo_post`、`eventType: weibo_owner_post|weibo_comment`；
- 设置页提供扫码登录、Cookie 备用、监控账号 UID、模型、每日时间、评论模式、评论起始时间、记忆开关、调试日志与立即检查/立即回复。

## 安装

```powershell
dsh plugin --profile desktop add file:D:\Documents\deepseek-harness\default-workspace\dsh-foxy-weibo
```

安装后完整重启 DSH。左侧栏会出现 **Foxy-weibo**，设置页也会出现同名条目。

## 配置

判断提示词可通过设置页的「判断提示词（附加）」追加到内置提示词后；留空使用内置。自定义要求不会改变 JSON 输出格式。

### 扫码登录

设置页点「扫码登录」，用微博 App 扫码确认即可。插件会：

1. 获取 `login.sina.com.cn` 的二维码；
2. 轮询扫码状态；
3. 登录成功后合并 `SUB/SUBP/XSRF-TOKEN` 等 Set-Cookie；
4. 自动填写账号 UID，并把 Cookie 保存到本机。

二维码过期时点「刷新二维码」。也可以继续手动填 Cookie 作为备用。

### 微博 Cookie

读取公开时间线在部分网络环境会触发微博风控（HTTP 432），因此建议登录：

- `SUB`
- `SUBP`
- `XSRF-TOKEN`

Cookie 只保存在本机 `~/.dsh/foxy-weibo/settings.json`，不会回传给前端。插件优先使用 `m.weibo.cn`，失败时用 `weibo.com/ajax/statuses/mymblog` 作为备用接口。

### 监控账号 UID

`监控账号 UID` 是被阅读、被评论的目标账号（通常是主人账号）；`当前账号` 是扫码登录的机器人账号，两者可以不同。插件不会把登录的机器人账号当成监控账号。

UID 是微博用户主页 URL 里的数字 ID，例如 `https://weibo.com/u/1234567890`。

### AI 模型

插件不经过 DSH 内置 agent，直接调用 OpenAI 兼容的 `/chat/completions`：

- Base URL：例如 `https://api.deepseek.com`
- 模型名：例如 `deepseek-chat`
- API Key：只保存在本机

系统提示词来自 `~/.dsh/foxy/presets/preset.yml` 的 `persona` 字段。

## 建议顺序

1. 扫码登录，填监控账号 UID，`enabled: true`、`replyMode: off`；
2. 设置每日检查时间，或先点「立即检查」，看日志和「调试」里的模型决策；
3. 确认判断正常后，再开启 `replyMode: auto`，每日上限先设为 1；
4. 「立即检查」只预览、不评论；「立即回复」会真实评论一篇，适合测试；
5. 评论有账号风控，不要高频；阅读往期博文会写入记忆，但按博文 ID 去重。

## 记忆事件

微博插件写入的示例：

- 阅读目标博文：`我看到 <博主> 发了一条微博：「...」`
- 评论博文：`我在微博评论了 <博主> 的博文「...」：...`

事件字段：

```json
{
  "platform": "weibo",
  "channelType": "weibo_post",
  "channelId": "<post id>",
  "eventType": "weibo_browse",
  "sourceLabel": "微博",
  "scene": "weibo"
}
```

## 限制

- 微博没有稳定的官方开放评论 API；Cookie 过期、风控或接口变更会导致读取/评论失败；
- 读取评论使用热门评论接口，可能不是全量；
- 评论是否显示受微博审核影响，插件只能提交，不能保证公开可见；
- 当前只做关注用户的时间线，不做搜索/超话/转发；
- 自动评论默认关闭。

## 开发

```powershell
node --check lib/index.js
node test/test-weibo.cjs
node test/test-client.cjs
```

## License

MIT
