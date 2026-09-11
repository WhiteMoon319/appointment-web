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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

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