import { describe, it, expect } from 'vitest';
import { buildLegacySession, groupOf, legacyManagerId, mappingsFor, nextTeamName, pairManagers, planProblems, formatPhone, unpairManager, type Plan } from './startSession';
import { cartManager, salesByManager } from './payoutCarts';
import { defaultRateCard } from './rateCard';
import type { RosterRow } from './workerbook';

const CENTER = 'e76a19fd-0000-0000-0000-000000000000';
const cheryl = { id: 'u-cheryl', full_name: 'Cheryl Merrick', username: 'merch', phone: '9059712805' };
const chad = { id: 'u-chad', full_name: 'Chad Stevens', username: 'stech', phone: null };

const person = (first: string, last: string, extra: Partial<RosterRow['hire']['person']> = {}) => ({
  id: `p-${first}`, first_name: first, last_name: last, cell_phone: '780 600 0522', alt_phone: null, email: null, address: null,
  first_year: 2026, lifetime_days: 10, hats: { AER: 0, RJ: 0, SE: 0, CL: 0 }, notes: null, ...extra,
});
const row = (hireId: string, cn: string, p: ReturnType<typeof person>): RosterRow => ({
  id: `r-${hireId}`, day_id: 'd1', hire_id: hireId, shuttle: null, manager_id: null, team: null, confirmed_at: null, confirmed_via: null,
  attendance: null, next_day: null, notes: null,
  hire: { id: hireId, person_id: p.id, center_id: CENTER, year: 2026, cn, shuttle: null, status: 'active', status_since: null, ns_count: 0,
    alumni_rate: null, silver_rate: null, pin_set_at: null, person: p },
});

const roster = [
  row('h1', 'I1004', person('Jahswill', 'Nuetey', { first_year: 2025, lifetime_days: 332, hats: { AER: 9, RJ: 0, SE: 4, CL: 0 } })),
  row('h2', 'I1225', person('Chris', 'Hinch', { first_year: 2026, lifetime_days: 88, hats: { AER: 2, RJ: 0, SE: 0, CL: 0 } })),
  row('h3', 'I1065', person('Kyle', 'Pitt', { first_year: 2025, lifetime_days: 28 })),
  row('h4', 'I1453', person('Mugove', 'Chipfurutse')),
];

const basePlan = (): Plan => ({
  date: '2026-10-07', seasonYear: 2026, card: defaultRateCard('sealing', { name: 'HST', rate: 13 }),
  managers: [cheryl, chad],
  routes: [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ code: `GA0${n}`, area: 'GLEN ABBEY #1', number: n, managerId: 'u-cheryl' })),
    { code: 'WO23', area: 'WEST OAKS TRAILS #2', number: 23, managerId: 'u-chad' },
  ],
  teams: [{ name: '1', kind: 'cart', managerId: 'u-cheryl' }, { name: 'RC1', kind: 'ramp', managerId: 'u-chad' }],
  members: { h1: '1', h2: '1', h3: 'RC1' },
  showed: new Set(['h1', 'h2', 'h3']),
  roster, settings: { service: 'sealing', productCostPercent: 0, emailReceipts: true, liveCard: true, noTaxOnCash: false },
});

describe('start session → the old app’s session data', () => {
  it('names managers the old way', () => {
    expect(legacyManagerId('Cheryl Merrick')).toBe('rm_cherylmerrick');
  });

  it('builds the same digital-map config the RM map reads (Glen Abbey #1 = GA01–GA08)', () => {
    expect(mappingsFor(basePlan().routes.filter(r => r.managerId === 'u-cheryl'))).toEqual([
      { areaName: 'GLEN ABBEY #1', prefix: 'GA', routeStart: 1, routeEnd: 8, routeCodes: ['GA01', 'GA02', 'GA03', 'GA04', 'GA05', 'GA06', 'GA07', 'GA08'] },
    ]);
  });

  it('numbers carts 1, 2… and ramp crews RC1, RC2…', () => {
    expect(nextTeamName([{ name: '1', kind: 'cart', managerId: 'x' }], 'cart')).toBe('2');
    expect(nextTeamName([{ name: 'RC1', kind: 'ramp', managerId: 'x' }], 'ramp')).toBe('RC2');
  });

  it('is ready when everyone who showed has a team', () => {
    expect(planProblems(basePlan())).toEqual([]);
  });

  it('lists what blocks Start', () => {
    const p = basePlan();
    p.showed.add('h4');
    p.teams.push({ name: '2', kind: 'cart', managerId: 'u-cheryl' });
    p.routes = [];
    const errs = planProblems(p);
    expect(errs).toContain('Pick at least one route.');
    expect(errs.some(e => e.includes('no team: Mugove Chipfurutse'))).toBe(true);
    expect(errs.some(e => e.includes('nobody in it: 2'))).toBe(true);
  });

  it('produces workers, carts, routes and meta like Import from Sheets', () => {
    const { data, meta } = buildLegacySession(basePlan(), CENTER);
    expect(data.date).toBe('2026-10-07');
    expect(data.seasonType).toBe('sealing');
    expect(data.pendingBookings).toEqual([]);
    expect(data.managers.map(m => [m.userId, m.username, m.phone])).toEqual([
      ['rm_cherylmerrick', 'merch', '(905) 971-2805'], ['rm_chadstevens', 'stech', ''],
    ]);
    expect(data.managers[0].digitalMapping?.routeCodes).toHaveLength(8);
    expect(data.managers[1].digitalMappings?.[0].areaName).toBe('WEST OAKS TRAILS #2');

    // only people who showed; Mugove (not ticked) is left out
    expect(data.workers.map(w => w.contractorId)).toEqual(['I1004', 'I1225', 'I1065']);
    const jahswill = data.workers[0];
    expect(jahswill).toMatchObject({ firstName: 'Jahswill', teamId: '1', assignedManagerId: 'rm_cherylmerrick', cellPhone: '(780) 600-0522' });
    expect(jahswill.alumniRate).toBe(0.5);   // year 2, 332 days → +$0.50 (sheet: IF(A, >=200 → 0.5))
    expect(jahswill.silverRate).toBe(0.5);   // 4 SE Silver Hats → +$0.50
    expect(data.workers[1].alumniRate).toBe(0); // first-year: no Alumni yet
    expect(data.workers[2]).toMatchObject({ teamId: 'RC1', assignedManagerId: 'rm_chadstevens' });

    expect(data.teamCarts).toEqual([
      expect.objectContaining({ teamId: '1', workerIds: ['I1004', 'I1225'] }),
      expect.objectContaining({ teamId: 'RC1', workerIds: ['I1065'] }),
    ]);
    expect(data.routes.find(r => r.routeCode === 'WO23')).toMatchObject({ managerId: 'rm_chadstevens', assignedWorkerIds: [] });
    expect(meta).toEqual({ source: 'app', sheetsExported: false, seasonType: 'sealing', productCostPercent: 0, liveCardProcessingEnabled: true, noTaxOnCash: false });
  });

  it('formats phones like the old import', () => {
    expect(formatPhone('3433696979')).toBe('(343) 369-6979');
    expect(formatPhone('+1 226 387 8803')).toBe('(226) 387-8803');
  });
});

describe('Alumni rate on the live map counts app days too', () => {
  it('days before the app + days showed in the app before this day', () => {
    const kyle = (p: Plan) => buildLegacySession(p, CENTER).data.workers.find(w => w.contractorId === 'I1065')!;
    const plan = basePlan();
    expect(kyle(plan).alumniRate).toBe(0);                                         // 28 days: under 50
    expect(kyle({ ...plan, appDaysBefore: { h3: 22 } }).alumniRate).toBe(0.25);   // 28 + 22 = 50
  });
});

describe('paired managers', () => {
  const dana = { id: 'u-dana', full_name: 'Dana Lee', username: 'leeda', phone: null };
  it('pairs by dragging one onto another, and splits again', () => {
    let p = pairManagers([], 'u-chad', 'u-cheryl');
    expect(p).toEqual([['u-cheryl', 'u-chad']]);
    p = pairManagers(p, 'u-dana', 'u-chad');                   // onto anyone in the pair joins the group
    expect(p).toEqual([['u-cheryl', 'u-chad', 'u-dana']]);
    expect(groupOf(p, 'u-dana')).toEqual(['u-cheryl', 'u-chad', 'u-dana']);
    expect(groupOf(p, 'u-nobody')).toEqual(['u-nobody']);
    expect(unpairManager(p, 'u-chad')).toEqual([['u-cheryl', 'u-dana']]);
    expect(unpairManager(unpairManager(p, 'u-chad'), 'u-dana')).toEqual([]);   // one left on their own is no longer a pair
    expect(pairManagers(p, 'u-chad', 'u-cheryl')).toBe(p);                      // already together
  });
  it('gives each partner the group’s maps, and lets them see each other’s team (floater)', () => {
    const plan = { ...basePlan(), managers: [cheryl, chad, dana], pairs: [['u-cheryl', 'u-chad']] };
    const { data } = buildLegacySession(plan, CENTER);
    const ch = data.managers.find(m => m.name === 'Cheryl Merrick')!, cs = data.managers.find(m => m.name === 'Chad Stevens')!;
    expect(ch.floatingFor).toEqual(['rm_chadstevens']);
    expect(cs.pairedWith).toEqual(['rm_cherylmerrick']);
    expect(ch.digitalMappings!.map(m => m.areaName).sort()).toEqual(['GLEN ABBEY #1', 'WEST OAKS TRAILS #2']);
    expect(cs.digitalMappings!.map(m => m.areaName).sort()).toEqual(['GLEN ABBEY #1', 'WEST OAKS TRAILS #2']);
    expect(data.managers.some(m => m.name === 'Dana Lee')).toBe(false);          // not on the day
    // a partner with nothing in their own name still comes on the day
    const solo = buildLegacySession({ ...plan, teams: plan.teams.map(t => ({ ...t, managerId: 'u-cheryl' })), routes: plan.routes.map(r => ({ ...r, managerId: 'u-cheryl' })) }, CENTER);
    expect(solo.data.managers.map(m => m.name).sort()).toEqual(['Chad Stevens', 'Cheryl Merrick']);
  });
  it('a paired manager who isn’t available stops Start', () => {
    expect(planProblems({ ...basePlan(), pairs: [['u-cheryl', 'u-gone']] }).some(e => e.includes('paired manager'))).toBe(true);
  });
});

describe('shared teams’ sales', () => {
  it('credits a shared cart to every partner, and splits its sales evenly', () => {
    const users = new Map<string, { name?: string; metadata?: { pairedWith?: unknown } }>([
      ['rm_jovanchung', { name: 'Jovan Chung', metadata: { pairedWith: ['rm_franklynmitchell'] } }],
      ['rm_franklynmitchell', { name: 'Franklyn Mitchell', metadata: { pairedWith: ['rm_jovanchung'] } }],
      ['rm_solo', { name: 'Sam Solo' }],
    ]);
    expect(cartManager(users, 'rm_jovanchung')).toBe('Franklyn Mitchell & Jovan Chung');
    expect(cartManager(users, 'rm_solo')).toBe('Sam Solo');
    expect(cartManager(users, null)).toBeNull();
    const by = salesByManager([
      { manager: 'Franklyn Mitchell & Jovan Chung', sales: [{ price: 300 }, { price: 101 }] },
      { manager: 'Sam Solo', sales: [{ price: 150 }] },
      { manager: 'Jovan Chung', sales: [{ price: 50 }] },
    ]);
    expect(by).toEqual([{ manager: 'Jovan Chung', sales: 250.5 }, { manager: 'Franklyn Mitchell', sales: 200.5 }, { manager: 'Sam Solo', sales: 150 }]);
  });
});
