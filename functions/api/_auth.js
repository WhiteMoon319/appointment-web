/**
 * 认证助手：从请求解析当前登录用户
 * 前端登录后存 token，后续请求带 Authorization: Bearer <token>
 */
export async function getAuthUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;

  const result = await env.DB.prepare(
    'SELECT * FROM users WHERE token = ?'
  ).bind(token).first();
  return result || null;
}

/**
 * 要求老师身份，否则抛错
 */
export async function requireTeacher(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return { error: '未登录', status: 401 };
  if (user.role !== 'teacher') return { error: '仅老师可操作', status: 403 };
  return { user };
}

export async function requireStudent(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return { error: '未登录', status: 401 };
  if (user.role !== 'student') return { error: '仅学生可操作', status: 403 };
  return { user };
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });