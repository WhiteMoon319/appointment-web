/**
 * /api/auth/*
 * register: 学生（QQ+学号+姓名+密码，匹配名单）/ 老师（QQ+邀请码+姓名+密码）
 * login: QQ+密码 → token
 * me: 当前用户
 * logout: 清除 token
 */
import { createPasswordHash, verifyPassword, randomToken } from '../lib/crypto.js';
import { getAuthUser, json, readBody } from '../lib/auth.js';

export async function register(request, env) {
  const body = await readBody(request);
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
}

export async function login(request, env) {
  const body = await readBody(request);
  const qq = String(body.qq || '').trim();
  const password = String(body.password || '');
  if (!qq || !password) return json({ error: 'QQ 号和密码不能为空' }, 400);

  const user = await env.DB.prepare('SELECT * FROM users WHERE qq = ?').bind(qq).first();
  if (!user) return json({ error: '账号不存在' }, 404);

  const ok = await verifyPassword(password, user.password_salt, user.password_hash);
  if (!ok) return json({ error: '密码错误' }, 401);

  const token = randomToken();
  await env.DB.prepare('UPDATE users SET token = ?, updated_at = ? WHERE id = ?')
    .bind(token, Date.now(), user.id).run();

  return json({
    ok: true,
    data: {
      id: user.id, role: user.role, name: user.name,
      studentId: user.student_id, qq: user.qq, remindMinutes: user.remind_minutes, token
    }
  });
}

export async function me(request, env) {
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

export async function logout(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token) {
    await env.DB.prepare('UPDATE users SET token = NULL WHERE token = ?').bind(token).run();
  }
  return json({ ok: true, data: null });
}