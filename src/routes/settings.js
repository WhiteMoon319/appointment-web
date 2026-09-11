/**
 * /api/settings  POST { remindMinutes } 更新本人提醒设置
 */
import { getAuthUser, json, readBody } from '../lib/auth.js';

export async function update(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  const body = await readBody(request);
  const minutes = Math.max(0, Math.min(24 * 60, Number(body.remindMinutes) || 0));
  await env.DB.prepare('UPDATE users SET remind_minutes = ?, updated_at = ? WHERE id = ?')
    .bind(minutes, Date.now(), user.id).run();
  return json({ ok: true, data: { remindMinutes: minutes } });
}

/**
 * /api/teachers  GET 老师列表（学生预约时选择）
 */
export async function teachers(env) {
  const list = await env.DB.prepare(
    'SELECT id, name FROM users WHERE role = ? ORDER BY id'
  ).bind('teacher').all();
  return json({ ok: true, data: { list: list.results || [] } });
}