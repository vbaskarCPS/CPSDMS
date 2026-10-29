import { describe, expect, it, vi } from 'vitest';
vi.mock('./client', () => ({ db: {}, must: (r: { data: unknown }) => r.data }));
vi.mock('./clients', () => ({ geocode: async () => null }));
import {
  accessFlags, attemptLine, bookingColor, bookingHeaderRow, cityForRoute, lastAttempt, listFor, looksLikeBookingTab, parseBookingTab, repeats,
  servicesCode, servicesFromCode, starPlanToBooking, type BookingList,
} from './bookings';
import { isPrebook } from '../../lib/mapLogsheetStats';

// The BC sheet's Star Plan Bookings tab (made-up people): the house # column has no title
const HEAD = ['Booked By', 'Date Booked', 'Time Booked', 'Route #', 'First Name', 'Last Name', '', 'Street Name', 'Call 1st', 'Phone #', 'E-Mail',
  'Service Type', 'PP', '', 'A', 'D', 'F', 'S', 'L', 'City', 'Notes'];
const row = (o: Partial<Record<string, string>>) => HEAD.map((h, i) => o[i === 6 ? 'house' : i === 13 ? 'price' : h] ?? '');
const TAB = [
  HEAD,
  row({ 'Booked By': 'HORM', 'Date Booked': 'Feb06', 'Route #': 'nvn24', 'First Name': 'Ann', 'Last Name': 'Lee', house: '1234', 'Street Name': 'Elm Rd',
    'Call 1st': 'LG side gate, dog', 'Phone #': '(604) 555-0101', 'E-Mail': 'Ann@Example.com', 'Service Type': 'FP', PP: 'x', price: '$420.00',
    F: 'x', S: '2026-04-08', L: 'C1155', City: '', Notes: 'Wants mornings' }),
  row({ 'Route #': 'NVN24', 'First Name': 'Ann', 'Last Name': 'Lee', house: '1234', 'Street Name': 'Elm Rd', PP: 'x' }),
  row({ 'Route #': 'WHR123', 'First Name': 'Bo', 'Last Name': 'Ng', house: '15', 'Street Name': 'Oak St', 'Service Type': 'BO', PP: '', City: 'Surrey' }),
  row({}),
];

describe('the Star Plan Bookings tab', () => {
  it('is recognised by its titles', () => {
    expect(bookingHeaderRow(TAB)).toBe(0);
    expect(looksLikeBookingTab(TAB)).toBe(true);
    expect(looksLikeBookingTab([['First', 'Last', 'Address']])).toBe(false);
    expect(bookingHeaderRow([['Bookings: 1 | Completed: 5636'], HEAD])).toBe(1);
  });
  it('reads each row, the untitled house # column included', () => {
    const r = parseBookingTab(TAB);
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ row: 2, sheet_route: 'NVN24', house_no: '1234', street: 'Elm Rd', first: 'Ann', last: 'Lee', field_notes: 'LG side gate, dog',
      phones: ['6045550101'], emails: ['ann@example.com'], property_type: 'FP', prepaid_marked: true, price: '$420.00', office_notes: 'Wants mornings',
      spring: 'FSL', springDetail: '2026-04-08 · C1155', key: 'NVN24|1234|elm rd' });
    expect(r[2]).toMatchObject({ prepaid_marked: false, city: 'Surrey', spring: '' });
  });
  it('finds repeats (loaded once)', () => {
    const g = repeats(parseBookingTab(TAB));
    expect(g).toHaveLength(1);
    expect(g[0].map(x => x.row)).toEqual([2, 3]);
  });
  it('becomes a prepaid AFSL booking on an SP Pro plan', () => {
    const [b, , c] = parseBookingTab(TAB);
    const x = starPlanToBooking(b, { lat: 49.3, lng: -123.1 }, cityForRoute(b.sheet_route));
    expect(x).toMatchObject({ job_code: 'AFSL', prepaid: true, city: 'North Vancouver', province: 'BC', sheet_route: 'NVN24', lat: 49.3,
      services: { aeration: true, fertilizer: true, seed: true, lime: true }, plan: { kind: 'sp_pro', price: '$420.00', prepaid: true },
      field_notes: 'LG side gate, dog', office_notes: 'Wants mornings', property_type: 'FP' });
    expect(x.this_year).toEqual([{ label: 'Spring', done: true, detail: 'FSL · 2026-04-08 · C1155' }, { label: 'Summer Fert', done: true }]);
    const y = starPlanToBooking(c, null, '');
    expect(y.office_notes).toMatch(/PP wasn’t marked/);
    expect(y).toMatchObject({ lat: null, city: 'Surrey', prepaid: true });
  });
});

describe('helpers', () => {
  it('turns service flags into codes and back', () => {
    expect(servicesCode({ aeration: true, fertilizer: true, seed: true, lime: true })).toBe('AFSL');
    expect(servicesFromCode('fsl')).toEqual({ fertilizer: true, seed: true, lime: true });
  });
  it('knows the town of a BC route', () => {
    expect(cityForRoute('PCOQ49')).toBe('Port Coquitlam');
    expect(cityForRoute('NVN42 OFF')).toBe('North Vancouver');
    expect(cityForRoute('ZZZ1')).toBe('');
  });
  it('reads gate, dog and sprinkler marks', () => {
    expect(accessFlags('LG side gate')).toEqual({ gate: true, dog: false, sprinkler: false });
    expect(accessFlags('beware of dog, SS')).toEqual({ gate: false, dog: true, sprinkler: true });
    expect(accessFlags('call first')).toEqual({ gate: false, dog: false, sprinkler: false });
  });
  it('writes tries plainly and finds the last one', () => {
    const a = [{ day: '2026-10-30', kind: 'next_time' as const, reason: 'Locked gate', note: 'padlocked', at: '2026-10-30T18:00:00Z' },
      { day: '2026-11-02', kind: 'next_time' as const, reason: 'Rain', at: '2026-11-02T18:00:00Z' }];
    expect(attemptLine(a[0])).toBe('Oct 30 · Locked gate · “padlocked”');
    expect(lastAttempt(a)?.reason).toBe('Rain');
    expect(lastAttempt([])).toBeNull();
  });
  it('colours bookings by how they’re going', () => {
    expect(bookingColor({ status: 'open' })).toBe('#d4a800');
    expect(bookingColor({ status: 'open', tried: true })).toBe('#ea580c');
    expect(bookingColor({ status: 'done' })).toBe('#16a34a');
  });
  it('picks the list a center works for a season, fall first', () => {
    const l = (o: Partial<BookingList>) => ({ id: o.part!, mine: true, service: 'lawn_rejuv', year: 2026, ...o }) as BookingList;
    expect(listFor([l({ part: 'spring' }), l({ part: 'fall' })], 'lawn_rejuv', 2026)?.id).toBe('fall');
    expect(listFor([l({ part: 'fall', mine: false })], 'lawn_rejuv', 2026)).toBeNull();
  });
  it('counts a prebook apart from a sale (closing %)', () => {
    expect(isPrebook({ 'Booking ID': 'mb:1' })).toBe(true);
    expect(isPrebook({ 'Booking ID': 'job_3', isPrebooked: true })).toBe(true);
    expect(isPrebook({ 'Booking ID': 'NEW-123' })).toBe(false);
  });
});
