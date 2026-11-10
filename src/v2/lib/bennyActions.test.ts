import { describe as d, it, expect } from 'vitest';
import { buildBennyPlan, describe, type StartDayCheck } from './bennyActions';
import { planProblems } from './startSession';
import { defaultRateCard } from './rateCard';
import type { RosterRow } from './workerbook';

const row = (id: string, first: string, team: string | null = null, attendance: 'showed' | 'no_show' | null = null): RosterRow => ({
  id: 'r' + id, day_id: 'd', hire_id: id, shuttle: null, manager_id: null, team, confirmed_at: null, confirmed_via: null, attendance,
  next_day: null, notes: null,
  hire: { id, cn: 'I' + id, person: { first_name: first, last_name: 'X' } } as unknown as RosterRow['hire'],
});
const mgrs = [{ id: 'm1', full_name: 'Franklyn Mitchell', username: 'mitfr', phone: null }, { id: 'm2', full_name: 'Jovan Chung', username: 'chujo', phone: null }];
const check = (pair = false, two = false): StartDayCheck => ({
  ok: true, date: '2026-11-11', day_id: 'd', pair, booked: 5, showed: 4, teams: 1, no_team: 2, open_prebooks: 3, maps: ['NORTH VANCOUVER #1'],
  assign: two
    ? [{ managers: [{ id: 'm1', name: 'Franklyn Mitchell' }], routes: [{ code: 'NVN07', area: 'NORTH VANCOUVER #1', number: 7 }] },
       { managers: [{ id: 'm2', name: 'Jovan Chung' }], routes: [{ code: 'NVN19', area: 'NORTH VANCOUVER #2', number: 19 }] }]
    : [{ managers: pair ? [{ id: 'm1', name: 'Franklyn Mitchell' }, { id: 'm2', name: 'Jovan Chung' }] : [{ id: 'm1', name: 'Franklyn Mitchell' }],
         routes: [{ code: 'NVN07', area: 'NORTH VANCOUVER #1', number: 7 }, { code: 'NVN08', area: 'NORTH VANCOUVER #1', number: 8 }] }],
});
const roster = [row('1', 'Ann', 'A'), row('2', 'Bob', 'A'), row('3', 'Cal'), row('4', 'Dee'), row('5', 'Eve', null, 'no_show')];
const card = defaultRateCard('lawn_rejuv', { name: 'GST', rate: 5 });

d('buildBennyPlan', () => {
  it('roster mode keeps roster carts and gives the rest their own; no-shows stay off', () => {
    const p = buildBennyPlan(check(), 'roster', roster, mgrs, card, 'lawn_rejuv', 2026);
    expect(p.teams.map(t => t.name)).toEqual(['A', '1', '2']);
    expect(p.members).toEqual({ 1: 'A', 2: 'A', 3: '1', 4: '2' });
    expect(p.showed.has('5')).toBe(false);
    expect(p.routes.every(r => r.managerId === 'm1')).toBe(true);
    expect(planProblems(p)).toEqual([]);
  });
  it('solo mode: everyone on their own cart', () => {
    const p = buildBennyPlan(check(), 'solo', roster, mgrs, card, 'lawn_rejuv', 2026);
    expect(p.teams).toHaveLength(4);
    expect(planProblems(p)).toEqual([]);
  });
  it('pairs mode: two to a cart, odd one alone', () => {
    const p = buildBennyPlan(check(), 'pairs', [...roster, row('6', 'Fay')], mgrs, card, 'lawn_rejuv', 2026);
    expect(p.teams).toHaveLength(3);
    expect(Object.values(p.members).filter(t => t === p.teams[0].name)).toHaveLength(2);
  });
  it('paired managers share; unpaired managers take carts in turn', () => {
    const paired = buildBennyPlan(check(true), 'solo', roster, mgrs, card, 'lawn_rejuv', 2026);
    expect(paired.pairs).toEqual([['m1', 'm2']]);
    const two = buildBennyPlan(check(false, true), 'solo', roster, mgrs, card, 'lawn_rejuv', 2026);
    expect(two.teams.map(t => t.managerId)).toEqual(['m1', 'm2', 'm1', 'm2']);
    expect(two.routes.map(r => r.managerId)).toEqual(['m1', 'm2']);
    expect(planProblems(two)).toEqual([]);
  });
  it('a manager no longer available is left out', () => {
    const p = buildBennyPlan(check(true), 'solo', roster, [mgrs[0]], card, 'lawn_rejuv', 2026);
    expect(p.pairs).toBeUndefined();
    expect(planProblems(p)).toEqual([]);
  });
});

d('describe', () => {
  it('start day card', () => {
    const c = describe({ kind: 'start_day', check: check(), team_mode: 'roster' });
    expect(c.action).toBe('Start the day');
    expect(c.lines[0]).toBe('Manager: Franklyn Mitchell, solo');
    expect(c.lines[1]).toBe('Routes: NORTH VANCOUVER #1 (2)');
  });
  it('give route and partner cards', () => {
    const g = describe({ kind: 'give_route', check: { ok: true, date: '2026-11-10', route: 'NDEL33', map: 'NORTH DELTA #2', open_prebooks: 1,
      worker: { cn: 'I1065', name: 'Kyle Pitt' }, cart: [{ cn: 'I1065', name: 'Kyle Pitt' }] } });
    expect(g.title).toBe('Give NDEL33 to Kyle’s cart');
    expect(g.lines[1]).toBe('1 prebook on NDEL33');
    const p = describe({ kind: 'partner', check: { ok: true, date: '2026-11-10', a: { cn: 'I1002', name: 'Nathan Clark', cart_id: 's3' },
      b: { cn: 'I1013', name: 'Michael Asiegbunam', cart_id: 's10' }, carts: { s3: ['Nathan Clark'] } } });
    expect(p.title).toBe('Partner Michael with Nathan');
    expect(p.lines[0]).toBe('Michael Asiegbunam joins Nathan Clark’s cart');
  });
});
