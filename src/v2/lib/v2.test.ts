// Unit tests for the new app's pure logic. Run: npm run test:v2
import { describe, it, expect } from 'vitest';
import { usernameBase, SUPER_ADMIN_PERMISSIONS, type Permission } from './permissions';
import { defaultRateCard, stepAmount, alumniRate, silverRate, cardFor, validateRateCard } from './rateCard';
import { visibleComponents, findByPath, COMPONENTS } from '../app/nav';

describe('usernameBase (matches the SQL app_make_username and RM logins)', () => {
  it('takes the last 3 of the last name + first 2 of the first name', () => {
    expect(usernameBase('Vijay Baskaran')).toBe('basvi');
    expect(usernameBase('Cheryl Merrick')).toBe('merch');
    expect(usernameBase('Chad Stevens')).toBe('stech');
  });
  it('handles middle names, punctuation and short names', () => {
    expect(usernameBase('Mary Ann O\'Neil')).toBe('annma');
    expect(usernameBase('Al Wu')).toBe('wuxal');
    expect(usernameBase('Cher')).toBe('chech');
  });
});

describe('rate card maths', () => {
  const se = defaultRateCard('sealing', { name: 'HST', rate: 13 });

  it('steps pick the highest reached amount', () => {
    const steps = [{ at: 4, amount: 0.5 }, { at: 2, amount: 0.25 }];
    expect(stepAmount(steps, 1)).toBe(0);
    expect(stepAmount(steps, 2)).toBe(0.25);
    expect(stepAmount(steps, 9)).toBe(0.5);
  });

  it('Alumni: year 2+, +$0.25 at 50 lifetime days, +$0.50 at 200', () => {
    expect(alumniRate(se, 1, 300)).toBe(0);
    expect(alumniRate(se, 2, 49)).toBe(0);
    expect(alumniRate(se, 2, 50)).toBe(0.25);
    expect(alumniRate(se, 3, 200)).toBe(0.5);
  });

  it('Silver: 2/4/6/8 hats in the service = +$0.25/0.50/0.75/1.00', () => {
    expect([1, 2, 4, 6, 8, 20].map(h => silverRate(se, h))).toEqual([0, 0.25, 0.5, 0.75, 1, 1]);
  });

  it('hat thresholds follow PayoutToday', () => {
    expect(se.hats.individual).toEqual({ green: 30, gold: 40, silver: 50 });
    expect(se.hats.teamOf1).toEqual({ green: 40, gold: 60, silver: 80 });
  });

  it('defaults validate cleanly for every service', () => {
    for (const s of ['aeration', 'lawn_rejuv', 'sealing', 'cleaning'] as const)
      expect(validateRateCard(defaultRateCard(s, { name: 'GST', rate: 5 }))).toEqual([]);
  });

  it('validation catches bad input', () => {
    const bad = { ...se, eqDivisor: 0, productCostPercent: 120, upgradeSplit: { upsell: 0.5, production: 0.4 } };
    const errs = validateRateCard(bad);
    expect(errs).toContain('EQ divisor must be more than 0');
    expect(errs).toContain('Product cost must be 0–100%');
    expect(errs).toContain('Upgrade split must add up to 100%');
  });

  it('cardFor picks the latest version in effect on the day', () => {
    const cards = [
      { version: 1, effective_from: '2026-10-01' },
      { version: 2, effective_from: '2026-10-08' },
      { version: 3, effective_from: '2026-10-08' },
    ];
    expect(cardFor(cards, '2026-09-30')).toBeNull();
    expect(cardFor(cards, '2026-10-07')?.version).toBe(1);
    expect(cardFor(cards, '2026-10-08')?.version).toBe(3);
  });
});

describe('navigation by permission', () => {
  const only = (...perms: Permission[]) => (p: Permission) => perms.includes(p);

  it('shows nothing without permissions', () => {
    expect(visibleComponents(only())).toEqual([]);
  });
  it('a workerbook-only user sees just Workerbook', () => {
    expect(visibleComponents(only('workerbook')).map(c => c.key)).toEqual(['wb']);
  });
  it('Super Admin sees everything', () => {
    expect(visibleComponents(() => true).length).toBe(COMPONENTS.length);
  });
  it('a user with one SA permission sees only that SA area', () => {
    const sa = visibleComponents(only('sa_users')).find(c => c.perm === 'super_admin_any');
    expect(sa).toBeTruthy();
    expect(SUPER_ADMIN_PERMISSIONS).toContain('sa_users');
  });
  it('findByPath resolves ready screens', () => {
    expect(findByPath('/app/workerbook/rate-cards')?.sub.ready).toBe(true);
    expect(findByPath('/app/admin/users')?.sub.ready).toBe(true);
    expect(findByPath('/app/nope')).toBeNull();
  });
});

import { areaProblems, mergeAreas, routeCodeOf, type AreaPrefix } from './territory';
describe('territory areas', () => {
  const pre: AreaPrefix[] = [
    { area_name: 'GLEN ABBEY #1', prefix: 'GA', region: 'West', route_start: 1, route_count: 8 },
    { area_name: 'GLEN ABBEY #2', prefix: 'GA', region: 'East', route_start: 9, route_count: 14 },
    { area_name: 'NEW AREA', prefix: 'NA', region: 'Central', route_start: 1, route_count: 5 },
  ];
  const routes = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ area_name: 'GLEN ABBEY #1', route_number: n, route_code: routeCodeOf('GA', n) }))
    .concat([{ area_name: 'LOOSE', route_number: 3, route_code: 'LO03' }]);
  it('lists every area with its region, drawn routes and planned numbers', () => {
    const rows = mergeAreas(pre, routes, new Map([['GLEN ABBEY #1', 'cc1']]));
    expect(rows.map(r => [r.name, r.region, r.routes.length, r.planned, r.centerId])).toEqual([
      ['GLEN ABBEY #1', 'West', 8, 8, 'cc1'], ['GLEN ABBEY #2', 'East', 0, 14, null], ['LOOSE', null, 1, 1, null], ['NEW AREA', 'Central', 0, 5, null]]);
    expect(rows.find(r => r.name === 'LOOSE')!.hasPrefixRow).toBe(false);
  });
  it('checks a new or edited area', () => {
    expect(areaProblems({ name: 'GLEN ABBEY #3', prefix: 'GA', region: 'West', start: 23, end: 30 }, pre, null)).toEqual([]);
    expect(areaProblems({ name: 'GLEN ABBEY #3', prefix: 'GA', region: 'West', start: 20, end: 30 }, pre, null)[0]).toMatch(/overlaps GLEN ABBEY #2 \(GA09–GA22\)/);
    expect(areaProblems({ name: 'glen abbey #1', prefix: 'GA', region: 'West', start: 1, end: 8 }, pre, null)).toContain('There’s already an area with that name.');
    expect(areaProblems({ name: 'GLEN ABBEY #1', prefix: 'GA', region: 'East', start: 1, end: 8 }, pre, 'GLEN ABBEY #1')).toEqual([]);   // editing itself
    expect(areaProblems({ name: 'X', prefix: 'G4', region: 'East', start: 3, end: 2 }, pre, null)).toHaveLength(2);
  });
});
