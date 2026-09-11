# 师生预约 Web 版（Cloudflare + OneBot 通知）

学生实名（学号+姓名）预约老师时间，老师确认/拒绝/调整，到点通过 **QQ OneBot 群临时会话**（失败降级群内 at）双端提醒。

## 架构

```
Cloudflare Pages（前端 + API Functions）
  ├─ 前端：index.html（登录/注册）/ student.html / teacher.html
  ├─ API：functions/api/*（身份、名单、预约状态机、设置）
  └─ 中间件：functions/_middleware.js（安全头 + CSRF + 敏感路径拦截）

reminder-worker（独立 Worker，Cron 每分钟）
  └─ 扫描到点预约 → 调 OneBot 发通知（临时会话优先、at 兜底、去重）

D1（appointment-db）：users / roster / appointments / notifications
OneBot（本地 NapCat 系）← Cloudflare Tunnel 暴露
```

## 部署步骤

### 1. 创建 D1 数据库并建表

```bash
cd appointment-web
npx wrangler d1 create appointment-db
# 把输出的 database_id 填入 wrangler.jsonc 和 reminder-worker/wrangler.toml
npx wrangler d1 execute appointment-db --remote --file=functions/_private/db_schema.sql
```

### 2. 配置环境变量（wrangler.jsonc + reminder-worker/wrangler.toml）

| 变量 | 说明 |
|---|---|
| `TEACHER_INVITE_CODE` | 老师注册邀请码（默认 TEST2026，上线前改） |
| `NOTIFY_GROUP_ID` | 预约通知 QQ 群号 |
| `ONEBOT_URL` | 隧道域名，如 `https://onebot.example.com` |
| `ONEBOT_TOKEN` | OneBot access_token（必须开启） |

### 3. 部署 Pages

```bash
npx wrangler pages deploy . --project-name appointment-web
# 或 dashboard 里连 GitHub 自动部署
```

### 4. 部署提醒 Worker

```bash
cd reminder-worker
npm install
npx wrangler deploy
# Cron 触发器每分钟执行，可在 dashboard → Workers → 触发器验证
```

### 5. 隧道（OneBot 暴露）

```bash
# 本地，OneBot HTTP 端口假设 3000
cloudflared tunnel --url http://127.0.0.1:3000
# 联调用临时域名；正式建 named tunnel 绑定自有域名，加入开机自启
```

## 体验流程

1. 老师注册（邀请码+QQ+姓名）→ 名单管理导入学生学号姓名
2. 学生注册（QQ+学号+姓名，须在名单中）→ 预约选老师和时间
3. 老师确认/拒绝/调整 → 学生端看到状态、确认调整
4. 到点前，学生和老师各自按设置的提前时间收到 QQ 临时会话通知
5. 学生/老师未开启「允许群临时会话」时，自动降级为群内 at

## 安全说明

- 数据库：D1 绑定仅在服务端可用，前端不直连
- CSRF：`/api/` 写操作要求 `X-Requested-By: APPT` 头
- 认证：注册设密码，登录发随机 token，请求带 `Authorization: Bearer`
- OneBot：隧道域名公网可访问，**必须开启 access_token**，否则 bot 可被任意调用
- 生产前改掉默认邀请码 `TEST2026`

## 已知边界

- 提醒依赖本地 OneBot 常驻 + 隧道在线，机器关机/隧道断开则提醒中断
- OneBot 为非官方协议，bot 小号存在封号风险，勿用主号
- 临时会话依赖对方隐私设置开启；未开启者走群内 at 兜底