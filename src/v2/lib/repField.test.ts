import { describe, expect, it } from 'vitest';
import { distLabel, fillTemplate, followUpIcs, hoursToday, isOffline, metres, nearest, newId, openAt, parseCard, parseDay, refLink, smsHref } from './repField';

const WEEK = ['Monday: 8:30 AM – 5:00 PM', 'Tuesday: 8:30 AM – 5:00 PM', 'Wednesday: 8:30 AM – 5:00 PM', 'Thursday: 8:30 AM – 5:00 PM',
  'Friday: 11:00 AM – 2:30 PM, 5:00 – 10:00 PM', 'Saturday: 6:00 PM – 2:00 AM', 'Sunday: Closed'];
// 2026-10-26 is a Monday
const at = (day: number, hh: number, mm = 0) => new Date(2026, 9, 26 + day, hh, mm);

describe('hours', () => {
  it('reads a day', () => {
    expect(parseDay('Monday: 8:30 AM – 5:00 PM')).toEqual([[510, 1020]]);
    expect(parseDay('Closed')).toEqual([]);
    expect(parseDay('Open 24 hours')).toEqual([[0, 1440]]);
    expect(parseDay('11:00 AM – 2:30 PM, 5:00 – 10:00 PM')).toEqual([[660, 870], [1020, 1320]]);
    expect(parseDay('11:00 – 2:00 PM')).toEqual([[660, 840]]);
    expect(parseDay('9:00 AM – 5:00 PM')).toEqual([[540, 1020]]);
    expect(parseDay('08:30–17:00')).toEqual([[510, 1020]]);
    expect(parseDay('By appointment')).toBeNull();
  });
  it('knows open now', () => {
    expect(openAt(WEEK, at(0, 9))).toBe(true);
    expect(openAt(WEEK, at(0, 8, 29))).toBe(false);
    expect(openAt(WEEK, at(0, 17))).toBe(false);
    expect(openAt(WEEK, at(4, 15))).toBe(false);    // Friday between lunch and dinner
    expect(openAt(WEEK, at(4, 18))).toBe(true);
    expect(openAt(WEEK, at(5, 23))).toBe(true);     // Saturday night
    expect(openAt(WEEK, at(6, 1))).toBe(true);      // still Saturday's hours, past midnight
    expect(openAt(WEEK, at(6, 3))).toBe(false);
    expect(openAt(null, at(0, 9))).toBeNull();
    expect(openAt(['x', 'x', 'x', 'x', 'x', 'x', 'x'], at(0, 9))).toBeNull();
    // the slimmed map form, no day names
    expect(openAt(WEEK.map(w => w.replace(/^\w+: /, '')), at(0, 9))).toBe(true);
    expect(hoursToday(WEEK, at(6, 12))).toBe('Closed');
  });
});

describe('nearest', () => {
  it('measures and picks', () => {
    const here = { lat: 43.45, lng: -79.7 };
    expect(metres(here, { lat: 43.451, lng: -79.7 })).toBe(111);
    const list = [{ id: 'a', lat: 43.46, lng: -79.7 }, { id: 'b', lat: 43.4505, lng: -79.7 }, { id: 'c', lat: 43.45, lng: -79.7 }];
    expect(nearest(here, list)?.item.id).toBe('c');
    expect(nearest(here, list, ['c'])?.item.id).toBe('b');
    expect(nearest(here, [], [])).toBeNull();
    expect(distLabel(80)).toBe('80 m');
    expect(distLabel(1530)).toBe('1.5 km');
  });
});

describe('send info', () => {
  it('fills the texts', () => {
    expect(refLink('https://taxifi.ca/start?x=1', 'BASVI')).toBe('https://taxifi.ca/start?x=1&ref=BASVI');
    expect(refLink('', 'X')).toBe('');
    expect(fillTemplate('Hi {contact}, {business}: {link} — {rep}', { business: 'Joe’s', link: 'L', rep: 'Ann' })).toBe('Hi there, Joe’s: L — Ann');
    expect(smsHref('(905) 555-1234', 'a b')).toBe('sms:9055551234?&body=a%20b');
  });
  it('makes a calendar file', () => {
    const ics = followUpIcs({ uid: 'u1', title: 'Follow up: Joe, Inc', at: '2026-10-28T14:00:00Z', where: '1 Main St' }, new Date('2026-10-27T10:00:00Z'));
    expect(ics).toContain('DTSTART:20261028T140000Z');
    expect(ics).toContain('DTEND:20261028T141500Z');
    expect(ics).toContain('SUMMARY:Follow up: Joe\\, Inc');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
});

describe('business card', () => {
  it('pulls the contact out', () => {
    const r = parseCard('ACME PLUMBING INC\nJane Smith\nOwner\nTel: 905.555.0199\nFax 905 555 0100\nJane @ AcmePlumbing.ca\n12 Main St');
    expect(r).toEqual({ name: 'Jane Smith', phone: '(905) 555-0199', email: 'jane@acmeplumbing.ca', title: 'Owner' });
    expect(parseCard('').name).toBeNull();
  });
});

describe('offline', () => {
  it('makes ids and spots network errors', () => {
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(isOffline(new TypeError('Failed to fetch'))).toBe(true);
    expect(isOffline({ message: 'TypeError: Load failed' })).toBe(true);
    expect(isOffline(new Error('Not allowed'))).toBe(false);
  });
});
