/**
 * /api/roster*  老师名单管理
 * GET  /api/roster/list   名单列表
 * POST /api/roster/import 批量导入（每行学号,姓名）
 * POST /api/roster/add    手动添加一条
 */
import { requireTeacher, json, readBody } from '../lib/auth.js';

export async function list(env) {
  const list = await env.DB.prepare('SELECT id, student_id, name, created_at FROM roster ORDER BY student_id').all();
  return json({ ok: true, data: { list: list.results || [] } });
}

export async function importBatch(request, env) {
  const auth = await requireTeacher(request, env);
  if (auth.error) return json({ error: auth.error }, auth.status);

  const body = await readBody(request);
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

export async function add(request, env) {
  const auth = await requireTeacher(request, env);
  if (auth.error) return json({ error: auth.error }, auth.status);

  const body = await readBody(request);
  const sid = String(body.studentId || '').trim();
  const name = String(body.name || '').trim();
  if (!sid || !name) return json({ error: '学号和姓名不能为空' }, 400);
  await env.DB.prepare(
    'INSERT INTO roster (student_id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(student_id) DO UPDATE SET name = excluded.name'
  ).bind(sid, name, Date.now()).run();
  return json({ ok: true, data: { studentId: sid, name } });
}