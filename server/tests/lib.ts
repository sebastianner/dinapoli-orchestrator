/* Shared helpers for the Dinapoli POS audit scripts. */
import WebSocket from 'ws';

export const BASE = process.env.AUDIT_BASE ?? 'http://localhost:3999';
export const WS_URL = BASE.replace('http', 'ws') + '/ws/orders';

// ---------------------------------------------------------------------------
// Cookie-jar HTTP client (the API is cookie-session based)
// ---------------------------------------------------------------------------

export class Client {
  private cookies = new Map<string, string>();

  async request(method: string, path: string, body?: unknown): Promise<{ status: number; body: any; headers: Headers }> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.cookies.size > 0 ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const idx = pair.indexOf('=');
      this.cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
    const text = await res.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch { /* keep raw */ }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  get = (p: string) => this.request('GET', p);
  post = (p: string, b?: unknown) => this.request('POST', p, b);
  put = (p: string, b?: unknown) => this.request('PUT', p, b);
  del = (p: string, b?: unknown) => this.request('DELETE', p, b);

  async loginAdmin(employeeId: number, password: string) {
    const r = await this.post('/api/auth/login', { employeeId, password });
    if (r.status !== 200) throw new Error(`admin login failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
  async loginStaff(employeeId: number) {
    const r = await this.post('/api/auth/login', { employeeId });
    if (r.status !== 200) throw new Error(`staff login failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

// ---------------------------------------------------------------------------
// WebSocket order terminal
// ---------------------------------------------------------------------------

export interface WsReply { type: string; order?: any; message?: string; orderId?: number }

/** One simulated POS terminal: a persistent /ws/orders connection that can place orders and observe broadcasts. */
export class Terminal {
  private ws!: WebSocket;
  private pending: ((r: WsReply) => void)[] = [];
  broadcasts: WsReply[] = [];
  name: string;

  constructor(name: string) { this.name = name; }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as WsReply;
        if (msg.type === 'connected') return;
        // Broadcasts (order_updated / tables_updated) are pushed to every client
        // and are NOT replies to this socket's own request - keep them separate.
        if (msg.type === 'order_updated' || msg.type === 'tables_updated') {
          this.broadcasts.push(msg);
          return;
        }
        const resolver = this.pending.shift();
        if (resolver) resolver(msg);
      });
    });
  }

  /** Places one order and waits for this socket's own ack (order_created | error). */
  place(request: unknown, timeoutMs = 20000): Promise<WsReply> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name}: WS reply timeout`)), timeoutMs);
      this.pending.push((r) => { clearTimeout(timer); resolve(r); });
      this.ws.send(JSON.stringify(request));
    });
  }

  close() { this.ws.close(); }
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

export interface Finding { level: 'FAIL' | 'WARN'; test: string; detail: string }

export const results = { passed: 0, failed: 0, warned: 0, findings: [] as Finding[] };

export function check(name: string, condition: boolean, detail = ''): boolean {
  if (condition) {
    results.passed++;
    console.log(`  PASS  ${name}`);
    return true;
  }
  results.failed++;
  results.findings.push({ level: 'FAIL', test: name, detail });
  console.log(`  FAIL  ${name}${detail ? ` :: ${detail}` : ''}`);
  return false;
}

export function warn(name: string, detail: string): void {
  results.warned++;
  results.findings.push({ level: 'WARN', test: name, detail });
  console.log(`  WARN  ${name} :: ${detail}`);
}

export function eq(name: string, actual: unknown, expected: unknown): boolean {
  return check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

export function summary(): void {
  console.log(`\n---------------------------------------------`);
  console.log(`passed=${results.passed} failed=${results.failed} warned=${results.warned}`);
  if (results.findings.length) {
    console.log(`\nFINDINGS:`);
    for (const f of results.findings) console.log(`  [${f.level}] ${f.test}\n         ${f.detail}`);
  }
}

// ---------------------------------------------------------------------------
// Order-shape builders
// ---------------------------------------------------------------------------

export const pizza = (size: string, flavors: { flavor: string; portion: number }[], extra: Record<string, unknown> = {}) =>
  ({ type: 'pizza', size, flavors, quantity: 1, ...extra });

export const product = (category: string, product: string, extra: Record<string, unknown> = {}) =>
  ({ type: 'product', category, product, quantity: 1, ...extra });

export function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Polls GET /api/orders/:id until it reaches `status` (the queue worker is
 * async). Tolerates transient connection errors: a long synchronous block in
 * the server (see print-blocking.ts) can outlive Node's 5s keep-alive timeout,
 * which resets idle sockets the moment the loop frees up - a polling helper
 * should retry that, not fail the suite over it.
 */
export async function waitForStatus(client: Client, orderId: number, status: string, timeoutMs = 15000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    try {
      const r = await client.get(`/api/orders/${orderId}`);
      last = r.body;
      if (last?.status === status) return last;
    } catch {
      // connection reset mid-block - retry
    }
    await sleep(150);
  }
  throw new Error(`order ${orderId} never reached ${status} (last=${last?.status})`);
}
