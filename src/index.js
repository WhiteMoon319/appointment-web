/**
 * 师生预约 单 Worker 入口
 * - fetch：/api/* 走路由，其余走 assets（public/ 静态页）
 * - scheduled：Cron 每分钟触发到点提醒
 */
import * as auth from './routes/auth.js';
import * as roster from './routes/roster.js';
import * as appointments from './routes/appointments.js';
import * as settings from './routes/settings.js';
import { runRemind } from './routes/remind.js';
import { json } from './lib/auth.js';
import { OneBotBridge } from './onebot-bridge.js';

export { OneBotBridge };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ---- OneBot 反向 WS 连接入口：转发给 DO 持有连接 ----
    if (path === '/ws') {
      const id = env.ONEBOT_BRIDGE.idFromName('onebot');
      const stub = env.ONEBOT_BRIDGE.get(id);
      return stub.fetch(request);
    }

    // ---- API 路由 ----
    if (path.startsWith('/api/')) {
      try {
        // auth
        if (path === '/api/auth/register' && method === 'POST') return auth.register(request, env);
        if (path === '/api/auth/login' && method === 'POST') return auth.login(request, env);
        if (path === '/api/auth/me' && method === 'GET') return auth.me(request, env);
        if (path === '/api/auth/logout' && method === 'POST') return auth.logout(request, env);

        // roster
        if (path === '/api/roster/list' && method === 'GET') return roster.list(env);
        if (path === '/api/roster/import' && method === 'POST') return roster.importBatch(request, env);
        if (path === '/api/roster/add' && method === 'POST') return roster.add(request, env);

        // appointments
        if (path === '/api/appointments' && method === 'GET') return appointments.list(request, env);
        if (path === '/api/appointments' && method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const action = body.action;
          if (action === 'create') return appointments.create(request, env, body);
          return appointments.stateChange(request, env, action, body);
        }

        // settings / teachers / remind
        if (path === '/api/settings' && method === 'POST') return settings.update(request, env);
        if (path === '/api/teachers' && method === 'GET') return settings.teachers(env);
        if (path === '/api/remind' && method === 'GET') {
          const stats = await runRemind(env);
          return json({ ok: true, data: stats });
        }

        // OneBot 联调：通用调用（查看连接状态 / 调任意 action / 发测试消息）
        if (path === '/api/onebot/status' && method === 'GET') {
          const id = env.ONEBOT_BRIDGE.idFromName('onebot');
          const stub = env.ONEBOT_BRIDGE.get(id);
          const st = await stub.fetch(new Request('http://onebot/status')).then(r => r.json());
          return json({ ok: true, data: st });
        }
        if (path === '/api/onebot/call' && method === 'POST') {
          // { action, params } 透传给 OneBot（联调/调试用）
          const body = await request.json().catch(() => ({}));
          if (!body.action) return json({ error: '缺少 action' }, 400);
          const id = env.ONEBOT_BRIDGE.idFromName('onebot');
          const stub = env.ONEBOT_BRIDGE.get(id);
          const r = await stub.fetch(new Request('http://onebot/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: body.action, params: body.params || {} })
          })).then(r => r.json());
          return json({ ok: !!r.ok, data: r });
        }
        if (path === '/api/onebot/test' && method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const qq = String(body.qq || '').trim();
          if (!qq) return json({ error: '缺少 qq' }, 400);
          const content = body.content || '这是一条来自师生预约系统的测试消息';
          const groupId = body.groupId || env.NOTIFY_GROUP_ID;
          const id = env.ONEBOT_BRIDGE.idFromName('onebot');
          const stub = env.ONEBOT_BRIDGE.get(id);
          const r1 = await stub.fetch(new Request('http://onebot/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'send_private_msg',
              params: { user_id: Number(qq), group_id: Number(groupId), message: content, auto_escape: false }
            })
          })).then(r => r.json());
          if (r1.ok) return json({ ok: true, data: { channel: 'temporary', ...r1 } });
          const r2 = await stub.fetch(new Request('http://onebot/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'send_group_msg',
              params: { group_id: Number(groupId), message: `[CQ:at,qq=${qq}] ${content}` }
            })
          })).then(r => r.json());
          return json({ ok: !!r2.ok, data: { channel: r2.ok ? 'at' : 'failed', first: r1, second: r2 } });
        }

        return json({ error: '接口不存在' }, 404);
      } catch (e) {
        console.error('API error:', e);
        return json({ error: '服务器错误' }, 500);
      }
    }

    // ---- 静态资源：交给 assets（public/）----
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRemind(env));
  }
};