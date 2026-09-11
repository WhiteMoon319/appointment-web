/**
 * POST /api/settings
 * { remindMinutes: number } 更新本人提前提醒分钟数
 */
import { getAuthUser, json } from '../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: '方法不允许' }, 405);
  const user = await getAuthUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  const body = await request.json().catch(() => ({}));
  const minutes = Math.max(0, Math.min(24 * 60, Number(body.remindMinutes) || 0));
  await env.DB.prepare('UPDATE users SET remind_minutes = ?, updated_at = ? WHERE id = ?')
    .bind(minutes, Date.now(), user.id).run();
  return json({ ok: true, data: { remindMinutes: minutes } });
}