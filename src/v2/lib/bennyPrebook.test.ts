// The Benny's "prebook done" card: a prebook is a Production job at its flat's value with its booking's id, never a sale.
import { describe, expect, it } from 'vitest';
import { codeValue, liveBookingId, prebookCard, prebookFix, prebookLine, prebookSaid, seasonItem, type PrebookCheck } from './bennyPrebook';
import { forModel, rules, toolCall, toolsFor } from '../../../supabase/functions/benny-assist/tools';

const FLATS = [{ code: 'AFSL', value: 210 }, { code: 'FSL', value: 157.5 }];
const check = (over: Partial<PrebookCheck> = {}): PrebookCheck => ({
  ok: true, date: '2026-11-14', stamp: 's', worker: { cn: 'I1003', name: 'Andile Gobodo' }, cart: { id: 'sess_I1003', workers: ['I1003'], names: ['Andile Gobodo'] },
  booking: { id: '144fd3cd', address: '40781 Thunderbird Ridge, unit 10', street_address: '40781 Thunderbird Ridge', city: 'Squamish', route: 'SQU35', job_code: 'AFSL', prepaid: true,
    client: 'Ciaran Donnelly', services: { aeration: true, fertilizer: true, seed: true, lime: true, dethatch: false }, property_type: 'FP' },
  contact: { phone: '604-555-0101', email: 'c@example.com' }, ...over,
});
const sale = { id: 'tx1', type: 'Sale', amount: 210, paid_by: 'Prepaid', shown_as: '210' };

describe('what a job code is worth', () => {
  it('is the season’s flat it starts with, the longest code first', () => {
    expect(codeValue('AFSL', FLATS)).toBe(210);
    expect(codeValue('afsl', FLATS)).toBe(210);
    expect(codeValue('FSL', FLATS)).toBe(157.5);
    expect(codeValue('AFSL+', FLATS)).toBe(210);
  });
  it('is the dollars written there when it is no flat, and nothing when it can’t be told', () => {
    expect(codeValue('189.00', FLATS)).toBe(189);
    expect(codeValue('$52.50', [])).toBe(52.5);
    expect(codeValue('AFSL', [])).toBeNull();
    expect(codeValue('', FLATS)).toBeNull();
    expect(codeValue('0', FLATS)).toBeNull();
  });
});

describe('the line a prebook goes on the logsheet as', () => {
  it('is a Production job with the booking’s id, code, client and services, at the flat’s value', () => {
    const tx = prebookLine(check(), 210, 'lawn_rejuv', new Date('2026-11-14T19:50:00Z'), () => 'new1') as unknown as Record<string, unknown>;
    expect(tx).toMatchObject({ id: 'new1', jobId: 'mb:144fd3cd', type: 'Production', price: 210, displayPrice: 'AFSL', paymentMethod: 'Prepaid', isPrepaid: true, isPaid: true,
      customerName: 'Ciaran Donnelly', address: '40781 Thunderbird Ridge', routeCode: 'SQU35', workerId: 'I1003', serviceType: 'FP',
      customerPhone: '604-555-0101', customerEmail: 'c@example.com', items: [{ name: 'Lawn Rejuvenation', price: 210 }],
      services: { aeration: true, fertilizer: true, seed: true, lime: true, dethatch: false } });
    expect(tx.paymentBreakdown).toBeUndefined();   // as the logsheet screen leaves it
    expect(liveBookingId(check())).toBe('mb:144fd3cd');   // a Production line with this id is what marks the booking done
  });
  it('carries services only in a lawn rejuv season, and names the season’s own item', () => {
    const tx = prebookLine(check(), 52.5, 'aeration') as unknown as Record<string, unknown>;
    expect(tx.services).toBeUndefined();
    expect(tx.items).toEqual([{ name: 'Aeration', price: 52.5 }]);
    expect(seasonItem('sealing')).toBe('Sealing');
  });
});

describe('a prebook that was logged as a sale', () => {
  it('is changed into the prebook: the type, the code, the value, the client; never a second job', () => {
    const fix = prebookFix(check({ replaces: sale }), 210, 'lawn_rejuv') as unknown as Record<string, unknown>;
    expect(fix).toMatchObject({ type: 'Production', price: 210, displayPrice: 'AFSL', paymentMethod: 'Prepaid', paymentBreakdown: { Prepaid: 210 },
      customerName: 'Ciaran Donnelly', address: '40781 Thunderbird Ridge', routeCode: 'SQU35', items: [{ name: 'Lawn Rejuvenation', price: 210 }] });
    expect(fix.services).toEqual(check().booking.services);
    const bare = prebookFix(check({ replaces: sale, contact: {} }), 210, 'aeration') as unknown as Record<string, unknown>;
    expect('customerPhone' in bare).toBe(false); expect('services' in bare).toBe(false);   // nothing that is there is wiped with a blank
  });
  it('the card says the line becomes the prebook, and its button is Fix it', () => {
    const card = prebookCard(check({ replaces: sale, value: 210 }));
    expect(card.title).toBe('Fix the prebook on Andile’s logsheet');
    expect(card.action).toBe('Fix it');
    expect(card.lines).toContain('It’s on the logsheet now as a sale for $210.00, prepaid. That line becomes this; no second job is added.');
    expect(card.lines.some(l => l.includes('receipt'))).toBe(false);   // the edit save sends none
  });
});

describe('the card', () => {
  it('shows the client, the job as a Production flat with its value, the services and that the booking is marked done', () => {
    const card = prebookCard(check({ value: 210, cautions: ['It isn’t loaded on today’s map (it was moved to SQU35 after the day started), which is why it isn’t on the logsheet to tap.'] }));
    expect(card.title).toBe('Put the prebook on Andile’s logsheet');
    expect(card.action).toBe('Mark it done');
    expect(card.lines).toEqual([
      'Ciaran Donnelly · 40781 Thunderbird Ridge, unit 10',
      'Production · AFSL ($210.00 flat) · prepaid · SQU35',
      'Services as booked: aeration, fertilizer, seed, lime',
      'The booking is marked done.',
      'It isn’t loaded on today’s map (it was moved to SQU35 after the day started), which is why it isn’t on the logsheet to tap.',
      'The client gets their receipt by email, the same as from the logsheet.',
      'Andile’s totals are worked out again.',
    ]);
  });
  it('still reads right with no value yet, no client and a team cart', () => {
    const c = check({ contact: {}, cart: { id: 's', workers: ['I1003', 'I1004'], names: ['Andile Gobodo', 'Kyle Pitt'] } });
    c.booking = { ...c.booking, client: undefined, services: undefined, route: undefined };
    expect(prebookCard(c).lines).toEqual(['40781 Thunderbird Ridge, unit 10', 'Production · AFSL · prepaid', 'The booking is marked done.', 'The cart’s (Andile + Kyle) totals are worked out again.']);
  });
  it('says what was saved, and says so when the booking couldn’t be confirmed closed', () => {
    expect(prebookSaid(check(), 210, 'done')).toBe('40781 Thunderbird Ridge is on Andile’s logsheet: Production, AFSL ($210.00 flat), prepaid. The booking is marked done. The totals are worked out again.');
    expect(prebookSaid(check({ replaces: sale }), 210, 'failed')).toBe('Andile’s job at 40781 Thunderbird Ridge now reads Production, AFSL ($210.00 flat), prepaid. I couldn’t confirm the booking closed: check it in Bookings › List. The totals are worked out again.');
  });
});

describe('the Benny’s side', () => {
  const ctx = { center_id: 'c1', today: '2026-11-14' };
  it('route managers and super admins both have it, and it needs no price', () => {
    for (const role of ['admin', 'rm'] as const) {
      const t = toolsFor(role).find(x => x.name === 'propose_prebook_done')!;
      expect(t).toBeTruthy();
      expect(Object.keys((t.input_schema as { properties: object }).properties)).toEqual(['worker', 'booking']);
      expect(rules(role)).toContain('A prebook is never a sale');
      expect(rules(role)).toContain('never ask for a price');
    }
    expect(toolsFor('ms').some(x => x.name === 'propose_prebook_done')).toBe(false);
  });
  it('goes to the check with the worker and the address, and becomes the prebook card', () => {
    expect(toolCall('propose_prebook_done', { worker: 'Andile', booking: ' 40781 Thunderbird Ridge ', price: 210 }, ctx))
      .toEqual({ fn: 'benny_check_prebook_done', args: { p_center: 'c1', p_worker: 'Andile', p_booking: '40781 Thunderbird Ridge' }, card: { kind: 'prebook_done' } });
    expect(toolCall('propose_prebook_done', { worker: 'Andile', booking: 35 }, ctx)).toMatchObject({ args: { p_booking: '' } });
  });
  it('the Benny is not shown the client’s phone or email', () => {
    const seen = forModel('prebook_done', check()) as Record<string, unknown>;
    expect(seen.contact).toBeUndefined();
    expect(seen).toMatchObject({ has_phone: true, has_email: true });
    expect(JSON.stringify(seen)).not.toContain('604-555');
  });
});
