/**
 * POST /api/auth/login
 * { qq, password } → 返回用户信息 + token
 */
import { verifyPassword, randomToken } from '../_crypto.js';
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
  } catch (e) {
    console.error(e);
    return json({ error: '服务器错误' }, 500);
  }
}