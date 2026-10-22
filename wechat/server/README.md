# 揪起你的盖头来 · 全国排行榜服务

Node.js 22.22+，使用内置 `node:sqlite`，无需安装依赖。仅将服务绑定到 `127.0.0.1:18765`，由独立 HTTPS 域名 `https://api.momoyu.ltd/` 反向代理。数据库、运行用户、端口与服务均应独立，部署配置见上级项目文档。

## 启动

本地从仓库根目录运行：

```sh
node --env-file=/path/to/private/ranking.env wechat/server/server.mjs
```

服务不会在被 `import` 时启动。测试可通过 `createServer(options)` / `start(options)` 注入认证交换函数、时钟和临时数据库；HTTP 没有测试登录接口，也不读取任何启用测试认证的环境变量。

环境变量参见 [.env.example](.env.example)：

| 变量 | 默认 / 用途 |
| --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `18765` |
| `DB_PATH` | 本目录 `data/ranking.sqlite`；生产设置独立的持久化目录 |
| `GAME_SOURCE_DIR` | 仓库根目录；生产指向同步的 `game/` |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 必填认证配置；缺少任一项时登录返回 503 |
| `SESSION_TTL_SECONDS` | 604800，即 7 天 |
| `MIN_DAY_SECONDS` | 10；第 N 天结算要求开局以来至少经过 N × 此值秒，允许离线结算连续补传 |
| `TRUST_PROXY` | 默认关闭；仅对本机代理信任其覆盖写入的 `X-Real-IP` |

`GAME_SOURCE_DIR` 必须包含原游戏的 `assets.js`、`gfx.js`、`en.js`、`i18n.js`、`docs.js`、`data.js`、`booth.js`、`events.js`、`screens.js`。服务还需同级上层的 `shared/seed.js`。不要把 AppSecret、登录 token、数据库或环境文件加入仓库、小游戏包和前端日志。AppID 可公开，AppSecret 仅留在服务器。

## API

所有 POST 使用 `Content-Type: application/json`。认证接口之外的个人操作使用 `Authorization: Bearer <token>`。错误格式为 `{ "error": { "code": "...", "message": "..." } }`。

| 方法与路径 | 输入 / 输出 |
| --- | --- |
| `GET /healthz` | `{ok:true,service:'ip-please-ranking',wechatConfigured:boolean}` |
| `POST /v1/auth/wechat` | `{code}` → `{token,player:{id,name},expiresAt}` |
| `GET /v1/leaderboard?limit=20` | `{entries,metric:'peak_settled_tokens',rulesVersion}`；有效登录时另含 `me`（未上榜为 null） |
| `POST /v1/runs` | 已登录，`{}` → `{runId,seed,rulesVersion,day:1,state}` |
| `POST /v1/runs/:runId/settlements` | 已登录，见下方结算格式 → `{accepted,day,balance,best,nextDay,finished}` |

`entries` / `me` / `best` 为 `{rank,playerId,name,score,day,achievedAt}`。姓名自动生成匿名审查员编号，不读取微信昵称、头像或地理位置。排行榜按已扣除家庭支出的历史最高剩余 token 排序，同分先达成者优先，时间完全相同再以随机玩家 ID 稳定排序。

### 结算输入

```json
{
  "day": 1,
  "events": [
    {"type":"decision","decision":"deny","exposed":false},
    {"type":"decision","decision":"approve","exposed":false}
  ],
  "spending": ["data", "heat", "extra"],
  "sawNote": false,
  "claimedBalance": 7
}
```

上方为字段示意，必须提交实际完整队伍的事件。普通事件可选 `approve` / `deny` / `detain`；第一天不能拘留。`exposed` 仅在该旅客能通过原版测谎露馅时可为 true。Day 4 快速通道事件为 `{type:'rush',choices:[...]}`，包含完整 6 个 `approve` / `deny` / null（漏掉）决策。Day 5 蒸馏大军事件为 `{type:'clones',hits,passed}`，两者为非负整数且和为 10。

`spending` 只允许当天原版结算实际提供的项目键：`data`、`heat`、`extra`、`med`、`gpu`，不能重复，加餐必须同时选择训练数据，消费须足够支付。纸条实际出现在 Day 4，Day 5 放行中转站可按原版收到贿赂。Day 6 乔治被拒绝 / 拘留后会额外排队一次；瞬时聊天角色不计事件。最后拒绝 / 拘留作者需加 `ending:'deny'`、不填任何支出，余额保留上次已结算存款；批准作者则结算余额为 0。历史最高分不会因失败、后续支出或结局减少。

服务用服务器生成的 seed 与天数重建队伍，在隔离 VM 内加载部署的原游戏代码，复用原版 `finish` / `judge` / `cite` / `initSummary` / `sumBalance` / `familyAfter` 验证工资、奖金、罚款、家庭状态和余额。不会执行客户端传入的代码，也不提供直接写分接口。相同对局、同一天、相同内容的重试返回原结果；内容不同则 409。客户端必须按日依次提交，不能替其他玩家提交。

这能防止直接改分、重复领分和不可能的奖励，但公开的游戏规则和 seed 无法阻止自动化程序模拟合法的完美游戏；最低耗时也不等于完整防作弊。若未来加入有价值奖励，应增加独立风控。

## 边界与存储

- 每个 JSON 请求最多 64 KiB，最多 32 个事件、5 项支出。请求 / 请求头超时 10 秒，微信服务请求超时 8 秒。
- 默认每 IP 120 次 / 分钟、每玩家 60 次 / 分钟、每 IP 登录 12 次 / 分钟，最多同时 16 个微信登录请求；内存限流表最多 10000 项。
- 同一玩家 24 小时最多开局 30 次，最多保留 5 个有效登录。会话仅持久化 SHA-256，不保存原始 token、openid、session_key；微信身份保存 AppID + openid 的 SHA-256。
- SQLite 使用 WAL、预编译绑定参数与事务。表为 `players`、`sessions`、`login_codes`、`runs`、`settlements`、`bests`。对局记录 30 天后可清理，历史个人最佳保留。默认总玩家上限 100000、对局上限 200000，超出时失败关闭；不影响已有最佳成绩查询。
- 私有目录权限由部署配置约束。热备应使用 SQLite 备份接口；直接复制文件前先停止本服务，并同时保留 WAL / SHM（或停服后 checkpoint）。不要只复制正在写入的主数据库文件。

修改计分规则时同步更新 `RULES_VERSION`，避免旧对局按新规则继续结算。客户端与服务必须部署同一份原游戏规则和 `shared/seed.js`。

## 验证

```sh
node --test wechat/tests/server.test.mjs
```

覆盖确定性队伍、原版工资与首次警告免罚、非法拘留 / 奖励、支出、Day 4 纸条 / 快剪、Day 5 贿赂 / 蒸馏事件、Day 6 乔治重排队 / 作者两种结局、真实微信认证边界的 mock、无凭证失败关闭、越权 / 改分 / 重试冲突、会话过期、持久化重启、同分排序和输入限流。自动化使用注入的认证函数，不会用模拟分数污染线上榜单。
