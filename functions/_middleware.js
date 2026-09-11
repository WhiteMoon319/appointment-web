/**
 * 师生预约全局中间件：安全响应头 + CSRF + 敏感路径拦截
 */
const BLOCKED_PATHS = [
  '/_private', '/.wrangler', '/node_modules',
  '/wrangler.jsonc', '/wrangler.toml', '/package-lock.json',
  '/db_schema.sql', '/README.md', '/CNAME'
];

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'X-XSS-Protection': '0'
};

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;

  // 阻止敏感路径
  for (const prefix of BLOCKED_PATHS) {
    if (path === prefix || path.startsWith(prefix + '/')) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  // CSRF：/api/ 下 POST/PUT/DELETE 必须携带 X-Requested-By
  if (
    path.startsWith('/api/') &&
    (context.request.method === 'POST' || context.request.method === 'PUT' || context.request.method === 'DELETE')
  ) {
    const requestedBy = context.request.headers.get('X-Requested-By');
    if (requestedBy !== 'APPT') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  const response = await context.next();

  // 加安全头
  const newHeaders = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!newHeaders.has(k)) newHeaders.set(k, v);
  }
  return new Response(response.body, { status: response.status, headers: newHeaders });
}
