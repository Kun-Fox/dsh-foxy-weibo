# dsh-foxy-weibo

Foxy 的微博子插件：按 foxy3 预设关注微博账号、阅读博文、判断是否评论或记录，并通过 `foxyMemory` 写入微博事件。

> 这是一个 **DSH 插件**，不是 Koishi 插件。它依赖 `dsh-foxy`（人设）和可选的 `dsh-foxy-memory`（记忆）。

## 功能

- **主模式**：检查自己的微博 UID，读取自己新博文下的评论，只回复未回复的他人评论；
- 可设置每日检查时间（`HH:MM`，最多 6 个），例如 `08:30, 20:00`；
- 回复前按 foxy3 预设判断 `skip / comment`，不设最少字数，最多 80 字；
- 旧模式保留：关注一个或多个微博 UID，定时读取时间线并评论；
- 可选自动回复/评论，支持 `replyOthers`、每日上限；
- 浏览、评论、回复事件写入 Foxy 记忆，字段包含 `platform: weibo`、`channelType: weibo_post|weibo_comment`、`eventType: weibo_browse|weibo_comment|weibo_reply`；
- 设置页提供扫码登录、Cookie 备用、自己的 UID、关注 UID、模型、每日时间、回复模式、调试日志与立即运行。

## 安装

```powershell
dsh plugin --profile desktop add file:D:\Documents\deepseek-harness\default-workspace\dsh-foxy-weibo
```

安装后完整重启 DSH。左侧栏会出现 **Foxy-weibo**，设置页也会出现同名条目。

## 配置

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

### 自己的 UID / 关注 UID

`自己的微博 UID` 是主模式使用的账号，插件只检查它的新博文和评论。

`关注 UID` 是旧模式使用，多个 UID 用逗号分隔，最多 20 个。UID 是微博用户主页 URL 里的数字 ID，例如 `https://weibo.com/u/1234567890`。

### AI 模型

插件不经过 DSH 内置 agent，直接调用 OpenAI 兼容的 `/chat/completions`：

- Base URL：例如 `https://api.deepseek.com`
- 模型名：例如 `deepseek-chat`
- API Key：只保存在本机

系统提示词来自 `~/.dsh/foxy/presets/foxy3.yml` 的 `persona` 字段。

## 建议顺序

1. 扫码登录，填自己的微博 UID，`enabled: true`、`replyMode: off`；
2. 设置每日检查时间，或先点「立即运行」，看日志和「调试」里的模型决策；
3. 确认判断正常后，再开启 `replyMode: auto`，每日上限先设为 1；
4. 旧模式需要浏览他人博文时，再关闭「主模式」并配置关注 UID；
5. 微博评论有账号风控，不要高频、不要对陌生人全自动回复。

## 记忆事件

微博插件写入的示例：

- 浏览：`我在微博看到 <博主> 的博文「...」，觉得...`
- 评论：`我在微博评论了 <博主> 的博文「...」：...`
- 回复：`我在微博回复了 <网友> 在自己博文「...」下的评论：...`

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
