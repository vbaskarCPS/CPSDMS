// Meetings: grouping open times, hours summaries, and the onboarding-call email and calendar invite.
import { describe, expect, it } from 'vitest';
import { hoursSummary, minLabel, slotsByDay, toHHMM, toMin } from './meetings';
import { icsFor, meetingEmail, whenLabel, type MeetingNotice } from '../../../supabase/functions/ms-meetings/mail';

const m: MeetingNotice = {
  id: 'm1', status: 'booked', starts_at: '2026-11-03T19:30:00Z', ends_at: '2026-11-03T20:00:00Z', length_min: 30, timezone: 'America/Toronto',
  owner_name: 'Ann Lee', owner_phone: '613 555 0100', owner_email: 'ann@shop.ca', notes: 'Owns two locations',
  campaign: { id: 'c', name: 'taxifi' }, business: { id: 'b', name: 'Lee’s Bakery', address: '12 Bank St', phone: null },
  host: { id: 'h', name: 'Sam Host', email: 'sam@taxifi.ai', zoom_url: 'https://zoom.us/j/123', timezone: 'America/Vancouver' },
  rep: { id: 'r', name: 'Rita Rep', phone: '613 555 0199', email: null },
};

describe('times', () => {
  it('labels minutes and converts hh:mm', () => {
    expect(minLabel(540)).toBe('9:00 AM'); expect(minLabel(1020)).toBe('5:00 PM'); expect(minLabel(720)).toBe('12:00 PM');
    expect(toMin('13:30')).toBe(810); expect(toHHMM(810)).toBe('13:30');
  });
  it('summarises weekly hours', () => {
    expect(hoursSummary({ 1: [[540, 1020]], 2: [[540, 1020]], 3: [[540, 1020]], 4: [[540, 1020]], 5: [[540, 1020]] })).toBe('Mon–Fri 9:00 AM–5:00 PM');
    expect(hoursSummary({ 1: [[540, 720]], 3: [[540, 720]] })).toBe('Mon 9:00 AM–12:00 PM · Wed 9:00 AM–12:00 PM');
    expect(hoursSummary({})).toBe('No hours set');
  });
  it('groups open times by day in the campaign’s time zone', () => {
    const g = slotsByDay({ length_min: 30, timezone: 'America/Toronto', days_ahead: 14, hosts: 1,
      slots: [{ start: '2026-11-03T14:00:00Z', hosts: 1 }, { start: '2026-11-03T14:30:00Z', hosts: 2 }, { start: '2026-11-04T04:30:00Z', hosts: 1 }] });
    expect(g.map(x => [x.day, x.slots.length])).toEqual([['2026-11-03', 3]]);   // 04:30Z is still Nov 3 in Toronto
  });
});

describe('the emails', () => {
  it('tells the owner the time in their time zone, with the Zoom link', () => {
    const e = meetingEmail(m, 'owner', 'booked');
    expect(e.subject).toContain('taxifi onboarding call');
    expect(e.html).toContain('https://zoom.us/j/123');
    expect(e.text).toContain(whenLabel(m.starts_at, 'America/Toronto'));
    expect(e.html).not.toContain('613 555 0199');   // the rep's phone is for the host only
  });
  it('gives the host the business, owner, rep and notes, in the host’s time zone', () => {
    const e = meetingEmail(m, 'host', 'booked');
    expect(e.text).toContain('Ann Lee · 613 555 0100 · ann@shop.ca');
    expect(e.text).toContain('Rita Rep');
    expect(e.text).toContain('Owns two locations');
    expect(e.text).toContain(whenLabel(m.starts_at, 'America/Vancouver'));
  });
  it('gives the host the owner’s deck answers and the proposal they saw, and keeps them out of the owner’s email', () => {
    const withA = { ...m, answers: { summary: [['Monthly business expenses', '$25K–$50K']] as [string, string][],
      proposal: { yearly: 7783, quoted: false, lines: [['Core bookkeeping', '$549/mo']] as [string, string][] } } };
    const h = meetingEmail(withA, 'host', 'booked').text;
    expect(h).toContain('Monthly business expenses: $25K–$50K');
    expect(h).toContain('Proposal shown: about $7,783 a year: Core bookkeeping $549/mo');
    expect(meetingEmail(withA, 'owner', 'booked').text).not.toContain('25K');
  });
  it('makes a calendar invite, and a cancellation', () => {
    const ics = icsFor(m, 'booked', new Date('2026-11-02T15:00:00Z'));
    expect(ics).toContain('DTSTART:20261103T193000Z');
    expect(ics).toContain('UID:ms-meeting-m1@propertystars.app');
    expect(ics).toContain('LOCATION:https://zoom.us/j/123');
    expect(icsFor(m, 'cancelled')).toContain('METHOD:CANCEL');
  });
});
