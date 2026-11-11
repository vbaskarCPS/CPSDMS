import { describe as d, it, expect } from 'vitest';
import { bookingSaved, buildBennyPlan, crewProblems, describe, dollars, emailsPreset, jobUpdates, payoutsStart, stopPin, type JobCheck, type PayoutsCheck, type StartDayCheck } from './bennyActions';
import type { BonusCheck } from './bennyBonus';
import { planProblems } from './startSession';
import { defaultRateCard } from './rateCard';
import type { RosterRow } from './workerbook';
import { CARDS } from './benny';

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
  // "give Franklyn the worst half and Jovan the good guys": the plan says who goes with whom
  const crews = (): StartDayCheck => {
    const c = check(false, true);
    c.crews = true;
    c.assign[0].crew = [{ hire_id: '3', cn: 'I3', name: 'Cal X', days: 4, avg_equiv: 11.4 }, { hire_id: '2', cn: 'I2', name: 'Bob X', days: 6, avg_equiv: 9.04 }];
    c.assign[0].crew_avg = 10.22;
    c.assign[1].crew = [{ hire_id: '1', cn: 'I1', name: 'Ann X', days: 9, avg_equiv: 23.17 }, { hire_id: '4', cn: 'I4', name: 'Dee X', days: 0 }];
    c.assign[1].crew_avg = 23.17;
    c.notes = ['Roster cart A is split between the crews (Ann X, Bob X): each of them gets a cart of their own.'];
    return c;
  };
  const whose = (p: ReturnType<typeof buildBennyPlan>) => Object.fromEntries(Object.entries(p.members).map(([h, t]) => [h, p.teams.find(x => x.name === t)!.managerId]));
  it('crews: every worker’s cart goes to the manager whose crew they are in, whatever the cart mode', () => {
    for (const mode of ['roster', 'solo', 'pairs'] as const) {
      const p = buildBennyPlan(crews(), mode, roster, mgrs, card, 'lawn_rejuv', 2026);
      expect(whose(p), mode).toEqual({ 1: 'm2', 2: 'm1', 3: 'm1', 4: 'm2' });
      expect(planProblems(p), mode).toEqual([]);
    }
  });
  it('crews: a roster cart split between crews is broken up; one kept whole follows its crew; pairs stay inside a crew', () => {
    const split = buildBennyPlan(crews(), 'roster', roster, mgrs, card, 'lawn_rejuv', 2026);
    expect(split.teams).toHaveLength(4);                                  // Ann and Bob were cart A: now a cart each
    expect(new Set(Object.values(split.members)).size).toBe(4);
    const whole = crews();
    whole.assign[0].crew = [{ hire_id: '1', name: 'Ann X' }, { hire_id: '2', name: 'Bob X' }]; whole.assign[1].crew = [{ hire_id: '3', name: 'Cal X' }, { hire_id: '4', name: 'Dee X' }];
    const kept = buildBennyPlan(whole, 'roster', roster, mgrs, card, 'lawn_rejuv', 2026);
    expect(kept.members[1]).toBe('A'); expect(kept.members[2]).toBe('A');
    expect(kept.teams.find(t => t.name === 'A')!.managerId).toBe('m1');
    const pairs = buildBennyPlan(crews(), 'pairs', roster, mgrs, card, 'lawn_rejuv', 2026);
    expect(pairs.teams).toHaveLength(2);
    expect(pairs.members[2]).toBe(pairs.members[3]); expect(pairs.members[1]).toBe(pairs.members[4]);   // Bob with Cal (Franklyn's), Ann with Dee (Jovan's)
    expect(pairs.members[1]).not.toBe(pairs.members[2]);
  });
  it('crews: someone the plan missed keeps the old rule, and a crew for a manager who is gone falls back to it too', () => {
    const c = crews(); c.assign[1].crew = [{ hire_id: '1', name: 'Ann X' }];   // Dee is in nobody's crew
    const p = buildBennyPlan(c, 'solo', roster, mgrs, card, 'lawn_rejuv', 2026);
    expect(Object.keys(p.members)).toHaveLength(4);
    expect(planProblems(p)).toEqual([]);
    const gone = buildBennyPlan(crews(), 'solo', roster, [mgrs[0]], card, 'lawn_rejuv', 2026);   // Jovan isn't available any more
    expect(new Set(gone.teams.map(t => t.managerId))).toEqual(new Set(['m1']));
    expect(planProblems(gone)).toEqual([]);
  });
  it('crews: a card gone stale stops the start (a manager gone, or a worker added since) instead of dealing them out quietly', () => {
    expect(crewProblems(crews(), roster, mgrs)).toEqual([]);
    expect(crewProblems(check(false, true), [...roster, row('9', 'Zed')], [mgrs[0]])).toEqual([]);   // no crews: the old rules deal with it
    expect(crewProblems(crews(), roster, [mgrs[0]])).toEqual(['Jovan Chung isn’t available on 2026-11-11 any more, so the crews don’t hold. Ask me again.']);
    expect(crewProblems(crews(), [...roster, row('9', 'Zed')], mgrs)).toEqual(['Zed X isn’t in a crew: the roster changed since I checked. Ask me again.']);
    const noShow = roster.map(r => r.hire_id === '4' ? { ...r, attendance: 'no_show' as const } : r);       // someone in a crew marked a no-show since: just not started
    expect(crewProblems(crews(), noShow, mgrs)).toEqual([]);
    expect(buildBennyPlan(crews(), 'solo', noShow, mgrs, card, 'lawn_rejuv', 2026).teams).toHaveLength(3);
  });
  it('a manager no longer available is left out', () => {
    const p = buildBennyPlan(check(true), 'solo', roster, [mgrs[0]], card, 'lawn_rejuv', 2026);
    expect(p.pairs).toBeUndefined();
    expect(planProblems(p)).toEqual([]);
  });
});

const bonus = (): BonusCheck => ({
  ok: true, date: '2026-11-10', source: 'live', total: 100, stamp: 's', ask: [{ worker: 'I1013', place: 1, amount: 50 }, { worker: 'I1002', place: 2, amount: 50 }],
  cautions: ['Not paid out yet, with jobs: Kevontae Ragguette. The ranking can change once they are.'],
  bonuses: [
    { key: 'sess_1', cns: ['I1013'], workers: ['Michael Asiegbunam'], team_size: 1, type: 'Performance EQ', placing: 1, label: 'Performance EQ - 1st Place', amount: 50,
      shares: [{ cn: 'I1013', name: 'Michael Asiegbunam', percent: 100, amount: 50 }], pay_now: 149.57, pay_after: 199.57 },
    { key: 'sess_2', cns: ['I1002', 'I1169'], workers: ['Nathan Clark', 'Steven Doherty'], team_size: 2, type: 'Performance EQ', placing: 2, label: 'Performance EQ - 2nd Place', amount: 50,
      shares: [{ cn: 'I1002', name: 'Nathan Clark', percent: 50, amount: 25 }, { cn: 'I1169', name: 'Steven Doherty', percent: 50, amount: 25 }], split: { I1002: 50, I1169: 50 }, pay_now: 120, pay_after: 170 },
  ],
});

d('describe', () => {
  it('start day card', () => {
    const c = describe({ kind: 'start_day', check: check(), team_mode: 'roster' });
    expect(c.action).toBe('Start the day');
    expect(c.lines[0]).toBe('Manager: Franklyn Mitchell, solo');
    expect(c.lines[1]).toBe('Routes: NORTH VANCOUVER #1 (2)');
    expect(c.lines[2]).toBe('Workers: 4 of 5 booked, roster carts, 2 without one get their own');
    expect(describe({ kind: 'start_day', check: { ...check(), teams: 0, no_team: 4 }, team_mode: 'roster' }).lines[2]).toBe('Workers: 4 of 5 booked, each on their own cart');   // no roster carts set
  });
  it('start day card with crews: who goes with whom, each crew’s average, and what it does to the roster carts', () => {
    const c = check(false, true); c.crews = true;
    c.assign[0].crew = [{ hire_id: '3', name: 'Cal Stone', days: 4, avg_equiv: 11.4 }, { hire_id: '2', name: 'Bob Marsh', days: 6, avg_equiv: 9.04 }]; c.assign[0].crew_avg = 10.22;
    c.assign[1].crew = [{ hire_id: '1', name: 'Ann Lee', days: 9, avg_equiv: 23.17 }, { hire_id: '6', name: 'Bob Young', days: 3, avg_equiv: 15 }, { hire_id: '4', name: 'Dee Roy', days: 0 }]; c.assign[1].crew_avg = 19.09;
    c.notes = ['Roster cart A is split between the crews (Ann Lee, Bob Marsh): each of them gets a cart of their own.'];
    const lines = describe({ kind: 'start_day', check: c, team_mode: 'pairs' }).lines;
    expect(lines).toContain('Franklyn’s crew (2, average 10.2 equiv a day): Cal 11.4, Bob M 9.0');
    expect(lines).toContain('Jovan’s crew (3, average 19.1 equiv a day): Ann 23.2, Bob Y 15.0, Dee (no days yet)');
    expect(lines).toContain(c.notes[0]);
    expect(lines.slice(1, 3)).toEqual(['Franklyn’s routes: NORTH VANCOUVER #1 (1)', 'Jovan’s routes: NORTH VANCOUVER #2 (1)']);   // who goes where, a line each
    expect(lines.find(l => l.startsWith('Workers:'))).toBe('Workers: 4 of 5 booked, paired two to a cart within each crew (3 carts)');   // 2 + 3 workers: 1 + 2 carts
    expect(describe({ kind: 'start_day', check: check(), team_mode: 'pairs' }).lines[2]).toBe('Workers: 4 of 5 booked, paired two to a cart (2 carts)');
    expect(describe({ kind: 'start_day', check: check(false, true), team_mode: 'pairs' }).lines.some(l => /crew/.test(l))).toBe(false);   // no crews, no crew lines
  });
  it('bonus card: what each bonus is, who gets it, the pay before and after, and what to know first', () => {
    const one = describe({ kind: 'bonus', check: { ...bonus(), bonuses: [bonus().bonuses[0]], cautions: undefined } });
    expect(one.title).toBe('Add a bonus for Tue, Nov 10'); expect(one.action).toBe('Add the bonus');
    expect(one.lines).toEqual(['1st place · Performance EQ: Michael Asiegbunam, $50.00 · pay $149.57 → $199.57']);
    const two = describe({ kind: 'bonus', check: bonus() });
    expect(two.title).toBe('Add 2 bonuses for Tue, Nov 10'); expect(two.action).toBe('Add the bonuses');
    expect(two.lines[1]).toBe('2nd place · Performance EQ: Nathan Clark + Steven Doherty, $50.00 (Nathan $25.00, Steven $25.00) · pay $120.00 → $170.00');
    expect(two.lines[2]).toBe('Not paid out yet, with jobs: Kevontae Ragguette. The ranking can change once they are.');
    expect(two.lines).toHaveLength(3);                                         // the live day: nothing else is worked out again
    const saved = describe({ kind: 'bonus', check: { ...bonus(), source: 'saved' } });
    expect(saved.lines[saved.lines.length - 1]).toBe('That day is saved, so adding a bonus works its pay out again (every cart), the same as on its payout list.');
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
  it('booking cards say exactly what will be saved', () => {
    const booking = { id: 'b1', address: '3575 Latimer St', city: 'Richmond', list: 'Fall Rejuv 2026', job: 'AFSL', status: 'open' as const, route: 'RMD57', people: ['Jane Smith'] };
    const base = { ok: true, booking, patch: {}, ask: {}, stamp: 't' };
    const done = describe({ kind: 'booking', check: { ...base, change: { status: { from: 'open', to: 'done' } }, notes: ['Marked done by the office: no worker is credited.'] } });
    expect(done.title).toBe('Mark 3575 Latimer St done');
    expect(done.lines).toEqual(['Richmond · Fall Rejuv 2026 · AFSL · Jane Smith', 'Status: open → done', 'Marked done by the office: no worker is credited.']);
    expect(done.action).toBe('Save');
    expect(describe({ kind: 'booking', check: { ...base, change: { status: { from: 'open', to: 'cancelled' } } } }).title).toBe('Cancel 3575 Latimer St');
    expect(describe({ kind: 'booking', check: { ...base, change: { status: { from: 'done', to: 'open' } } } }).title).toBe('Reopen 3575 Latimer St');
    const move = describe({ kind: 'booking', check: { ...base, change: { route: { from: 'RMD57', to: 'RMD137', map: 'RICHMOND #7' } } } });
    expect(move.title).toBe('Move 3575 Latimer St to RMD137');
    expect(move.lines[1]).toBe('Route: RMD57 → RMD137 (RICHMOND #7)');
    const note = describe({ kind: 'booking', check: { ...base, change: { field_note: { mode: 'add', text: 'Dog in yard', was: 'Side gate' } } } });
    expect(note.title).toBe('Add a field note to 3575 Latimer St');
    expect(note.lines[1]).toBe('Field note: adds “Dog in yard”');
    expect(describe({ kind: 'booking', check: { ...base, change: { office_note: { mode: 'set', text: 'Call first' } } } }).title).toBe('Add an office note to 3575 Latimer St');
    expect(describe({ kind: 'booking', check: { ...base, change: { office_note: { mode: 'clear', text: '', was: 'Old' } } } }).lines[1]).toBe('Office note: cleared (was “Old”)');
    const many = describe({ kind: 'booking', check: { ...base, change: { status: { from: 'open', to: 'done' }, route: { to: 'RMD137' }, field_note: { mode: 'replace', text: 'New', was: 'Old' } } } });
    expect(many.title).toBe('Change 3575 Latimer St');
    expect(many.lines.slice(1)).toEqual(['Status: open → done', 'Route: none → RMD137', 'Field note: “Old” becomes “New”']);
  });
  const emails = { ok: true, kind: 'day_before' as const, date: '2026-11-11', list: { id: 'l1', name: 'Fall Rejuv 2026' }, from: 'bcclientcare@propertystars.app',
    routes: [{ code: 'NDEL27', area: 'NORTH DELTA #2', number: 27 }, { code: 'NDEL28', area: 'NORTH DELTA #2', number: 28 }, { code: 'NEWW01', area: 'NEW WESTMINSTER #1', number: 1 }],
    counts: { bookings: 22, to_email: 19, no_email: 2, already_sent: 1 } };
  it('the booking emails card says who gets one, and that nothing is sent from it', () => {
    const c = describe({ kind: 'booking_emails', check: emails });
    expect(c.title).toBe('Day-before emails for Wed, Nov 11');
    expect(c.lines).toEqual(['Routes: NORTH DELTA #2 (2), NEW WESTMINSTER #1 (1)', '19 customers to email · 2 have no email · 1 already got it', 'From bcclientcare@propertystars.app',
      'Nothing is sent from here: you read every email, then press Send.']);
    expect(c.action).toBe('Open to read and send');
    const one = describe({ kind: 'booking_emails', check: { ...emails, kind: 'next_try', counts: { bookings: 1, to_email: 1, no_email: 1, already_sent: 0 }, notes: ['Left out, not on this center’s maps: ZZZ99.'] } });
    expect(one.title).toBe('Next-try emails for Wed, Nov 11');
    expect(one.lines[1]).toBe('1 customer to email · 1 has no email');
    expect(one.lines).toContain('Left out, not on this center’s maps: ZZZ99.');
    expect(emailsPreset(emails)).toEqual({ kind: 'day_before', date: '2026-11-11', list_id: 'l1', routes: emails.routes });
  });
  const pin = { ok: true, date: '2026-11-10', manager: 'rm_franklynmitchell', label: 'Lunch', lat: 49.15, lng: -122.92, at: 'on NDEL32', visibility: 'private' as const, seen_by: 'Just you', route: 'NDEL32' };
  const order = { ok: true, kind: 'pickup' as const, date: '2026-11-10', manager: 'rm_franklynmitchell', start: { lat: 49.24, lng: -122.88 }, km: 18.6, replaces: 5, left_out: ['Mugove (no route yet)'],
    stops: [{ n: 1, label: 'Pickup 1 · Nathan', who: 'Nathan', lat: 49.25, lng: -122.93, by: 'knock' as const, route: 'NBY70', age_min: 12 },
      { n: 2, label: 'Pickup 2 · Kyle + David', who: 'Kyle + David', lat: 49.15, lng: -122.92, by: 'route' as const, route: 'NDEL28' },
      { n: 3, label: 'Pickup 3 · Favour', who: 'Favour', lat: 49.15, lng: -122.9, by: 'phone' as const, age_min: 2 }] };
  it('a pin card says where it goes and who sees it', () => {
    expect(describe({ kind: 'pin', check: pin })).toEqual({ title: 'Drop a pin: “Lunch”', lines: ['On NDEL32', 'Seen by: just you'], action: 'Drop the pin' });
    expect(describe({ kind: 'pin', check: { ...pin, at: 'where David last knocked, 8 min ago', visibility: 'manager', seen_by: 'Sent to Jovan Chung' } }).lines)
      .toEqual(['Where David last knocked, 8 min ago', 'Seen by: sent to Jovan Chung']);
  });
  it('a logsheet job card says what it reads now and what it will read, and only those fields are saved', () => {
    const job: JobCheck = { ok: true, date: '2026-11-10', worker: { cn: 'I1479', name: 'Kevontae Ragguette' }, cart: { id: 's7', workers: ['Kevontae Ragguette'] },
      job: { id: 't1', client: 'Ron Gee', address: '406 Cumberland St', route: 'NEWW26', type: 'Sale', service: 'Lawn Rejuvenation', does: ['dethatch'], note: 'New Sale', amount: 180, paid_by: 'Cash' },
      change: { amount: { from: 180, to: 250 }, paid_by: { from: 'Cash', to: 'Prepaid' } }, ask: { amount: 250, paid_by: 'Prepaid' },
      patch: { price: 250, display_price: 'RJ250.00', payment_method: 'Prepaid', payment_breakdown: { Prepaid: 250 }, items: [{ name: 'Lawn Rejuvenation', price: 250 }] }, stamp: 's', notes: [] };
    expect(describe({ kind: 'job', check: job })).toEqual({ title: 'Change a job on Kevontae’s logsheet', action: 'Save', lines: [
      'Ron Gee · 406 Cumberland St', 'Sale · Lawn Rejuvenation (dethatch)', 'Amount: $180.00 → $250.00', 'Paid by: Cash → Prepaid',
      'Kevontae’s equiv and totals are worked out again. The change is recorded under your name.'] });
    // only the payment type changes: the amount is shown as staying; a caution from the check is on the card; a team cart is named
    const type = describe({ kind: 'job', check: { ...job, cart: { id: 's7', workers: ['Kevontae Ragguette', 'David Nsapu'] }, change: { paid_by: { from: 'Cash', to: 'Cheque' } }, notes: ['No cheque number is saved with it.'] } });
    expect(type.lines.slice(2)).toEqual(['Amount: $180.00 (stays)', 'Paid by: Cash → Cheque', 'No cheque number is saved with it.',
      'The cart’s (Kevontae + David) equiv and totals are worked out again. The change is recorded under your name.']);
    expect(describe({ kind: 'job', check: { ...job, job: { ...job.job, client: undefined, address: undefined, does: undefined, type: 'Add-On' }, change: { amount: { from: 180, to: 1250.5 } } } }).lines.slice(0, 4))
      .toEqual(['A job with no client name', 'Add-On · Lawn Rejuvenation', 'Amount: $180.00 → $1,250.50', 'Paid by: Cash (stays)']);
    // the save gets the edit screen's five fields and nothing else: no client, contact or card field can ride along
    expect(jobUpdates(job.patch)).toEqual({ price: 250, displayPrice: 'RJ250.00', paymentMethod: 'Prepaid', paymentBreakdown: { Prepaid: 250 }, items: [{ name: 'Lawn Rejuvenation', price: 250 }] });
    expect(Object.keys(jobUpdates({ ...job.patch, items: undefined, ...({ cc_full_number: 'x', customer_phone: 'y' } as object) }))).toEqual(['price', 'displayPrice', 'paymentMethod', 'paymentBreakdown']);
    expect(dollars(210)).toBe('$210.00');
  });
  it('the payouts card lists who is lined up and who is left, and says nobody is paid out from it', () => {
    const pay: PayoutsCheck = { ok: true, date: '2026-11-10', paid_out: 4,
      carts: [{ cart_id: 's1', cn: 'I1167', workers: ['David Nsapu'], jobs: 1, gross: 210, collected: { card: 0, cash: 0, billed: 0, cheque: 0, prepaid: 210, e_transfer: 0 } },
        { cart_id: 's2', cn: 'I1013', workers: ['Michael Asiegbunam', 'Kyle Pitt'], jobs: 2, gross: 602, collected: { card: 392, cash: 0, billed: 0, cheque: 0, prepaid: 210, e_transfer: 0 } },
        // a cart with no jobs has nothing to count either: it is lined up too, after the ones with jobs
        { cart_id: 's3', cn: 'I1188', workers: ['Favour Anugawo'], jobs: 0, gross: 0, collected: { card: 0, cash: 0, billed: 0, cheque: 0, prepaid: 0, e_transfer: 0 } }],
      to_count: [{ workers: ['Kevontae Ragguette'], cash: 180, cheque: 0 }, { workers: ['Nathan Clark'], cash: 20, cheque: 75.5 }] };
    expect(describe({ kind: 'payouts', check: pay })).toEqual({ title: 'Go through 3 payouts with no cash or cheque', action: 'Open', lines: [
      'David · 1 job · $210.00 prepaid', 'Michael + Kyle · 2 jobs · $392.00 card, $210.00 prepaid', 'Favour · no jobs',
      'Left for a hand count: Kevontae ($180.00 cash); Nathan ($20.00 cash, $75.50 in cheques)',
      'Nothing is paid out from here: each one opens on the payout screen and you press Finalize. It then moves to the next.'] });
    const one = describe({ kind: 'payouts', check: { ...pay, carts: [pay.carts[0]], to_count: undefined } });
    expect(one.title).toBe('Go through 1 payout with no cash or cheque'); expect(one.lines).toHaveLength(2);
    // the card opens the payout screen at the first, with the rest behind it
    expect(payoutsStart(pay)).toBe('/app/workerbook/days/2026-11-10/payouts/I1167?queue=I1013,I1188&at=1&of=3');
    expect(payoutsStart({ ...pay, carts: [] })).toBeNull();
  });
  it('an order card lists the stops in order, with how each was found, and what it replaces', () => {
    const c = describe({ kind: 'stops', check: order });
    expect(c.title).toBe('Pickup order: 3 stops');
    expect(c.lines).toEqual(['1. Nathan · last knock, 12 min ago', '2. Kyle + David · route NDEL28', '3. Favour · phone, 2 min ago', 'About 18.6 km in a straight line, from where you are',
      'Left out: Mugove (no route yet)', 'Replaces your 5 earlier pickup pins', 'Only you see these pins. Tap one on the map, then Navigate.']);
    expect(c.action).toBe('Drop the pins');
    const one = describe({ kind: 'stops', check: { ...order, kind: 'drop', start: undefined, replaces: undefined, left_out: [], stops: [order.stops[1]], km: 0 } });
    expect(one.title).toBe('Drop order: 1 stop'); expect(one.action).toBe('Drop the pin');
    expect(one.lines[1]).toBe('About 0 km in a straight line, starting at Kyle + David (I don’t have your location)');
    // a position nowhere near the carts (the map opened from another city) is left out, and the card says so
    const far = describe({ kind: 'stops', check: { ...order, start: undefined, start_far: true } });
    expect(far.lines[3]).toBe('About 18.6 km in a straight line, starting at Nathan (your location is too far from the carts to start from)');
    const road = describe({ kind: 'stops', check: { ...order, by_road: true, minutes: 31, km: 24.2 } });
    expect(road.lines[3]).toBe('About 31 min of driving (24.2 km), from where you are');
  });
  it('an order only ever replaces its own kind of pin', () => {
    expect(stopPin('drop').test('Drop 3 · Kyle')).toBe(true);
    expect(stopPin('drop').test('Drop 12 · Kyle + David')).toBe(true);
    for (const other of ['Pickup 3 · Kyle', 'Drop off', 'Drop 3 Kyle', 'Lunch', 'My Drop 3 · Kyle', 'Pin 4']) expect(stopPin('drop').test(other), other).toBe(false);
  });
  it('every card the app says it can show has its words', () => {
    const booking = { id: 'b1', address: '1 A St', status: 'open' as const };
    const move = { ok: true, date: '2026-11-10', a: { cn: 'I1', name: 'A B' }, b: { cn: 'I2', name: 'C D' } };
    const samples: Record<string, Parameters<typeof describe>[0]> = {
      start_day: { kind: 'start_day', check: check() }, give_route: { kind: 'give_route', check: { ok: true, date: '2026-11-10', route: 'X1', worker: { cn: 'I1', name: 'A B' } } },
      partner: { kind: 'partner', check: move }, solo: { kind: 'solo', check: move },
      booking: { kind: 'booking', check: { ok: true, booking, change: { status: { from: 'open', to: 'done' } }, patch: { status: 'done' }, ask: { status: 'done' }, stamp: 't' } },
      booking_emails: { kind: 'booking_emails', check: emails },
      pin: { kind: 'pin', check: pin }, stops: { kind: 'stops', check: order },
      payouts: { kind: 'payouts', check: { ok: true, date: '2026-11-10', carts: [{ cart_id: 's1', cn: 'I1', workers: ['A B'], jobs: 1, gross: 10, collected: { prepaid: 10 } }] } },
      job: { kind: 'job', check: { ok: true, date: '2026-11-10', worker: { cn: 'I1', name: 'A B' }, cart: { id: 's1', workers: ['A B'] }, job: { id: 't1', type: 'Sale', amount: 10, paid_by: 'Cash' },
        change: { amount: { from: 10, to: 20 } }, ask: { amount: 20 }, patch: { price: 20, display_price: '20.00', payment_method: 'Cash', payment_breakdown: { Cash: 20 } }, stamp: 't' } },
    };
    samples.bonus = { kind: 'bonus', check: bonus() };
    samples.texts = { kind: 'texts', check: { ok: true, date: '2026-11-11', who: 'no_shows', own_words: true, people: [{ hire_id: 'h1', cn: 'I1169', name: 'Steven Doherty', first: 'Steven', phone: '6045550101', text: 'Steven, call me.' }] } };
    // the texts card's words carry the names and the texts, never a number
    expect(describe(samples.texts)).toEqual({ title: 'Text 1 who didn’t show · Wed, Nov 11', lines: ['Steven Doherty: “Steven, call me.”'], action: 'Text' });
    for (const k of CARDS) { expect(samples[k], k).toBeTruthy(); expect(describe(samples[k]).title, k).toBeTruthy(); }
  });
  it('what a saved booking change says', () => {
    expect(bookingSaved({ status: { from: 'open', to: 'done' } })).toBe('marked done');
    expect(bookingSaved({ status: { from: 'done', to: 'open' }, route: { to: 'RMD137' }, field_note: { mode: 'add', text: 'x' }, office_note: { mode: 'clear', text: '' } }))
      .toBe('open again, moved to RMD137, field note added, office note cleared');
  });
});
