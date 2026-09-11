/**
 * /api/appointments  预约状态机
 * GET  列表（学生看自己的 / 老师看名下的，?status= 过滤）
 * POST create / confirm / reject / adjust / studentConfirmAdjust / cancel
 */
import { requireStudent, getAuthUser, json, readBody } from '../lib/auth.js';
import { sendNotify, fmtTime } from '../lib/notify.js';

export async function list(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || '';

  let sql, params;
  if (user.role === 'teacher') {
    sql = 'SELECT * FROM appointments WHERE teacher_id = ?';
    params = [user.id];
  } else {
    sql = 'SELECT * FROM appointments WHERE student_id = ?';
    params = [user.id];
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY start_time DESC LIMIT 100';

  const res = await env.DB.prepare(sql).bind(...params).all();
  return json({ ok: true, data: { list: res.results || [] } });
}

export async function create(request, env, body) {
  const auth = await requireStudent(request, env);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const student = auth.user;

  const teacherId = Number(body.teacherId);
  const startTime = Number(body.startTime);
  if (!teacherId) return json({ error: '请选择老师' }, 400);
  if (!startTime || startTime <= Date.now()) return json({ error: '预约时间必须晚于当前时间' }, 400);

  const teacher = await env.DB.prepare(
    'SELECT id, name, qq FROM users WHERE id = ? AND role = ?'
  ).bind(teacherId, 'teacher').first();
  if (!teacher) return json({ error: '老师不存在' }, 404);

  // 防冲突：同一学生 5 分钟窗口内不得有活跃预约
  const before = startTime - 5 * 60 * 1000;
  const after = startTime + 5 * 60 * 1000;
  const conflict = await env.DB.prepare(
    `SELECT id FROM appointments WHERE student_id = ? AND status IN ('pending','confirmed','adjust_pending')
     AND start_time BETWEEN ? AND ? LIMIT 1`
  ).bind(student.id, before, after).first();
  if (conflict) return json({ error: '你在这个时间段已有进行中的预约' }, 409);

  const now = Date.now();
  const result = await env.DB.prepare(
    `INSERT INTO appointments (student_id, student_name, student_qq, teacher_id, teacher_name, start_time, status, teacher_adjusted, reject_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, '', ?, ?)`
  ).bind(student.id, student.name, student.qq, teacherId, teacher.name, startTime, now, now).run();
  const appointmentId = result.meta.last_row_id;

  // 通知老师：有新预约
  await sendNotify(env, {
    qq: teacher.qq,
    content: `学生${student.name}：有新的待确认预约（${fmtTime(startTime)}），请到系统处理`
  }, { appointmentId, type: 'result' });

  return json({ ok: true, data: { id: appointmentId, status: 'pending' } });
}

export async function stateChange(request, env, action, body = {}) {
  const user = await getAuthUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  const id = Number(body.appointmentId);
  if (!id) return json({ error: '预约 ID 缺失' }, 400);
  const appt = await env.DB.prepare('SELECT * FROM appointments WHERE id = ?').bind(id).first();
  if (!appt) return json({ error: '预约不存在' }, 404);

  const now = Date.now();
  const s = appt.status;

  switch (action) {
    case 'confirm': {
      if (user.role !== 'teacher' || appt.teacher_id !== user.id) return json({ error: '无权操作' }, 403);
      if (s !== 'pending') return json({ error: '当前状态不可确认' }, 409);
      await env.DB.prepare("UPDATE appointments SET status='confirmed', updated_at=? WHERE id=?").bind(now, id).run();
      await sendNotify(env, {
        qq: appt.student_qq,
        content: `与${appt.teacher_name}：预约已确认（${fmtTime(appt.start_time)}）`
      }, { appointmentId: id, type: 'result' });
      return json({ ok: true, data: { id, status: 'confirmed' } });
    }
    case 'reject': {
      if (user.role !== 'teacher' || appt.teacher_id !== user.id) return json({ error: '无权操作' }, 403);
      if (s !== 'pending') return json({ error: '当前状态不可拒绝' }, 409);
      const reason = String(body.reason || '').trim();
      await env.DB.prepare("UPDATE appointments SET status='rejected', reject_reason=?, updated_at=? WHERE id=?").bind(reason, now, id).run();
      await sendNotify(env, {
        qq: appt.student_qq,
        content: `与${appt.teacher_name}：预约已拒绝${reason ? '，原因：' + reason : ''}`
      }, { appointmentId: id, type: 'result' });
      return json({ ok: true, data: { id, status: 'rejected' } });
    }
    case 'adjust': {
      if (user.role !== 'teacher' || appt.teacher_id !== user.id) return json({ error: '无权操作' }, 403);
      if (s !== 'confirmed') return json({ error: '仅已确认的预约可调整' }, 409);
      const newTime = Number(body.startTime);
      if (!newTime || newTime <= Date.now()) return json({ error: '调整后的时间必须晚于当前时间' }, 400);
      await env.DB.prepare(
        "UPDATE appointments SET status='adjust_pending', start_time=?, teacher_adjusted=1, updated_at=? WHERE id=?"
      ).bind(newTime, now, id).run();
      await sendNotify(env, {
        qq: appt.student_qq,
        content: `与${appt.teacher_name}：时间已调整，新时间为 ${fmtTime(newTime)}，请到系统确认`
      }, { appointmentId: id, type: 'result' });
      return json({ ok: true, data: { id, status: 'adjust_pending' } });
    }
    case 'studentConfirmAdjust': {
      if (user.role !== 'student' || appt.student_id !== user.id) return json({ error: '无权操作' }, 403);
      if (s !== 'adjust_pending') return json({ error: '当前状态无需确认' }, 409);
      const agree = body.agree !== false;
      const newStatus = agree ? 'confirmed' : 'cancelled';
      await env.DB.prepare('UPDATE appointments SET status=?, updated_at=? WHERE id=?').bind(newStatus, now, id).run();
      const teacher = await env.DB.prepare('SELECT qq FROM users WHERE id = ?').bind(appt.teacher_id).first();
      if (teacher) {
        await sendNotify(env, {
          qq: teacher.qq,
          content: `学生${appt.student_name}：${agree ? '已同意调整后的时间' : '不同意调整，预约已取消'}`
        }, { appointmentId: id, type: 'result' });
      }
      return json({ ok: true, data: { id, status: newStatus } });
    }
    case 'cancel': {
      if (user.role !== 'student' || appt.student_id !== user.id) return json({ error: '无权操作' }, 403);
      if (!['pending', 'confirmed'].includes(s)) return json({ error: '当前状态不可取消' }, 409);
      await env.DB.prepare("UPDATE appointments SET status='cancelled', updated_at=? WHERE id=?").bind(now, id).run();
      const teacher = await env.DB.prepare('SELECT qq FROM users WHERE id = ?').bind(appt.teacher_id).first();
      if (teacher) {
        await sendNotify(env, {
          qq: teacher.qq,
          content: `学生${appt.student_name}：预约已取消`
        }, { appointmentId: id, type: 'result' });
      }
      return json({ ok: true, data: { id, status: 'cancelled' } });
    }
    default:
      return json({ error: '未知操作' }, 400);
  }
}