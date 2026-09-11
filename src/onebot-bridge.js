/**
 * OneBotBridge Durable Object
 * 持有 OneBot 反向 WebSocket 连接（OneBot 作为 WS 客户端主动连入，零安装）。
 * 提供 OneBot 11 API 调用：sendOneBot(action, params)，
 * 发送 {action, params, echo} 帧并等待 echo 匹配的响应。
 */

export class OneBotBridge {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.conns = new Set();
    this.pending = new Map(); // echo -> { resolve, timer }
    this.seq = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // ---- OneBot 反向 WS 连接入口 ----
    if (request.headers.get('Upgrade') === 'websocket') {
      if (this.env.ONEBOT_TOKEN) {
        const auth = request.headers.get('Authorization') || '';
        const qToken = url.searchParams.get('access_token') || '';
        const authorized = auth === `Bearer ${this.env.ONEBOT_TOKEN}` || qToken === this.env.ONEBOT_TOKEN;
        if (!authorized) return new Response('Unauthorized', { status: 401 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      server.addEventListener('message', (e) => this._onMessage(server, e));
      server.addEventListener('close', () => this.conns.delete(server));
      server.addEventListener('error', () => this.conns.delete(server));
      this.conns.add(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    // ---- 内部 HTTP 调用（备用，与 RPC 等价）----
    if (url.pathname === '/send' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const result = await this.sendOneBot(body.action, body.params, body.timeout);
      return Response.json(result);
    }

    // ---- 连接状态查询（联调用）----
    if (url.pathname === '/status') {
      return Response.json({ ok: true, connected: this.conns.size > 0, conns: this.conns.size });
    }

    return new Response('OneBotBridge', { status: 200 });
  }

  _onMessage(ws, event) {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    const echo = msg.echo;
    if (echo && this.pending.has(echo)) {
      const { resolve, timer } = this.pending.get(echo);
      clearTimeout(timer);
      this.pending.delete(echo);
      resolve(msg);
    }
  }

  /**
   * 发送 OneBot 11 API 调用并等待响应
   * @returns {Promise<{ok:boolean, code:number, message:string, data?:any}>}
   */
  async sendOneBot(action, params, timeoutMs = 8000) {
    if (this.conns.size === 0) {
      return { ok: false, code: -1000, message: 'OneBot 未连接' };
    }

    const echo = `w${++this.seq}_${Date.now()}`;
    const frame = JSON.stringify({ action, params, echo });

    const result = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        resolve({ ok: false, code: -1001, message: '发送超时' });
      }, timeoutMs);
      this.pending.set(echo, { resolve, timer });
    });

    let sent = false;
    for (const ws of this.conns) {
      try { ws.send(frame); sent = true; } catch { /* 连接失效，跳过 */ }
    }
    if (!sent) {
      this.pending.delete(echo);
      return { ok: false, code: -1002, message: '发送失败' };
    }

    const resp = await result;
    if (!resp.ok) return resp;

    return {
      ok: resp.status === 'ok' || resp.retcode === 0,
      code: resp.retcode ?? -1,
      message: resp.message || '',
      data: resp.data
    };
  }
}