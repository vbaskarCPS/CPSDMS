import { describe, expect, it } from 'vitest';
import { houseNo, isOpen, OUTCOMES, pinOf, streetOf, visitProblem, walkOrder, whenLabel, type RepBusiness } from './rep';

const biz = (id: string, address: string | null, plaza: string | null = null): RepBusiness => ({
  id, name: id, address, lat: 0, lng: 0, kind: 'trades', plaza, plaza_id: plaza ? `p-${plaza}` : null, state: 'new', last_at: null, follow_up_at: null, visits: 0,
});

describe('rep · walking order', () => {
  it('reads the street and number from an address', () => {
    expect(streetOf('123 Main St W, Oakville, ON')).toBe('Main St W');
    expect(streetOf('Unit 4 - 2 Elm Rd, Oakville')).toBe('Elm Rd');
    expect(streetOf('12A Oak Ave')).toBe('Oak Ave');
    expect(houseNo('1530 Lakeshore Rd E, Oakville')).toBe(1530);
    expect(houseNo(null)).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('plazas first (biggest first), then streets alphabetically, by number along each', () => {
    const order = walkOrder([
      biz('a', '20 Elm Rd'), biz('b', '5 Elm Rd'), biz('c', '1 Ash St'),
      biz('d', '100 Main St', 'Small Plaza'), biz('e', '200 Main St', 'Big Centre'), biz('f', '202 Main St', 'Big Centre'),
    ]);
    expect(order.map(g => g.group)).toEqual(['Big Centre', 'Small Plaza', 'Ash St', 'Elm Rd']);
    expect(order[3].items.map(b => b.id)).toEqual(['b', 'a']);
  });
});

describe('rep · logging a visit', () => {
  const now = new Date('2026-10-28T12:00:00');
  it('a follow-up needs a time that hasn’t passed', () => {
    expect(visitProblem({ outcome: 'follow_up' }, now)).toMatch(/When should you follow up/);
    expect(visitProblem({ outcome: 'follow_up', follow_up_at: '2026-10-27T09:00:00' }, now)).toMatch(/already passed/);
    expect(visitProblem({ outcome: 'follow_up', follow_up_at: '2026-10-29T09:00:00' }, now)).toBeNull();
  });
  it('can’t sell here needs a reason; emails are checked', () => {
    expect(visitProblem({ outcome: 'cant_sell', notes: '  ' }, now)).toMatch(/Say why/);
    expect(visitProblem({ outcome: 'cant_sell', notes: 'Shut down' }, now)).toBeNull();
    expect(visitProblem({ outcome: 'interested', contact_email: 'nope' }, now)).toMatch(/email/);
    expect(visitProblem({ outcome: 'come_back' }, now)).toBeNull();
  });
  it('has the six outcomes in order', () => {
    expect(OUTCOMES.map(o => o.key)).toEqual(['come_back', 'not_interested', 'follow_up', 'interested', 'closed', 'cant_sell']);
  });
});

describe('rep · pins', () => {
  it('what is still worth a knock', () => {
    expect(['new', 'come_back', 'follow_up', 'interested', 'rejected'].every(s => isOpen(s as never))).toBe(true);
    expect(['not_interested', 'pending', 'closed', 'cant_sell'].some(s => isOpen(s as never))).toBe(false);
  });
  it('an unknown state shows as not visited', () => {
    expect(pinOf('bogus').label).toBe('Not visited');
    expect(pinOf('pending').label).toMatch(/approval/);
  });
  it('says today / tomorrow / yesterday', () => {
    const now = new Date('2026-10-28T12:00:00');
    expect(whenLabel('2026-10-28T15:30:00', now)).toMatch(/^Today/);
    expect(whenLabel('2026-10-29T09:00:00', now)).toMatch(/^Tomorrow/);
    expect(whenLabel('2026-10-27T09:00:00', now)).toMatch(/^Yesterday/);
    expect(whenLabel('2026-11-03T09:00:00', now)).toMatch(/Nov/);
  });
});
