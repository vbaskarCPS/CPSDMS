// buildSheetRows: the Logsheets and Accounts rows a closed day sends to the Master Bookings sheet
// (the same rows the old Export to Google Sheets wrote). Cards never leave as more than the last 4.
import { describe, expect, it } from 'vitest';
import { buildSheetRows } from '../../lib/exportService';

const CC = 'c1';
const tx = (id: string, o: Record<string, unknown>) => ({
  id, type: 'Sale', price: 226, worker_id: 'T1001', session_id: 's1', command_center_id: CC, payment_breakdown: null,
  customer_snapshot: { routeCode: 'GA07', firstName: 'Pat', lastName: 'Doe', address: '12 Elm St', serviceType: 'FP' },
  customer_phone: '905-555-0100', customer_email: 'pat@example.com', item_description: '', services: {}, ...o,
});
const users = [
  { user_id: 'T1001', role: 'Worker', name: 'Tom One' }, { user_id: 'T1065', role: 'Worker', name: 'Tia Two' },
  { user_id: 'H01', role: 'Worker', name: 'Test Worker' }, { user_id: 'rm_x', role: 'RouteManager', name: 'Manager' },
];
const sessions = [{ id: 's1', team_worker_ids: ['T1001', 'T1065'] }, { id: 's2', team_worker_ids: ['H01'] }];

describe('buildSheetRows', () => {
  const transactions = [
    tx('cash', { payment_method: 'Cash' }),
    tx('saved', { payment_method: 'Credit Card', card_masked: 'CARD-••••1234' }),               // a closed day's saved copy
    tx('bam', { payment_method: 'Credit Card', cc_full_number: 'BAMBORA-998877', cc_cvc: '4321' }), // live Bambora
    tx('raw', { payment_method: 'Credit Card', cc_full_number: '4111 1111 1111 9999' }),           // never stored like this, but never sent either
    tx('etf', { payment_method: 'E-Transfer', etransfer_email: 'pay@example.com' }),
    tx('mixed', { payment_breakdown: { Cash: 100, Billed: 126 }, invoice_number: 'INV-7' }),
    tx('upg', { type: 'Upgrade', payment_method: 'Credit Card', card_masked: 'CARD-••••5555', items: [{ name: 'Hot Asphalt' }] }),
    tx('h01', { worker_id: 'H01', session_id: 's2', payment_method: 'Credit Card', card_masked: 'CARD-••••0000' }),
  ];
  const r = buildSheetRows({ transactions, sessions, users, seasonType: 'sealing' as never });

  it('puts billed, e-transfer and card sales on Accounts, never H01’s', () => {
    expect(r.accounts.map(a => a.paymentDetails)).toEqual([
      'CARD-••••1234', '••••••••••••4321', 'CARD-••••9999', 'pay@example.com', 'INV-7', 'CARD-••••5555',
    ]);
    expect(r.accounts.every(a => a.expiry === '' && a.cvc === '')).toBe(true);
  });

  it('never sends more than the last 4 digits of a card', () => {
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/4111|998877/);
    expect(text.match(/\d{5,}/g) || []).toEqual([]);
  });

  it('fills the sheet columns the same way as before', () => {
    const a = r.accounts[0];
    expect([a.routeNumber, a.firstName, a.lastName, a.streetNum, a.streetName, a.phone, a.email, a.clientType, a.propertyType, a.price, a.paymentType])
      .toEqual(['GA07', 'Pat', 'Doe', '12', 'Elm St', '905-555-0100', 'pat@example.com', 'New', 'FP', 226, 'Credit Card']);
    expect(a.contractorName).toBe('Tom One, Tia Two');   // a team season names the whole cart
    expect(r.accounts.find(x => x.paymentDetails === 'INV-7')!.paymentType).toBe('Cash: $100.00 / Billed: $126.00');
  });

  it('sends Sales to Logsheets but not Upgrades in a team season', () => {
    expect(r.logsheets).toHaveLength(7);   // every Sale, H01's included; the Upgrade is left out
    expect(r.logsheets.some(l => l.clientType === 'RAMP')).toBe(false);
    const solo = buildSheetRows({ transactions, sessions, users, seasonType: 'aeration' as never });
    expect(solo.logsheets).toHaveLength(8);
    expect(solo.logsheets.find(l => l.clientType === 'RAMP')).toBeTruthy();
  });

  it('sends nothing for a day with no sales', () => {
    expect(buildSheetRows({ transactions: [], sessions: [], users: [], seasonType: 'sealing' as never })).toEqual({ logsheets: [], accounts: [] });
  });
});
