/**
 * POST /api/roster/import  老师导入名单（覆盖式，幂等）
 * GET  /api/roster/list    老师查看名单
 * POST /api/roster/add     老师手动添加一条
 */
import { requireTeacher, json } from '../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'GET') {
    return listRoster(env);
  }
  if (request.method !== 'POST') return json({ error: '方法不允许' }, 405);

  const auth = await requireTeacher(request, env);
  if (auth.error) return json({ error: auth.error }, auth.status);

  const body = await request.json().catch(() => ({}));
  const { action = 'import' } = body;
  if (action === 'add') return addOne(env, body);
  return importBatch(env, body);
}

async function listRoster(env) {
  const list = await env.DB.prepare('SELECT id, student_id, name, created_at FROM roster ORDER BY student_id').all();
  return json({ ok: true, data: { list: list.results || [] } });
}

async function importBatch(env, body) {
  const raw = Array.isArray(body.items) ? body.items : [];
  const items = raw
    .map(i => ({ sid: String(i.studentId || '').trim(), name: String(i.name || '').trim() }))
    .filter(i => i.sid && i.name);
  if (!items.length) return json({ error: '没有有效数据' }, 400);

  const now = Date.now();
  let added = 0;
  for (const it of items) {
    await env.DB.prepare(
      'INSERT INTO roster (student_id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(student_id) DO UPDATE SET name = excluded.name'
    ).bind(it.sid, it.name, now).run();
    added++;
  }
  return json({ ok: true, data: { added } });
}

async function addOne(env, body) {
  const sid = String(body.studentId || '').trim();
  const name = String(body.name || '').trim();
  if (!sid || !name) return json({ error: '学号和姓名不能为空' }, 400);
  await env.DB.prepare(
    'INSERT INTO roster (student_id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(student_id) DO UPDATE SET name = excluded.name'
  ).bind(sid, name, Date.now()).run();
  return json({ ok: true, data: { studentId: sid, name } });
}