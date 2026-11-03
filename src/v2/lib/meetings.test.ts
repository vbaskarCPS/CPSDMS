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
  it('asks the owner to have their financials or statements ready (not on a cancellation)', () => {
    const e = meetingEmail(m, 'owner', 'booked');
    expect(e.text).toContain('Financials from the previous year');
    expect(e.text).toContain('OR one month of bank statements and/or credit card statements');
    expect(e.html).toContain('To prepare for the call');
    expect(meetingEmail(m, 'owner', 'cancelled').text).not.toContain('Financials');
  });
  it('gives the host a Prep section, with what the owner was asked to bring', () => {
    const h = meetingEmail(m, 'host', 'booked');
    expect(h.html).toContain('Prep for the call');
    expect(h.html).toContain('No answers from the deck for this one.');
    expect(h.text).toContain('Owner was asked to have ready: Financials from the previous year OR one month of bank statements');
    expect(meetingEmail(m, 'host', 'cancelled').text).not.toContain('Prep for the call');
  });
  it('makes a calendar invite, and a cancellation', () => {
    const ics = icsFor(m, 'booked', new Date('2026-11-02T15:00:00Z'));
    expect(ics).toContain('DTSTART:20261103T193000Z');
    expect(ics).toContain('UID:ms-meeting-m1@propertystars.app');
    expect(ics).toContain('LOCATION:https://zoom.us/j/123');
    expect(icsFor(m, 'cancelled')).toContain('METHOD:CANCEL');
  });
  const unfold = (s: string) => s.replace(/\r\n /g, '');
  it('makes the host the organizer and invites the owner as a guest', () => {
    const ics = unfold(icsFor(m, 'booked', new Date('2026-11-02T15:00:00Z')));
    expect(ics).toContain('ORGANIZER;CN="Sam Host":mailto:sam@taxifi.ai');
    expect(ics).toContain('ATTENDEE;CN="Sam Host";ROLE=CHAIR;PARTSTAT=ACCEPTED;CUTYPE=INDIVIDUAL:mailto:sam@taxifi.ai');
    expect(ics).toContain('ATTENDEE;CN="Ann Lee";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CUTYPE=INDIVIDUAL:mailto:ann@shop.ca');
    expect(unfold(icsFor(m, 'cancelled'))).toContain('mailto:ann@shop.ca');   // so the cancellation takes it off their calendar
  });
  it('still makes an invite when the owner or host has no email', () => {
    const ics = unfold(icsFor({ ...m, owner_email: null, host: { ...m.host, email: null } }, 'booked', new Date(), 'mainstreetai@propertystars.app'));
    expect(ics).toContain('ORGANIZER;CN="Sam Host":mailto:mainstreetai@propertystars.app');
    expect(ics).not.toContain('ATTENDEE');
  });
  it('keeps every calendar line within 75 bytes', () => {
    const ics = icsFor({ ...m, business: { ...m.business, name: 'A very long business name · '.repeat(6) } }, 'booked');
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
