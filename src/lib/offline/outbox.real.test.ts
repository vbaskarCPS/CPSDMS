// The real sale code (sessionService + fieldWrites) against a fake Supabase server, in a dead zone.
import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, String(v)), removeItem: (k: string) => mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 });

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const log: { method: string; table: string }[] = [];
let mode: 'ok' | 'dead' | 'lostAnswer' = 'ok';

function table(url: URL) { const m = url.pathname.match(/\/rest\/v1\/([^/?]+)/); return m ? m[1] : url.pathname; }
function matches(row: Row, url: URL) {
  for (const [k, v] of url.searchParams) {
    if (['select', 'limit', 'order', 'columns', 'on_conflict'].includes(k)) continue;
    const [op, val] = [v.slice(0, v.indexOf('.')), v.slice(v.indexOf('.') + 1)];
    if (op === 'eq' && String(row[k]) !== val) return false;
  }
  return true;
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

async function server(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const method = (init?.method || 'GET').toUpperCase();
  const t = table(url);
  if (mode === 'dead') throw new TypeError('Failed to fetch');
  log.push({ method, table: t });
  const rows = (db[t] ??= []);
  const single = String((init?.headers as Record<string, string> | undefined)?.Accept ?? (init?.headers as Headers | undefined)?.get?.('Accept') ?? '').includes('vnd.pgrst.object');
  let res: Response;
  if (t === 'daily_sessions') res = single ? json({ date: '2026-10-30' }) : json([{ date: '2026-10-30' }]);
  else if (method === 'GET') { const f = rows.filter(r => matches(r, url)); res = single ? (f[0] ? json(f[0]) : json({ code: 'PGRST116', message: '0 rows' }, 406)) : json(f); }
  else if (method === 'POST') {
    const body = JSON.parse(String(init?.body)); const list = Array.isArray(body) ? body : [body];
    if (list.some(b => rows.some(r => r.id === b.id))) res = json({ code: '23505', message: 'duplicate key' }, 409);
    else { rows.push(...list); res = single ? json(list[0], 201) : json(list, 201); }
  } else if (method === 'PATCH') { const body = JSON.parse(String(init?.body)); rows.filter(r => matches(r, url)).forEach(r => Object.assign(r, body)); res = json([]); }
  else if (method === 'DELETE') { db[t] = rows.filter(r => !matches(r, url)); res = json([]); }
  else res = json({});
  if (mode === 'lostAnswer' && method !== 'GET') { mode = 'dead'; throw new TypeError('Failed to fetch'); }   // it landed; the answer didn't
  return res;
}

let svc: typeof import('../sessionService').sessionService;
let ob: typeof import('./outbox');
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(server));
  localStorage.setItem('current_command_center', JSON.stringify({ id: 'cc1', name: 'Test', region: 'ON' }));
  svc = (await import('../sessionService')).sessionService;
  ob = await import('./outbox');
  await import('./fieldWrites');
  const day = await import('./dayStore'); const cache = await import('./cache');
  await day.beginDay('2026-10-30', 'worker:w1'); cache.setReadMode('phoneFirst');
  ob._setSendWait(300);
});
beforeEach(async () => { for (const k of Object.keys(db)) delete db[k]; log.length = 0; mode = 'ok'; (await import('./net')).markOnline(); });
const settle = async () => { mode = mode === 'dead' ? 'ok' : mode; (await import('./net')).markOnline(); await ob.flush(); };

const tx = (id: string, extra: Row = {}) => ({
  id, timestamp: '2026-10-30T15:00:00Z', type: 'sale', price: 120, paymentMethod: 'Cash', displayPrice: '$120.00',
  customerName: 'Ann Lee', address: '12 Elm St', routeCode: 'R1', items: [], services: [], ...extra,
}) as never;

describe('real sales through the outbox', () => {
  it('a pending sale saved with no signal is instant, then lands once with the phone’s id', async () => {
    mode = 'dead';
    const p = await svc.createPendingSale({ sessionId: 's1', workerId: 'w1', houseNumber: '12', streetName: 'Elm St', price: '120' } as never);
    expect(p.id).toMatch(/^pend_w1_/);
    expect(ob.waitingCount()).toBe(1);
    await settle(); await settle();
    expect(ob.waitingCount()).toBe(0);
    expect(db.pending_sales.map(r => r.id)).toEqual([p.id]);
  });

  it('a cash sale that landed but whose answer was lost is sent again safely: one sale, one receipt', async () => {
    mode = 'lostAnswer';
    await svc.completeJob(tx('tx_1', { customerEmail: 'ann@example.com' }), 'NEW-1', 'w1');
    expect(ob.waitingCount()).toBe(1);
    expect(db.transactions).toHaveLength(1);              // it did land
    await settle();
    expect(ob.waitingCount()).toBe(0);
    expect(db.transactions).toHaveLength(1);              // and the repeat updated it rather than adding another
    const receipts = log.filter(l => /receipt|email/i.test(l.table));
    expect(receipts.length).toBeLessThanOrEqual(0);       // receipt not re-sent on the repeat
  });

  it('a card number never goes on the phone or to the server', async () => {
    mode = 'dead';
    await svc.completeJob(tx('tx_2', { paymentMethod: 'Credit Card', ccFullNumber: '4111111111111111', ccExpiry: '12/29', ccCVC: '123' }), 'NEW-2', 'w1');
    const day = await import('./dayStore');
    expect(JSON.stringify(await day.outboxAll())).not.toMatch(/4111111111111111|"123"/);
    await settle();
    expect(JSON.stringify(db.transactions)).not.toMatch(/4111111111111111/);
    expect(db.transactions).toHaveLength(1);
  });

  it('saves keep their order: a pending sale then its completion', async () => {
    mode = 'dead';
    const p = await svc.createPendingSale({ sessionId: 's1', workerId: 'w1', houseNumber: '9', streetName: 'Oak', price: '90' } as never);
    await svc.completeJob(tx('tx_3'), 'NEW-3', 'w1', undefined, p.id);
    expect(ob.waitingCount()).toBe(2);
    await settle(); await new Promise(r => setTimeout(r, 50)); await settle();
    expect(ob.waitingCount()).toBe(0);
    expect(db.transactions.map(r => r.id)).toEqual(['tx_3']);
    expect((db.pending_sales || []).find(r => r.id === p.id)).toBeUndefined();
  });
});
