import { describe, expect, it } from 'vitest';
import { jobSaid, pastJobCard, pastJobSaid, pastJobSaved, withPastJob, type PastJobCheck } from './bennyPastJob';
import type { PayoutCart } from './payoutCarts';
import { rules, toolCall, toolsFor } from '../../../supabase/functions/benny-assist/tools';

const member = (cn: string, first: string) => ({ hire_id: null, cn, first_name: first, last_name: 'X', equiv_split: 100, upsell_split: 100, machine_rental: 0, deductions: 0 });
const cart = (id: string, cn: string, first: string, sales: PayoutCart['sales']): PayoutCart =>
  ({ id, label: first, manager: null, members: [member(cn, first)], eq_override: 14.4, crackfill_lbs: 0, bonuses: [], settings: {}, notes: null, sales });
const carts = (): PayoutCart[] => [
  cart('c1', 'I1004', 'Jahswill', [
    { id: 's1', route_code: 'SES08', address: '17085 61A', client_name: 'Jeff Glass', price: 210, payment_type: 'Cash', payments: { Cash: 210 }, type: 'Sale', display_price: '210', service: 'FP', notes: null, meta: { details: 1 } },
    { id: 's2', route_code: 'SES08', address: '17085 61a Avenue', client_name: null, price: 250, payment_type: 'Cash', type: 'Sale', display_price: '250', service: 'FP', notes: null },
  ]),
  cart('c2', 'I1065', 'Kyle', [{ id: 's3', route_code: 'SES33', address: '6296 190 Street', client_name: null, price: 300, payment_type: 'Cash', type: 'Sale', display_price: '300', service: 'FP', notes: null }]),
];
const check: PastJobCheck = {
  ok: true, date: '2026-11-13', stamp: 'x', add: false, worker: { cn: 'I1004', name: 'Jahswill Nuetey' }, cart: { id: 'c1', label: 'Jahswill Nuetey', members: 1 }, line: 's1',
  from: { address: '17085 61A', type: 'Sale', amount: 210, paid_by: 'Cash', shown_as: '210' },
  to: { address: '17085 61A', type: 'Production', amount: 210, paid_by: 'Prepaid', shown_as: 'AFSL', service: 'FP', route: 'SES08', client: 'Jeff Glass' },
  booking: { id: 'b1', address: '17085 61 a', job_code: 'AFSL', prepaid: true }, pay_now: { equiv: 14.4, pay: 105.2 }, ask: { find: '17085 61A Ave', find_amount: 210 },
};

describe('the Benny: a job on a closed day’s payout', () => {
  it('changes only that job, on that cart, and keeps the rest of the day as it was', () => {
    const before = carts(); const next = withPastJob(before, check);
    expect(next[1]).toBe(before[1]);
    expect(next[1].eq_override).toBe(14.4);   // another cart keeps the equiv it was paid out at
    expect(next[0].eq_override).toBeNull();   // this cart's equiv now comes from its sales, so the change reaches the pay
    expect(next[0].sales[1]).toEqual(before[0].sales[1]);
    expect(next[0].sales[0]).toMatchObject({ id: 's1', type: 'Production', payment_type: 'Prepaid', price: 210, display_price: 'AFSL', payments: null, address: '17085 61A', client_name: 'Jeff Glass', meta: { details: 1 } });
    expect(before[0].sales[0].type).toBe('Sale');   // the list it was given is untouched
  });
  it('adds a job when asked to, at the end of the cart’s sales', () => {
    const next = withPastJob(carts(), { ...check, add: true, line: undefined, from: undefined });
    expect(next[0].sales).toHaveLength(3);
    expect(next[0].sales[2]).toMatchObject({ type: 'Production', payment_type: 'Prepaid', price: 210, display_price: 'AFSL', route_code: 'SES08', address: '17085 61A' });
    expect(next[0].sales[2].id).toBeUndefined();
  });
  it('stops when the day no longer reads the way it did', () => {
    expect(() => withPastJob(carts(), { ...check, line: 'gone' })).toThrow(/isn’t on the payout any more/);
    expect(() => withPastJob([carts()[1]], check)).toThrow(/Ask me again/);
  });
  it('is only called saved when the day reads that way afterwards', () => {
    expect(pastJobSaved(carts(), check)).toBe(false);
    const saved = withPastJob(carts(), check).map(c => ({ ...c, sales: c.sales.map(s => ({ ...s, id: `new-${s.id}` })) }));   // a save gives the sales new ids
    expect(pastJobSaved(saved, check)).toBe(true);
  });
  it('the card says what changes, the booking, and the pay now; never a new pay figure', () => {
    const card = pastJobCard(check);
    expect(card.title).toBe('Change a job on Jahswill’s payout for Fri, Nov 13');
    expect(card.lines).toContain('Sale · $210.00 · Cash → Production · AFSL ($210.00) · Prepaid');
    expect(card.lines).toContain('The open booking at 17085 61 a (AFSL) is marked done.');
    expect(card.lines).toContain('Jahswill’s pay now: $105.20 on 14.40 equiv.');
    expect(card.action).toBe('Save');
    expect(pastJobCard({ ...check, cart: { ...check.cart, eq_set: 14.4 } }).lines).toContain('Jahswill’s equiv was set at 14.40 at payout. Saving works it out from the sales instead, so the pay follows this job.');
    expect(pastJobCard({ ...check, add: true, from: undefined }).action).toBe('Add the job');
    expect(jobSaid({ type: 'Sale', amount: 250, paid_by: 'Cash', shown_as: '250' })).toBe('Sale · $250.00 · Cash');
  });
  it('says the pay before and after, from the day as worked out again, and when the booking didn’t save', () => {
    expect(pastJobSaid(check, { equiv: 10.1, pay: 80.5 }, 'done')).toBe('Jahswill’s job at 17085 61A now reads Production · AFSL ($210.00) · Prepaid. Jahswill’s pay for the day: $105.20 → $80.50 (equiv 14.40 → 10.10). The booking at 17085 61 a is marked done.');
    expect(pastJobSaid(check, null, 'failed')).toContain('did NOT save as done');
  });
  it('the tool: office only, a date and a worker, and only what a job is made of', () => {
    expect(toolsFor('admin').map(t => t.name)).toContain('propose_past_job');
    expect(toolsFor('rm').map(t => t.name)).not.toContain('propose_past_job');
    expect(toolCall('propose_past_job', { date: '2026-11-13', worker: 'I1004', find: '17085 61A Ave', find_amount: '$210', type: 'Production', paid_by: 'prepaid', display: 'AFSL', junk: 1 }, { center_id: 'c' }))
      .toEqual({ fn: 'benny_check_past_job', args: { p_center: 'c', p_date: '2026-11-13', p_worker: 'I1004', p_job: { find: '17085 61A Ave', find_amount: 210, type: 'Production', paid_by: 'prepaid', display: 'AFSL' } }, card: { kind: 'past_job' } });
    expect(toolCall('propose_past_job', { date: 'yesterday', worker: 'Jahswill', add: true, booking: false }, { center_id: 'c' })).toMatchObject({ args: { p_date: null, p_job: { add: true, booking: false } } });
    expect(rules('admin')).toContain('propose_past_job');
    expect(rules('rm')).not.toContain('propose_past_job');
  });
});
