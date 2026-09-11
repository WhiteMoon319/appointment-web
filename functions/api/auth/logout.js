/**
 * POST /api/auth/logout
 * 清除会话 token
 */
import { json } from '../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: '方法不允许' }, 405);
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token) {
    await env.DB.prepare('UPDATE users SET token = NULL WHERE token = ?').bind(token).run();
  }
  return json({ ok: true, data: null });
}