# dsh-foxy-weibo

Foxy 的微博子插件：按 foxy3 预设关注微博账号、阅读博文、判断是否评论或记录，并通过 `foxyMemory` 写入微博事件。

> 这是一个 **DSH 插件**，不是 Koishi 插件。它依赖 `dsh-foxy`（人设）和可选的 `dsh-foxy-memory`（记忆）。

## 功能

- 关注一个或多个微博 UID，定时读取最新博文；
- 读取评论区，按 foxy3 预设判断 `skip / remember / comment`；
- 可选自动评论，支持回复评论区中的某条评论（`replyOthers`）；
- 评论前检查每日配额，默认关闭自动评论；
- 浏览、评论事件写入 Foxy 记忆，字段包含 `platform: weibo`、`channelType: weibo_post`、`eventType: weibo_browse|weibo_comment`；
- 设置页提供 Cookie、关注 UID、模型、间隔、评论模式、调试日志与立即运行。

## 安装

```powershell
dsh plugin --profile desktop add file:D:\Documents\deepseek-harness\default-workspace\dsh-foxy-weibo
```

安装后完整重启 DSH。左侧栏会出现 **Foxy-weibo**，设置页也会出现同名条目。

## 配置

### 微博 Cookie

读取公开时间线在部分网络环境会触发微博风控（HTTP 432），因此建议填写登录 Cookie：

- `SUB`
- `SUBP`
- `XSRF-TOKEN`

Cookie 只保存在本机 `~/.dsh/foxy-weibo/settings.json`，不会回传给前端。插件优先使用 `m.weibo.cn`，失败时用 `weibo.com/ajax/statuses/mymblog` 作为备用接口。

### 关注 UID

多个 UID 用逗号分隔，最多 20 个。UID 是微博用户主页 URL 里的数字 ID，例如 `https://weibo.com/u/1234567890`。

### AI 模型

插件不经过 DSH 内置 agent，直接调用 OpenAI 兼容的 `/chat/completions`：

- Base URL：例如 `https://api.deepseek.com`
- 模型名：例如 `deepseek-chat`
- API Key：只保存在本机

系统提示词来自 `~/.dsh/foxy/presets/foxy3.yml` 的 `persona` 字段。

## 建议顺序

1. 先填 Cookie 和关注 UID，`enabled: true`、`commentMode: off`；
2. 点「立即运行」，看日志和「调试」里的模型决策；
3. 确认判断正常后，再开启 `commentMode: auto`，每日上限先设为 1；
4. 需要回复他人评论时再打开 `replyOthers`；
5. 微博评论有账号风控，不要高频、不要对陌生人全自动回复。

## 记忆事件

微博插件写入的示例：

- 浏览：`我在微博看到 <博主> 的博文「...」，觉得...`
- 评论：`我在微博评论了 <博主> 的博文「...」：...`

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
