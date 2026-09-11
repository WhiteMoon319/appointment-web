/**
 * GET /api/auth/me
 * 返回当前登录用户信息
 */
import { getAuthUser, json } from '../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') return json({ error: '方法不允许' }, 405);
  const user = await getAuthUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);
  return json({
    ok: true,
    data: {
      id: user.id, role: user.role, name: user.name,
      studentId: user.student_id, qq: user.qq, remindMinutes: user.remind_minutes
    }
  });
}