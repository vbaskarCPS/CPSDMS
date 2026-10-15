import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/sessionService', () => ({ sessionService: { getEmptyStats: () => ({ stepCount: 0 }) } }));
import { giveSoloCart } from './startSession';

/** A tiny stand-in for the old app's database client: records inserts and updates. */
function fakeDb(state: { day: boolean; carts: string[]; metadata: Record<string, unknown> }) {
  const writes: { table: string; op: string; row: unknown }[] = [];
  const q = (table: string) => {
    const chain: Record<string, unknown> = {};
    const result = () => {
      if (table === 'daily_sessions') return { data: state.day ? { date: 'd' } : null, error: null };
      if (table === 'logsheet_sessions') return { data: state.carts.map(id => ({ id })), error: null };
      if (table === 'users') return { data: { metadata: state.metadata }, error: null };
      return { data: null, error: null };
    };
    Object.assign(chain, {
      select: () => chain, eq: () => chain, contains: () => chain,
      maybeSingle: async () => result(),
      then: (res: (v: unknown) => void) => res(result()),
      insert: async (row: unknown) => { writes.push({ table, op: 'insert', row }); return { error: null }; },
      update: (row: unknown) => { writes.push({ table, op: 'update', row }); return { eq: () => ({ eq: async () => ({ error: null }) }) }; },
    });
    return chain;
  };
  return { client: { from: q } as never, writes };
}

describe('late arrival gets a cart of their own', () => {
  it('on a live day with no cart: a solo cart, keyed to them', async () => {
    const { client, writes } = fakeDb({ day: true, carts: [], metadata: { assignedManagerId: 'rm_chad', teamId: '8' } });
    await giveSoloCart(client, 'cc', 'I1219', '2026-10-15');
    const cart = writes.find(w => w.table === 'logsheet_sessions')!.row as Record<string, unknown>;
    expect(cart).toMatchObject({ worker_id: 'I1219', team_worker_ids: ['I1219'], date: '2026-10-15', status: 'OPEN', equiv_split: { I1219: 100 } });
    expect(writes.find(w => w.table === 'users')!.row).toEqual({ metadata: { assignedManagerId: 'rm_chad', teamId: 'I1219' } });
  });
  it('already on a cart today: nothing changes', async () => {
    const { client, writes } = fakeDb({ day: true, carts: ['sess_5'], metadata: {} });
    await giveSoloCart(client, 'cc', 'I1219', '2026-10-15');
    expect(writes).toEqual([]);
  });
  it('day not started yet: nothing (Start session makes the carts)', async () => {
    const { client, writes } = fakeDb({ day: false, carts: [], metadata: {} });
    await giveSoloCart(client, 'cc', 'I1219', '2026-10-15');
    expect(writes).toEqual([]);
  });
});
