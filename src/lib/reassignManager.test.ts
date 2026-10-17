// Moving a worker onto another cart (Manage team): they join that cart's manager's team too.
// A floater sees every manager's carts, so the cart can belong to someone else.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
const CC = 'cc1';

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: 'select' | 'update' | 'delete' | 'insert' = 'select'; let payload: any = null; let one: 'single' | 'maybe' | null = null;
  const rows = () => (db[table] ||= []);
  const q: any = {
    select: () => q, order: () => q, limit: () => q,
    eq: (c: string, v: any) => { filters.push(r => r[c] === v); return q; },
    in: (c: string, vs: any[]) => { filters.push(r => vs.includes(r[c])); return q; },
    contains: (c: string, vs: any[]) => { filters.push(r => vs.every(v => (r[c] || []).includes(v))); return q; },
    update: (p: any) => { op = 'update'; payload = p; return q; },
    delete: () => { op = 'delete'; return q; },
    insert: (p: any) => { op = 'insert'; payload = p; return q; },
    single: () => { one = 'single'; return q; }, maybeSingle: () => { one = 'maybe'; return q; },
    then: (res: (v: any) => any, rej?: (e: any) => any) => {
      const hit = rows().filter(r => filters.every(f => f(r)));
      let data: any = hit;
      if (op === 'update') hit.forEach(r => Object.assign(r, structuredClone(payload)));
      if (op === 'delete') db[table] = rows().filter(r => !hit.includes(r));
      if (op === 'insert') (Array.isArray(payload) ? payload : [payload]).forEach(p => rows().push(structuredClone(p)));
      if (one) data = hit[0] ? structuredClone(hit[0]) : null;
      else if (op === 'select') data = structuredClone(hit);
      return Promise.resolve({ data, error: one === 'single' && !hit[0] ? { message: 'none' } : null }).then(res, rej);
    },
  };
  return q;
}
vi.mock('./supabase', () => ({ supabase: { from: (t: string) => query(t), rpc: async () => ({ data: null, error: null }) } }));
vi.mock('./commandCenterService', async (orig) => {
  const real = await orig<any>();
  return { ...real, commandCenterService: { ...real.commandCenterService, getCurrentCommandCenterId: () => CC, getCurrentTaxRate: () => 13 } };
});

const user = (id: string, mgr: string, team: string) => ({ user_id: id, command_center_id: CC, role: 'Worker', metadata: { assignedManagerId: mgr, teamId: team, phone: 'x' } });
const cart = (id: string, ids: string[]) => ({ id, worker_id: ids[0], team_worker_ids: ids, date: '2026-10-17', command_center_id: CC, status: 'OPEN', stats: {},
  equiv_split: Object.fromEntries(ids.map(i => [i, 100 / ids.length])), upsell_split: Object.fromEntries(ids.map(i => [i, 100 / ids.length])) });

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  db.daily_sessions = [{ date: '2026-10-17', is_active: true, command_center_id: CC }];
  db.users = [user('MUG', 'rm_afeez', '13'), user('VID', 'rm_chad', '8'), user('HAS', 'rm_chad', '8')];
  db.logsheet_sessions = [cart('s13', ['MUG']), cart('s8', ['HAS', 'VID'])];
  db.routes = []; db.route_splits = []; db.bookings = [];
});

describe('moving a worker onto another manager\'s cart', () => {
  it('the worker joins that manager\'s team, cart and team key', async () => {
    const { sessionService } = await import('./sessionService');
    await sessionService.reassignWorker('VID', { type: 'existing_cart', targetSessionId: 's13' });
    const vid = db.users.find(u => u.user_id === 'VID')!;
    expect(vid.metadata.assignedManagerId).toBe('rm_afeez');
    expect(vid.metadata.teamId).toBe('13');
    expect(vid.metadata.phone).toBe('x');
    expect(db.logsheet_sessions.find(s => s.id === 's13')!.team_worker_ids).toEqual(['MUG', 'VID']);
    expect(db.logsheet_sessions.find(s => s.id === 's8')!.team_worker_ids).toEqual(['HAS']);
    expect(db.users.find(u => u.user_id === 'HAS')!.metadata.assignedManagerId).toBe('rm_chad');
  });
  it('a move within the same manager\'s carts leaves the manager alone', async () => {
    db.users.push(user('ASH', 'rm_chad', '9')); db.logsheet_sessions.push(cart('s9', ['ASH']));
    const { sessionService } = await import('./sessionService');
    await sessionService.reassignWorker('VID', { type: 'existing_cart', targetSessionId: 's9' });
    expect(db.users.find(u => u.user_id === 'VID')!.metadata.assignedManagerId).toBe('rm_chad');
  });
});
