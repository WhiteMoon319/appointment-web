/**
 * 定时提醒逻辑：扫描到点预约并发送 OneBot 通知
 * 供 Worker 的 scheduled 定时触发，也可通过 GET /api/remind 手动调试。
 */
import { sendNotify, fmtTime } from '../lib/notify.js';

export async function runRemind(env) {
  const now = Date.now();
  const stats = { scanned: 0, sent: 0, skipped: 0 };

  const res = await env.DB.prepare(
    "SELECT * FROM appointments WHERE status = 'confirmed' AND start_time > ? ORDER BY start_time LIMIT 200"
  ).bind(now).all();
  const apps = res.results || [];
  stats.scanned = apps.length;

  for (const appt of apps) {
    // 学生提醒
    const student = await env.DB.prepare(
      'SELECT remind_minutes, qq, name FROM users WHERE id = ?'
    ).bind(appt.student_id).first();
    if (student && inWindow(appt.start_time, student.remind_minutes, now)) {
      const r = await sendNotify(env, {
        qq: student.qq,
        content: `预约${appt.teacher_name} · ${fmtTime(appt.start_time)} 即将开始，请按时赴约`
      }, { appointmentId: appt.id, type: 'remind' });
      (r.status === 'sent' || r.status === 'fallback') ? stats.sent++ : stats.skipped++;
    } else {
      stats.skipped++;
    }

    // 老师提醒
    const teacher = await env.DB.prepare(
      'SELECT remind_minutes, qq FROM users WHERE id = ?'
    ).bind(appt.teacher_id).first();
    if (teacher && inWindow(appt.start_time, teacher.remind_minutes, now)) {
      const r = await sendNotify(env, {
        qq: teacher.qq,
        content: `${appt.student_name}预约 · ${fmtTime(appt.start_time)} 即将开始`
      }, { appointmentId: appt.id, type: 'remind' });
      (r.status === 'sent' || r.status === 'fallback') ? stats.sent++ : stats.skipped++;
    } else {
      stats.skipped++;
    }
  }

  return stats;
}

function inWindow(startTime, remindMinutes, now) {
  const minutes = Number(remindMinutes) || 0;
  if (minutes <= 0) return false;
  const windowStart = startTime - minutes * 60000;
  return now >= windowStart && now < startTime;
}