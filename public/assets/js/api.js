/* 师生预约 - 公共 API 封装 */
const API = (() => {
  const TOKEN_KEY = 'appt_token';
  const USER_KEY = 'appt_user';

  function token() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function user() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } }
  function setSession(data) {
    if (data) {
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data));
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  }

  async function request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'X-Requested-By': 'APPT',
      ...(options.headers || {})
    };
    const t = token();
    if (t) headers['Authorization'] = `Bearer ${t}`;

    const res = await fetch(path, { ...options, headers });
    let body = null;
    try { body = await res.json(); } catch { /* 非 JSON */ }
    if (!res.ok) {
      const msg = (body && body.error) || `请求失败(${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    if (body && body.ok === false) throw new Error(body.error || '请求失败');
    return body ? body.data : null;
  }

  return {
    token, user, setSession,
    get: (p) => request(p),
    post: (p, data) => request(p, { method: 'POST', body: JSON.stringify(data || {}) })
  };
})();