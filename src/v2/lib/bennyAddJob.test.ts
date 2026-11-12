import { describe, expect, it } from 'vitest';
import { addJobCard, addJobLines, addedSaid, type AddJobCheck } from './bennyAddJob';
import { forModel, toolCall, toolsFor, rules } from '../../../supabase/functions/benny-assist/tools';

const check = (over: Partial<AddJobCheck['job']> = {}, contact: AddJobCheck['contact'] = { phone: '604-555-0101', email: 'a@example.com' }): AddJobCheck => ({
  ok: true, date: '2026-11-12', stamp: 's', worker: { cn: 'I1002', name: 'Nathan Clark' }, cart: { id: 'sess_10', workers: ['I1002'], names: ['Nathan Clark'] },
  job: { address: '11885 Stephens St', route: 'MPR45', client: 'Sam Lee', service: 'Lawn Rejuvenation', price: 729.75, paid_by: 'Prepaid',
    add_ons: [{ name: 'European Chafer Beetle Protection Plan', price: 367.5 }], total: 1097.25, ...over }, contact,
});

describe('adding a job from the Benny', () => {
  it('saves the sale and each add-on as its own line, tied to the sale', () => {
    let n = 0; const lines = addJobLines(check(), new Date('2026-11-12T20:00:00Z'), () => `id${++n}`);
    expect(lines).toHaveLength(2);
    const [sale, addon] = lines.map(l => l.tx as unknown as Record<string, unknown>);
    expect(sale).toMatchObject({ id: 'id1', type: 'Sale', price: 729.75, paymentMethod: 'Prepaid', isPrepaid: true, customerName: 'Sam Lee', routeCode: 'MPR45',
      customerPhone: '604-555-0101', customerEmail: 'a@example.com', items: [{ name: 'Lawn Rejuvenation', price: 729.75 }], paymentBreakdown: { Prepaid: 729.75 } });
    expect(addon).toMatchObject({ type: 'Add-On', price: 367.5, refId: 'id1', serviceName: 'European Chafer Beetle Protection Plan', paymentMethod: 'Prepaid' });
    expect(addon.customerEmail).toBeUndefined();   // one receipt, from the sale
    expect(lines[0].jobId).toMatch(/^NEW-/); expect(lines[1].jobId).not.toBe(lines[0].jobId);
  });
  it('works with just an address and a price, and the card says what was left out', () => {
    const c = check({ client: undefined, route: undefined, add_ons: [], total: 300, price: 300, paid_by: 'Cash' }, {});
    c.missing = ['the client’s name', 'a phone number'];
    const lines = addJobLines(c);
    expect(lines).toHaveLength(1);
    expect((lines[0].tx as unknown as Record<string, unknown>).customerName).toBe('');
    const card = addJobCard(c);
    expect(card.action).toBe('Add the job');
    expect(card.lines).toContain('No phone or email');
    expect(card.lines.join('\n')).toContain('Not given: the client’s name, a phone number.');
    expect(card.lines.join('\n')).not.toContain('receipt');
  });
  it('says a receipt goes out when there is an email, and what was added', () => {
    expect(addJobCard(check()).lines.join('\n')).toContain('receipt by email');
    expect(addedSaid(check())).toBe('Added to Nathan’s logsheet: 11885 Stephens St, $1,097.25 prepaid (2 lines). The totals are worked out again.');
  });
  it('is a card for super admins and route managers, and the Benny never sees the phone or email', () => {
    expect(toolsFor('admin').map(t => t.name)).toContain('propose_add_job');
    expect(toolsFor('rm').map(t => t.name)).toContain('propose_add_job');
    const call = toolCall('propose_add_job', { worker: 'Nathan', address: ' 11885 Stephens St ', price: 729.75, paid_by: 'prepaid', add_ons: [{ name: 'grub control', price: 367.5 }] }, { center_id: 'c1' });
    expect(call).toMatchObject({ fn: 'benny_check_add_job', card: { kind: 'add_job' }, args: { p_center: 'c1', p_worker: 'Nathan', p_job: { address: '11885 Stephens St', price: 729.75, paid_by: 'prepaid', add_ons: [{ name: 'grub control', price: 367.5 }] } } });
    const seen = forModel('add_job', { ok: true, contact: { phone: '604-555-0101', email: 'a@example.com' } }) as Record<string, unknown>;
    expect(JSON.stringify(seen)).not.toContain('604'); expect(seen).toMatchObject({ has_phone: true, has_email: true });
    for (const role of ['admin', 'rm'] as const) expect(rules(role)).toContain('only the address and the price are needed');
  });
});
