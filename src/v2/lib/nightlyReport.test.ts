// The nightly report email to Ben (supabase/functions/nightly-report/report.ts).
import { describe, expect, it } from 'vitest';
import { closedLabel, dayLabel, money, renderNightly, subjectOf, totals, type CenterReport, type NightlyData } from '../../../supabase/functions/nightly-report/report';

const center = (over: Partial<CenterReport> = {}): CenterReport => ({
  id: 'c1', name: 'BC Fall RJ', region: 'BC', state: 'closed', closed_at: '2026-11-17T13:06:46Z',
  booked: 15, showed: 12, no_shows: 1,
  gross: 4783, new_sales: 3733, prepaid_work: 1050, jobs: 22, addons: 0,
  payments: { Cash: 2100, 'Credit Card': 900, Prepaid: 1050, 'E-Transfer': 733 },
  workers: 10, payout: 1348.16,
  managers: [{ name: 'Pat Lee & Sam Roy', workers: 10, gross: 4783, payout: 1348.16 }],
  month: { days: 14, gross: 50210.25, jobs: 230 },
  ...over,
});
const data = (centers: CenterReport[]): NightlyData => ({ day: '2026-11-17', centers });

describe('money', () => {
  it('shows cents only when there are some', () => {
    expect(money(4783)).toBe('$4,783');
    expect(money('3849.75')).toBe('$3,849.75');
    expect(money(1033.50476)).toBe('$1,033.50');
    expect(money(-20)).toBe('-$20');
    expect(money(null)).toBe('$0');
  });
});

describe('labels', () => {
  it('names the day without shifting it', () => {
    expect(dayLabel('2026-11-17')).toBe('Tuesday, November 17');
    expect(dayLabel('2026-11-17', 'short')).toBe('Tue, Nov 17');
  });
  it('gives the close time in Toronto time', () => {
    expect(closedLabel('2026-11-17T13:06:46Z')).toBe('8:06 AM Tue');
    expect(closedLabel(null)).toBe('');
  });
});

describe('totals', () => {
  it('adds up the locations and lists payments in the usual order', () => {
    const t = totals([center(), center({ id: 'c2', name: 'Toronto', gross: 1000, jobs: 5, workers: 4, payout: 300, payments: { Cash: 600, Cheque: 400 } })]);
    expect(t.gross).toBe(5783);
    expect(t.jobs).toBe(27);
    expect(t.workers).toBe(14);
    expect(t.payments.map(([m]) => m)).toEqual(['Cash', 'Cheque', 'Credit Card', 'E-Transfer', 'Prepaid']);
    expect(t.payments[0]).toEqual(['Cash', 2700]);
    expect(t.collected).toBe(2700 + 400 + 900 + 733);   // everything but prepaid
  });
});

describe('subject', () => {
  it('names the one location, or counts them', () => {
    expect(subjectOf(data([center()]))).toBe('Nightly report · Tue, Nov 17 · $4,783 · BC Fall RJ');
    expect(subjectOf(data([center(), center({ id: 'c2', name: 'Toronto', gross: 1000 })]))).toBe('Nightly report · Tue, Nov 17 · $5,783 · 2 locations');
  });
  it('says which ones were still open when it had to go anyway', () => {
    expect(subjectOf(data([center(), center({ id: 'c2', name: 'Toronto', state: 'live', closed_at: null })]), { forced: true, openCenters: ['Toronto'] }))
      .toBe('Nightly report · Tue, Nov 17 · $9,566 · 2 locations · Toronto still open');
  });
});

describe('renderNightly', () => {
  it('has the totals, each location, payments and managers', () => {
    const { html, text } = renderNightly(data([center()]));
    expect(html).toContain('Tuesday, November 17');
    expect(html).toContain('Closed 8:06 AM Tue ET');
    expect(html).toContain('$4,783');
    expect(html).toContain('$1,050 prepaid work');
    expect(html).toContain('Pat Lee &amp; Sam Roy');
    expect(html).toContain('$478.30');                 // per worker
    expect(html).toContain('Collected (all but prepaid)');
    expect(html).toContain('Month so far: $50,210.25 over 14 days, 230 jobs');
    expect(text).toContain('Sales $4,783 · 22 jobs · 10 workers ($478.30 each) · paid out $1,348.16');
    expect(text).toContain('  Prepaid: $1,050');
  });
  it('escapes names', () => {
    const { html } = renderNightly(data([center({ name: '<b>X</b>' })]));
    expect(html).not.toContain('<b>X</b>');
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
  });
  it('flags a location that was still open', () => {
    const { html, text } = renderNightly(data([center({ state: 'live', closed_at: null })]), { forced: true, openCenters: ['BC Fall RJ'] });
    expect(html).toContain('Sent before BC Fall RJ closed');
    expect(html).toContain('(open)');
    expect(text).toContain('BC Fall RJ: Still open');
  });
  it('handles a day with nothing saved yet', () => {
    const { html, text } = renderNightly(data([center({ gross: 0, new_sales: 0, prepaid_work: 0, jobs: 0, workers: 0, payout: 0, payments: {}, managers: [], month: null })]));
    expect(html).toContain('$0');
    expect(html).not.toContain('NaN');
    expect(text).not.toContain('NaN');
  });
});
