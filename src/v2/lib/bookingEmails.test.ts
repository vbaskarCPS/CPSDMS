import { describe, expect, it } from 'vitest';
import { alreadySent, bookingVars, emailsOf, nextDays, noteHtml, renderDraft, sentKey, servicesWords } from './bookingEmails';
import { fillTemplate } from './mail';
import type { Booking } from './bookings';

const bk = (p: Partial<Booking> = {}): Booking => ({
  id: 'b1', list_id: 'l1', plan_id: null, client_id: null, house_no: '12', street_name: 'Oak St', unit: null, city: 'Surrey', province: 'BC', postal_code: null,
  lat: null, lng: null, sheet_route: null, route_code: 'SUR4', area_name: 'Surrey', map_state: 'on_map', map_how: null, moved_from: null,
  job_code: 'AFSL', services: { aeration: true, fertilizer: true, seed: true, lime: true }, property_type: null, prepaid: false,
  people: [{ first: 'Ann', last: 'Lee' }], phones: [], emails: ['Ann@X.ca', 'ann@x.ca', 'bad'], field_notes: null, office_notes: null,
  status: 'open', attempts: [], done_on: null, done_by: null, done_by_name: null, done_services: null, this_year: [], booked_by: null, booked_at: null,
  source: null, created_at: '', updated_at: '', plan: null, ...p,
});

describe('booking emails', () => {
  it('says the services in words', () => {
    expect(servicesWords({ aeration: true, fertilizer: true, seed: true, lime: true })).toBe('aeration, fertilizer, overseeding and lime');
    expect(servicesWords({ aeration: true })).toBe('aeration');
    expect(servicesWords({}, 'DS')).toBe('dethatching and overseeding');
    expect(servicesWords(null)).toBe('your lawn service');
  });
  it('keeps one copy of each good address', () => { expect(emailsOf(bk())).toEqual(['ann@x.ca']); });
  it('knows what was already sent for that day', () => {
    const b = bk({ sent_emails: [{ kind: sentKey('day_before', '2026-10-30'), at: '' }] });
    expect(alreadySent(b, 'day_before', '2026-10-30')).toBe(true);
    expect(alreadySent(b, 'day_before', '2026-10-31')).toBe(false);
    expect(alreadySent(b, 'next_try', '2026-10-30')).toBe(false);
  });
  it('fills the template, escaping all but the note', () => {
    expect(fillTemplate('<p>Hi {{firstName}}, {{ unknown }}</p>{{note}}', { firstName: 'A&B', note: '<p>x</p>' })).toBe('<p>Hi A&amp;B, </p><p>x</p>');
    expect(fillTemplate('<p>{{note}}</p><p>ok</p>', { note: '' })).toBe('<p>ok</p>');
  });
  it('makes the variables, with the reason for a next try', () => {
    const v = bookingVars(bk({ attempts: [{ day: '2026-10-28', kind: 'next_time', reason: 'Locked gate', at: '' }] }), '2026-10-30', 'Property Stars · BC');
    expect(v.firstName).toBe('Ann');
    expect(v.address).toBe('12 Oak St, Surrey');
    expect(v.reason).toBe('locked gate');
    expect(v.dateFriendly).toMatch(/October 30/);
    expect(bookingVars(bk({ people: [] }), '2026-10-30', 'x').firstName).toBe('there');
  });
  it('renders a draft', () => {
    const r = renderDraft({ subject: 'We’re coming {{dateFriendly}}', html: '<p>Hi {{firstName}}</p>{{note}}' }, { booking: bk(), note: noteHtml('Thanks for\n\nyear 4!') }, '2026-10-30', 'PS');
    expect(r.subject).toMatch(/^We’re coming .*October 30/);
    expect(r.html).toBe('<p>Hi Ann</p><p>Thanks for</p><p>year 4!</p>');
    expect(r.text).toContain('Hi Ann');
  });
  it('knows tomorrow and the day after', () => {
    expect(nextDays(new Date('2026-10-31T10:00:00'))).toEqual({ tomorrow: '2026-11-01', after: '2026-11-02' });
  });
});
