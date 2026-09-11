/**
 * POST /api/auth/register
 * 学生注册：{ qq, name, studentId, password } → 匹配 roster 名单
 * 老师注册：{ qq, name, inviteCode, password } → 校验邀请码
 */
import { createPasswordHash, randomToken } from '../_crypto.js';
import { json } from '../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: '方法不允许' }), { status: 405, headers });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const qq = String(body.qq || '').trim();
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    const inviteCode = String(body.inviteCode || '').trim();
    const studentId = String(body.studentId || '').trim();

    if (!qq || !name || !password) return json({ error: 'QQ 号、姓名、密码不能为空' }, 400);
    if (!/^\d{5,12}$/.test(qq)) return json({ error: 'QQ 号格式不正确' }, 400);
    if (password.length < 6) return json({ error: '密码至少 6 位' }, 400);

    const now = Date.now();
    const { salt, hash } = await createPasswordHash(password);
    const token = randomToken();

    if (inviteCode) {
      // 老师注册：校验邀请码
      if (inviteCode !== env.TEACHER_INVITE_CODE) {
        return json({ error: '邀请码错误' }, 403);
      }
      const exist = await env.DB.prepare('SELECT id FROM users WHERE qq = ?').bind(qq).first();
      if (exist) return json({ error: '该 QQ 号已注册，请直接登录' }, 409);

      const result = await env.DB.prepare(
        'INSERT INTO users (role, name, qq, password_hash, password_salt, remind_minutes, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 30, ?, ?, ?)'
      ).bind('teacher', name, qq, hash, salt, token, now, now).run();
      return json({ ok: true, data: { id: result.meta.last_row_id, role: 'teacher', name, qq, token } });
    }

    // 学生注册：学号+姓名匹配名单
    if (!studentId) return json({ error: '学生注册请输入学号' }, 400);
    const roster = await env.DB.prepare('SELECT * FROM roster WHERE student_id = ?').bind(studentId).first();
    if (!roster) return json({ error: '名单中没有这个学号，请联系老师确认' }, 404);
    if (roster.name !== name) return json({ error: '姓名与学号不匹配' }, 404);

    const exist = await env.DB.prepare('SELECT id FROM users WHERE qq = ?').bind(qq).first();
    if (exist) return json({ error: '该 QQ 号已注册，请直接登录' }, 409);

    const result = await env.DB.prepare(
      'INSERT INTO users (role, name, student_id, qq, password_hash, password_salt, remind_minutes, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 30, ?, ?, ?)'
    ).bind('student', name, studentId, qq, hash, salt, token, now, now).run();
    return json({ ok: true, data: { id: result.meta.last_row_id, role: 'student', name, studentId, qq, token } });
  } catch (e) {
    console.error(e);
    return json({ error: '服务器错误' }, 500);
  }
}