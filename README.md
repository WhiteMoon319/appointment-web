# 师生预约（Cloudflare Worker 单应用）

学生实名（学号+姓名）预约老师时间，老师确认/拒绝/调整，到点通过 **QQ OneBot 群临时会话**（失败降级群内 at）双端提醒。

## 架构（单 Worker）

```
appointment-worker（一个 Worker 全包）
  ├─ assets：public/（index.html / student.html / teacher.html / assets/）
  ├─ fetch：/api/* 路由（身份、名单、预约状态机、设置）
  └─ scheduled：Cron 每分钟扫描到点预约 → OneBot 通知

D1（appointment-db）：users / roster / appointments / notifications
OneBot（本地 NapCat 系）← Cloudflare Tunnel 暴露
```

## 项目结构

```
public/            静态页面（登录/注册、学生端、老师端）
src/
  index.js         Worker 入口：路由分发 + 定时触发
  lib/             auth（认证）/ crypto（PBKDF2）/ notify（OneBot 发送）
  routes/          auth / roster / appointments / settings / remind
db_schema.sql      D1 建表脚本
wrangler.toml      单 Worker 配置（assets + D1 + cron + vars）
```

## 部署步骤

### 1. 创建 D1 数据库并建表

```bash
cd appointment-web
npx wrangler d1 create appointment-db
# 把输出的 database_id 填入 wrangler.toml
npx wrangler d1 execute appointment-db --remote --file=db_schema.sql
```

### 2. 配置 wrangler.toml

| 变量 | 说明 |
|---|---|
| `TEACHER_INVITE_CODE` | 老师注册邀请码（默认 TEST2026，上线前改） |
| `NOTIFY_GROUP_ID` | 预约通知 QQ 群号 |
| `ONEBOT_URL` | 隧道域名，如 `https://onebot.example.com` |
| `ONEBOT_TOKEN` | OneBot access_token（必须开启） |

### 3. 部署

```bash
npx wrangler deploy
# Cron 触发器每分钟执行，可在 dashboard → Workers → 触发器验证
```

### 4. 隧道（OneBot 暴露）

```bash
# 本地，OneBot HTTP 端口假设 3000
cloudflared tunnel --url http://127.0.0.1:3000
# 联调用临时域名；正式建 named tunnel 绑定自有域名，加入开机自启
```

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/register | 学生（QQ+学号+姓名+密码，匹配名单）/ 老师（QQ+邀请码+姓名+密码） |
| POST | /api/auth/login | QQ+密码 → token |
| GET | /api/auth/me | 当前用户 |
| POST | /api/auth/logout | 退出登录 |
| GET | /api/roster/list | 名单列表（老师） |
| POST | /api/roster/import | 批量导入（老师，每行：学号,姓名） |
| POST | /api/roster/add | 手动添加一条（老师） |
| GET | /api/teachers | 老师列表（学生选） |
| GET | /api/appointments | 预约列表（学生/老师视角，?status= 过滤） |
| POST | /api/appointments | action: create / confirm / reject / adjust / studentConfirmAdjust / cancel |
| POST | /api/settings | { remindMinutes } 提醒设置 |
| GET | /api/remind | 手动触发提醒（调试） |

## 体验流程

1. 老师注册（邀请码+QQ+姓名）→ 名单管理导入学生学号姓名
2. 学生注册（QQ+学号+姓名，须在名单中）→ 预约选老师和时间
3. 老师确认/拒绝/调整 → 学生端看到状态、确认调整
4. 到点前，学生和老师各自按设置的提前时间收到 QQ 临时会话通知
5. 学生/老师未开启「允许群临时会话」时，自动降级为群内 at

## 安全说明

- 数据库：D1 绑定仅服务端可用，前端不直连
- 认证：注册设密码，登录发随机 token，请求带 `Authorization: Bearer`
- OneBot：隧道域名公网可访问，**必须开启 access_token**，否则 bot 可被任意调用
- 生产前改掉默认邀请码 `TEST2026`

## 已知边界

- 提醒依赖本地 OneBot 常驻 + 隧道在线，机器关机/隧道断开则提醒中断
- OneBot 为非官方协议，bot 小号存在封号风险，勿用主号
- 临时会话依赖对方隐私设置开启；未开启者走群内 at 兜底