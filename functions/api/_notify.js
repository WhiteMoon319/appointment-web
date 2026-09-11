/**
 * OneBot 通知模块
 * 策略：群临时会话（send_private_msg 带 group_id）优先，
 *       失败降级为群内 at（send_group_msg 带 [CQ:at,qq=xxx]），
 *       仍失败则记录 failed。
 * 环境变量：ONEBOT_URL / ONEBOT_TOKEN / NOTIFY_GROUP_ID
 */

async function onebotCall(env, action, params) {
  const url = `${env.ONEBOT_URL}/${action}`;
  const headers = { 'Content-Type': 'application/json' };
  if (env.ONEBOT_TOKEN) headers['Authorization'] = `Bearer ${env.ONEBOT_TOKEN}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(params)
    });
    const body = await res.json().catch(() => ({}));
    // OneBot 11: { status: 'ok'|'failed', retcode, data, message }
    return { httpOk: res.ok, code: Number(body.retcode ?? -1), message: body.message || '', body };
  } catch (e) {
    return { httpOk: false, code: -999, message: String(e.message || e) };
  }
}

/**
 * 发送通知主入口
 * @param {object} env
 * @param {object} inputs { qq, groupId, content }
 * @param {object} record { appointmentId, type }
 * @returns {Promise<{channel, status}>}
 */
export async function sendNotify(env, inputs, record) {
  const groupId = inputs.groupId || env.NOTIFY_GROUP_ID;
  const qq = String(inputs.qq || '').trim();
  if (!qq) return { channel: 'failed', status: 'failed' };
  if (!groupId) return { channel: 'failed', status: 'failed' };

  const dedup = await env.DB.prepare(
    'SELECT id FROM notifications WHERE appointment_id = ? AND receiver_qq = ? AND type = ? LIMIT 1'
  ).bind(record.appointmentId, qq, record.type).first();
  if (dedup) return { channel: dedup.channel, status: 'duplicated' };

  // 通道1：群临时会话私发
  const r1 = await onebotCall(env, 'send_private_msg', {
    user_id: Number(qq),
    group_id: Number(groupId),
    message: inputs.content
  });
  if (r1.code === 0 || r1.httpOk) {
    await logSend(env, record, qq, 'temporary', 'sent');
    return { channel: 'temporary', status: 'sent' };
  }

  // 通道2：群内 at 兜底
  const r2 = await onebotCall(env, 'send_group_msg', {
    group_id: Number(groupId),
    message: `[CQ:at,qq=${qq}] ${inputs.content}`
  });
  if (r2.code === 0 || r2.httpOk) {
    await logSend(env, record, qq, 'at', 'fallback');
    return { channel: 'at', status: 'fallback' };
  }

  // 全部失败
  await logSend(env, record, qq, 'failed', 'failed');
  return { channel: 'failed', status: 'failed' };
}

async function logSend(env, record, qq, channel, status) {
  await env.DB.prepare(
    'INSERT INTO notifications (appointment_id, receiver_qq, type, channel, status, sent_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(record.appointmentId, qq, record.type, channel, status, Date.now()).run();
}

export const fmtTime = (ts) => {
  const d = new Date(ts);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const STATUS_TEXT = {
  new_appointment: '有新的待确认预约',
  confirmed: '已确认',
  rejected: '已拒绝',
  adjust_pending: '时间已调整，请确认',
  cancelled: '已取消'
};