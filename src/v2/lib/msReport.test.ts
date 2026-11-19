// The MainstreetAI daily report email (supabase/functions/ms-report/report.ts).
import { describe, expect, it } from 'vitest';
import { dayLabel, outFor, renderMsReport, subjectOf, whenLabel, type MsData, type RepRow } from '../../../supabase/functions/ms-report/report';

const rep = (over: Partial<RepRow> = {}): RepRow => ({
  name: 'Sam Lee', visits: 14, goal: 40, interested: 2, follow_up: 3, come_back: 8, not_interested: 1, other: 0,
  far: 0, meetings: 1, deals: 0, started_at: '2026-11-18T15:00:00Z', ended_at: '2026-11-18T21:20:00Z', distance_m: 5200, ...over,
});
const data = (over: Partial<MsData> = {}): MsData => ({
  day: '2026-11-18', from: '2026-11-18T02:30:00+00:00', to: '2026-11-19T02:30:00+00:00', tz: 'America/Toronto',
  totals: { visits: 18, businesses: 17, reps_out: 2, reps_total: 31, interested: 2, follow_up: 4, come_back: 10, not_interested: 1, other: 1,
    meetings_booked: 1, deals_new: 1, deals_approved: 0, deals_rejected: 0, questionnaires: 2, pitched: 3, leads_added: 5, followups_sent: 0, info_sent: 4 },
  reps: [rep(), rep({ name: 'Ada <Park>', visits: 4, interested: 0, follow_up: 1, come_back: 2, not_interested: 0, other: 1, far: 2, meetings: 0, deals: 1, started_at: null, ended_at: null })],
  meetings_booked: [{ business: 'Corner Bakery', rep: 'Sam Lee', host: 'Pat Roy', starts_at: '2026-11-19T15:00:00Z' }],
  meetings_next: [{ business: 'Corner Bakery', rep: 'Sam Lee', host: 'Pat Roy', starts_at: '2026-11-19T15:00:00Z' }],
  meeting_outcomes: [{ business: 'Main St Deli', rep: 'Sam Lee', status: 'no_show', note: null }],
  deals_waiting: 1,
  pipeline: { new: 44, pitched: 11, questionnaire: 8, booked: 1, won: 0, lost: 13 },
  week: { from: '2026-11-16T05:00:00+00:00', visits: 30, reps_out: 3, meetings: 1, deals: 1, approved: 0 },
  zones: { active: 54, no_rep: 5, reps_with_zone: 31, quiet_reps: 28 },
  flags: { far_open: 36, leads_waiting: 0 },
  ...over,
});
const none = (): MsData => data({
  totals: { visits: 0, businesses: 0, reps_out: 0, reps_total: 31, interested: 0, follow_up: 0, come_back: 0, not_interested: 0, other: 0,
    meetings_booked: 0, deals_new: 0, deals_approved: 0, deals_rejected: 0, questionnaires: 0, pitched: 0, leads_added: 0, followups_sent: 0, info_sent: 0 },
  reps: [], meetings_booked: [], meetings_next: [], meeting_outcomes: [], deals_waiting: 0,
});

describe('labels', () => {
  it('names the day without a time zone shift', () => {
    expect(dayLabel('2026-11-18')).toBe('Wednesday, November 18');
  });
  it('shows a meeting time in the report time zone', () => {
    expect(whenLabel('2026-11-19T15:00:00Z', 'America/Toronto')).toBe('Thu 10:00 AM');
  });
  it('shows time out only when the rep started and ended a day', () => {
    expect(outFor(rep())).toBe('6h 20m');
    expect(outFor(rep({ started_at: null }))).toBe('');
    expect(outFor(rep({ ended_at: '2026-11-18T15:45:00Z' }))).toBe('45m');
  });
});

describe('subject', () => {
  it('leads with visits and reps out', () => {
    expect(subjectOf(data())).toBe('MainstreetAI daily report · Wed, Nov 18 · 18 visits · 2 reps out · 1 meeting booked · 1 deal');
  });
  it('says so when nothing happened', () => {
    expect(subjectOf(none())).toBe('MainstreetAI daily report · Wed, Nov 18 · no activity');
  });
});

describe('renderMsReport', () => {
  it('lists each rep with a total row, and escapes names', () => {
    const { html, text } = renderMsReport(data());
    expect(html).toContain('Sam Lee');
    expect(html).toContain('Ada &lt;Park&gt;');
    expect(html).not.toContain('Ada <Park>');
    expect(html).toContain('>Total<');
    expect(html).toContain('2 logged far away');
    expect(text).toContain('Sam Lee: 14 visits of 40 (2 interested, 3 follow up, 8 come back, 1 no), 1 meeting, 0 deals, out 6h 20m');
  });
  it('carries meetings, deals, the pipeline and the week', () => {
    const { text } = renderMsReport(data());
    expect(text).toContain('Corner Bakery · Thu 10:00 AM ET with Pat Roy (booked by Sam Lee)');
    expect(text).toContain('Main St Deli: No-show');
    expect(text).toContain('Deals: 1 new deal sent in · 1 waiting for approval');
    expect(text).toContain('Pipeline now: 44 new, 11 pitched, 8 questionnaire, 1 booked, 0 won, 13 lost');
    expect(text).toContain('Week so far: 30 visits by 3 reps · 1 meeting booked · 1 deal sent in, 0 approved');
    expect(text).toContain('5 zones of 54 with no rep');
  });
  it('still goes out on a day with nothing logged', () => {
    const { html, text } = renderMsReport(none());
    expect(text).toContain('Nothing was logged.');
    expect(html).toContain('No rep logged a visit, a meeting or a deal.');
    expect(html).not.toContain('>Meetings<');
    expect(text).toContain('Pipeline now: 44 new');
  });
  it('says which hours it covers', () => {
    expect(renderMsReport(data()).text).toContain('Covers 9:30 PM the night before to 9:30 PM Eastern.');
  });
});
