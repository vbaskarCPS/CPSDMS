// The follow-up emails reps can turn on in Settings (supabase/functions/ms-rep-notify/mail.ts).
import { describe, expect, it } from 'vitest';
import { calendarLinks, followupIcs, morningEmail, setEmail, type FollowItem, type SetNotice } from '../../../supabase/functions/ms-rep-notify/mail';

const item: FollowItem = { visit_id: 'v1', business_id: 'b1', business: 'The Trop', address: '1501 34 Ave SW, Calgary, AB',
  campaign: 'Taxifi', follow_up_at: '2026-11-05T17:00:00Z', contact_name: 'Dana', contact_phone: '403 555 0100', contact_email: null, notes: 'Owner back Thursday' };
const set: SetNotice = { ...item, rep_id: 'r1', email: 'scott@example.com', rep_name: 'Scott Adamson', timezone: 'America/Edmonton' };

describe('follow-up emails', () => {
  it('the "set" email has the time in the rep’s zone, who to ask for, and calendar buttons', () => {
    const e = setEmail(set);
    expect(e.subject).toBe('Follow up: The Trop · Thursday, November 5 at 10:00 AM MST');
    expect(e.text).toContain('Ask for: Dana · 403 555 0100');
    expect(e.text).toContain('Notes: Owner back Thursday');
    expect(e.html).toContain('Google Calendar');
    expect(e.html).toContain('https://propertystars.app/app/rep/followups');
    expect(e.html).toContain('Hi Scott');
  });
  it('calendar links carry a 15-minute slot at the follow-up time', () => {
    const l = calendarLinks(item);
    expect(new URL(l.google).searchParams.get('dates')).toBe('20261105T170000Z/20261105T171500Z');
    expect(new URL(l.google).searchParams.get('text')).toBe('Follow up: The Trop');
    expect(new URL(l.outlook).searchParams.get('startdt')).toBe('2026-11-05T17:00:00Z');
    expect(l.outlookCom).toContain('https://outlook.live.com/calendar/');
  });
  it('the calendar file has the follow-up, a reminder, and lines within 75 bytes', () => {
    const ics = followupIcs(item, new Date('2026-11-03T12:00:00Z'));
    expect(ics).toContain('UID:ms-followup-v1@propertystars.app');
    expect(ics).toContain('DTSTART:20261105T170000Z');
    expect(ics).toContain('TRIGGER:-PT15M');
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
  it('the morning email lists the day’s follow-ups in order with their times', () => {
    const e = morningEmail({ rep_id: 'r1', email: 'scott@example.com', rep_name: 'Scott Adamson', timezone: 'America/Edmonton', day: '2026-11-05',
      items: [item, { ...item, visit_id: 'v2', business: 'Lucky Café', follow_up_at: '2026-11-05T20:30:00Z', contact_name: null, contact_phone: null, notes: null }] });
    expect(e.subject).toBe('2 follow-ups today: The Trop, Lucky Café');
    expect(e.text).toContain('Today’s follow-ups (Thursday, November 5)');
    expect(e.text).toContain('10:00 AM · The Trop');
    expect(e.text).toContain('1:30 PM · Lucky Café');
    expect(e.html).toContain('Good morning Scott');
  });
});
