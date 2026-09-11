/**
 * GET /api/teachers
 * 返回全部老师列表（学生预约时选择）
 */
import { json } from '../_auth.js';

export async function onRequest(context) {
  const { env } = context;
  const list = await env.DB.prepare(
    'SELECT id, name FROM users WHERE role = ? ORDER BY id'
  ).bind('teacher').all();
  return json({ ok: true, data: { list: list.results || [] } });
}