# 师生预约

一个轻量的师生预约系统：学生实名（学号 + 姓名）预约老师的时间，老师确认 / 拒绝 / 调整，临近预约时间自动通过 **QQ 机器人**提醒双方。

- **零构建前端**：原生 HTML / CSS / JS，无打包工具
- **单 Worker 全栈**：静态资源 + API + 定时任务 + WebSocket 都在一个 Cloudflare Worker 里
- **零安装通知**：QQ 机器人（OneBot 实现）以 WebSocket 客户端主动连入，无需公网入站、无需隧道

---

## 功能

**学生端**
- 学号 + 姓名实名核验（匹配老师导入的名单）
- 选择老师、日期、时间提交预约
- 查看预约状态、取消预约、确认老师调整的时间
- 设置提前多久提醒（5 分钟 ~ 1 天）

**老师端**
- 邀请码注册
- 批量导入学生名单（粘贴「学号,姓名」）
- 确认 / 拒绝（可填原因）/ 调整预约时间
- 设置自己的提前提醒时间

**通知**
- 预约创建、确认、拒绝、调整、取消、临期提醒，均自动推送 QQ 消息
- 双通道：优先私聊（临时会话），失败自动降级群内 @ 点名

---

## 技术架构

```
┌─────────────────────────────────────────────────────────┐
│  Cloudflare Worker（单应用）                              │
│                                                          │
│  assets ──► public/（登录页 / 学生端 / 老师端）            │
│  fetch  ──► /api/* 路由（身份 · 名单 · 预约 · 设置）        │
│  /ws    ──► Durable Object 持有 OneBot 反向 WebSocket      │
│  cron   ──► 每分钟扫描到点预约 → 发提醒                     │
└───────────────┬─────────────────────────┬───────────────┘
                │ D1                        │ WebSocket
                ▼                           ▼
      users / roster /            OneBot（NapCat 系，本地）
      appointments / notifications      │
                                        ▼
                                     QQ 群 / 私聊
```

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | 原生 HTML/CSS/JS | 复用班务平台设计系统（Vercel 式层级 + Linear 状态点 + 半透明导航） |
| 后端 | Cloudflare Workers | 单 Worker 承载 assets / API / Cron / DO |
| 数据库 | Cloudflare D1 | SQLite，4 张表 |
| 连接 | Durable Objects | 持有 OneBot 反向 WS 长连接 |
| 通知 | OneBot v11 | 本地 NapCat / SnowLuma 等实现，主动连入 Worker |

---

## 核心机制

### 预约状态机

```
pending（学生提交）
  ├─ 老师确认 ──► confirmed
  ├─ 老师拒绝 ──► rejected
  └─ 学生取消 ──► cancelled
confirmed
  ├─ 老师调整时间 ──► adjust_pending
  │     ├─ 学生同意 ──► confirmed
  │     └─ 学生拒绝 ──► cancelled
  └─ 时间到达 ──► completed
```

### 通知通道

系统采用**双通道**，保证通知可靠送达：

1. **私聊（临时会话）**：`send_private_msg` 携带 `group_id` 发起临时会话
2. **群内 @ 兜底**：私聊失败时自动降级为 `send_group_msg` + `[CQ:at,qq=xxx]`

> **重要**：QQ 的临时会话不是机器人能单方面发起的——**必须先由对方主动给机器人发过一条消息**，会话关系才建立。
> 因此若希望收到私聊通知，用户需先在群内找到机器人，对其发起临时会话（随便发一条消息）。
> 否则通知会走群内 @ 通道（机器人无需加好友即可 @ 群成员）。

通知内容去重（`notifications` 表记录 `appointment_id + receiver + type`），同一预约同一类型只发一次。

### 身份与权限

- 学生：注册时校验「学号 + 姓名」是否在老师导入的名单中
- 老师：注册时校验邀请码
- 登录发放随机 token，请求头 `Authorization: Bearer <token>`
- 所有业务操作在服务端校验归属（学生只能动自己的预约，老师只能处理自己名下的预约）

---

## 数据模型

| 表 | 关键字段 | 说明 |
|---|---|---|
| `users` | role / name / student_id / qq / password_hash / remind_minutes / token | 学生与老师共用 |
| `roster` | student_id (unique) / name | 老师导入的名单，学生核验匹配源 |
| `appointments` | student_id / teacher_id / start_time / status / teacher_adjusted / reject_reason | 预约主表 |
| `notifications` | appointment_id / receiver_qq / type / channel / status | 通知发送记录（去重 + 审计） |

完整建表语句见 [`db_schema.sql`](./db_schema.sql)。

---

## 项目结构

```
public/                    静态页面
  index.html                 登录 / 注册
  student.html               学生端
  teacher.html               老师端
  assets/css/style.css       设计系统（令牌 + 组件）
  assets/js/api.js           前端 API 封装
src/
  index.js                   Worker 入口：路由分发 + /ws + cron
  onebot-bridge.js           Durable Object：OneBot 反向 WS 连接
  lib/auth.js                认证助手
  lib/crypto.js              PBKDF2 密码哈希
  lib/notify.js              通知发送（双通道 + 去重）
  routes/                    业务路由（auth / roster / appointments / settings / remind）
db_schema.sql               D1 建表脚本
wrangler.toml               Worker 配置
.dev.vars.example           本地环境变量模板
```

---

## 部署

### 前置

- Cloudflare 账号（Workers + D1 权限）
- 一个 QQ 机器人（OneBot v11 实现：NapCat / SnowLuma / LLOneBot 等）
- 一个用于通知的 QQ 群

### 1. 创建 D1 数据库

```bash
npx wrangler d1 create appointment-db
# 将输出的 database_id 填入 wrangler.toml
npx wrangler d1 execute appointment-db --remote --file=db_schema.sql
```

> 若 `--file` 方式超时，可改用 `--command="<SQL>"` 分批执行。

### 2. 配置敏感变量（Secrets）

```bash
npx wrangler secret put TEACHER_INVITE_CODE   # 老师注册邀请码
npx wrangler secret put NOTIFY_GROUP_ID       # 通知 QQ 群号
npx wrangler secret put ONEBOT_TOKEN          # OneBot 连接鉴权 token
```

| 变量 | 说明 |
|---|---|
| `TEACHER_INVITE_CODE` | 老师注册邀请码 |
| `NOTIFY_GROUP_ID` | 通知 QQ 群号 |
| `ONEBOT_TOKEN` | OneBot 连接鉴权 token（与 OneBot 侧填的一致） |

### 3. 部署 Worker

```bash
npx wrangler deploy
```

> 由于 `workers.dev` 域名在国内多数网络不可达，建议在 Cloudflare 中绑定一个自定义域名。

### 4. 配置 QQ 机器人

在机器人的「WebSocket 客户端」设置中填入：

```
wss://你的域名/ws?access_token=<ONEBOT_TOKEN>
```

- 协议选 **OneBot v11 / Universal**
- 必须是 `wss://`（HTTPS 域名不能用 `ws://`）
- 机器人会自动连接并在断线后重连

---

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册（学生：qq+name+studentId+password；老师：qq+name+inviteCode+password） |
| POST | `/api/auth/login` | 登录 → token |
| GET | `/api/auth/me` | 当前用户 |
| POST | `/api/auth/logout` | 退出登录 |
| GET | `/api/roster/list` | 名单列表（老师） |
| POST | `/api/roster/import` | 批量导入 `{ items: [{studentId, name}] }`（老师） |
| POST | `/api/roster/add` | 添加单条（老师） |
| GET | `/api/teachers` | 老师列表（学生选老师用） |
| GET | `/api/appointments` | 预约列表（学生/老师视角，`?status=` 过滤） |
| POST | `/api/appointments` | `{ action: create \| confirm \| reject \| adjust \| studentConfirmAdjust \| cancel, ... }` |
| POST | `/api/settings` | `{ remindMinutes }` 提醒设置 |
| GET | `/api/remind` | 手动触发提醒（管理，需 Bearer token） |
| GET | `/api/onebot/status` | OneBot 连接状态（管理，需 Bearer token） |
| POST | `/api/onebot/call` | 调用任意 OneBot action（管理，需 Bearer token） |

鉴权约定：写操作需带请求头 `X-Requested-By: APPT`；需登录的接口带 `Authorization: Bearer <用户 token>`；管理端点带 `Authorization: Bearer <ONEBOT_TOKEN>`。

---

## 本地开发

```bash
# 1. 准备本地环境变量
cp .dev.vars.example .dev.vars    # 填入真实值

# 2. 初始化本地 D1
npx wrangler d1 execute appointment-db --local --file=db_schema.sql

# 3. 启动
npx wrangler dev --local
```

本地调试定时任务：

```bash
curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled"
```

---

## 安全

- 密码使用 PBKDF2-SHA256（10 万次迭代）哈希存储
- 敏感配置（邀请码 / 群号 / token）通过 Cloudflare Secrets 管理，不进入仓库
- D1 仅服务端可访问，前端不直连数据库
- 认证：登录发放随机 token，请求带 `Authorization: Bearer <token>`
- CSRF：所有非 GET 的 `/api/*` 写操作需带请求头 `X-Requested-By: APPT`
- 业务鉴权：名单、预约等接口在服务端校验归属（学生只能操作自己的预约，老师只能操作名下的）
- **管理端点**（`/api/onebot/*`、`/api/remind`）需 `Authorization: Bearer <ONEBOT_TOKEN>`，普通用户不可调用

## 已知边界

- OneBot 为非官方协议，机器人账号存在风控/封号风险，建议使用小号
- 私聊通知依赖对方先发起过临时会话；否则走群内 @ 兜底（群成员可见）
- 通知依赖机器人常驻在线；机器人离线期间的通知会失败并记录在 `notifications` 表
- 未实现预约自动归档到 `completed`（当前仅状态机预留）

## License

MIT
