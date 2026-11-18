// supabase/functions/nightly-report/report.ts — the nightly report email (subject, HTML and plain text) from
// report_nightly_data(). No Deno or network here, so the app's tests run it too (src/v2/lib/nightlyReport.test.ts).

export interface ManagerRow { name: string; workers: number; gross: number; payout: number }
export interface CenterReport {
  id: string; name: string; region: string | null; state: 'live' | 'closed'; closed_at: string | null;
  booked: number; showed: number; no_shows: number;
  gross: number; new_sales: number; prepaid_work: number; jobs: number; addons: number;
  payments: Record<string, number>;
  workers: number; payout: number;
  managers: ManagerRow[];
  month: { days: number; gross: number; jobs: number } | null;
}
export interface NightlyData { day: string; centers: CenterReport[] }
export interface RenderOptions { forced?: boolean; openCenters?: string[]; appUrl?: string; tz?: string }

export const APP_URL = 'https://propertystars.app/app';
const TZ = 'America/Toronto';
const METHOD_ORDER = ['Cash', 'Cheque', 'Credit Card', 'E-Transfer', 'Prepaid'];

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

/** $4,783 or $3,849.75 */
export function money(v: unknown): string {
  const x = Math.round(n(v) * 100) / 100;
  const cents = !Number.isInteger(x);
  return (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-CA', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}
const count = (v: unknown) => Math.round(n(v)).toLocaleString('en-CA');

/** "Tuesday, November 17" for a plain YYYY-MM-DD day (no time zone shift). */
export function dayLabel(day: string, weekday: 'long' | 'short' = 'long'): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-CA', { weekday, month: weekday === 'long' ? 'long' : 'short', day: 'numeric', timeZone: 'UTC' });
}
/** "8:06 AM Wed" in the report's time zone. */
export function closedLabel(iso: string | null, tz = TZ): string {
  if (!iso) return '';
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz });
  return `${time} ${wd}`;
}
const perWorker = (gross: number, workers: number) => (workers > 0 ? gross / workers : 0);

export interface Totals { gross: number; new_sales: number; prepaid_work: number; jobs: number; addons: number; workers: number; payout: number;
  booked: number; showed: number; no_shows: number; collected: number; payments: [string, number][] }

export function totals(centers: CenterReport[]): Totals {
  const t = { gross: 0, new_sales: 0, prepaid_work: 0, jobs: 0, addons: 0, workers: 0, payout: 0, booked: 0, showed: 0, no_shows: 0 };
  const pay = new Map<string, number>();
  for (const c of centers) {
    for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += n(c[k]);
    for (const [m, a] of Object.entries(c.payments || {})) pay.set(m, (pay.get(m) || 0) + n(a));
  }
  const payments = [...pay.entries()].filter(([, a]) => Math.abs(a) >= 0.005).sort((a, b) => {
    const ia = METHOD_ORDER.indexOf(a[0]), ib = METHOD_ORDER.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
  });
  const collected = payments.filter(([m]) => m !== 'Prepaid').reduce((s, [, a]) => s + a, 0);
  return { ...t, collected, payments };
}

export function subjectOf(data: NightlyData, opts: RenderOptions = {}): string {
  const t = totals(data.centers);
  const where = data.centers.length === 1 ? data.centers[0].name : `${data.centers.length} locations`;
  const open = opts.forced && opts.openCenters?.length ? ` · ${opts.openCenters.join(', ')} still open` : '';
  return `Nightly report · ${dayLabel(data.day, 'short')} · ${money(t.gross)} · ${where}${open}`;
}

// ───────────── HTML ─────────────
const H = 'font-family:Helvetica,Arial,sans-serif;';
const th = (s: string, right = false) => `<th style="${H}padding:7px 8px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:${right ? 'right' : 'left'};font-weight:700;text-transform:uppercase;letter-spacing:.04em;">${esc(s)}</th>`;
const td = (s: string, right = false, bold = false) => `<td style="${H}padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#111827;text-align:${right ? 'right' : 'left'};${bold ? 'font-weight:700;' : ''}white-space:nowrap;">${s}</td>`;
const table = (head: string, rows: string[]) => `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:6px 0 4px;"><tr>${head}</tr>${rows.join('')}</table>`;
const h2 = (s: string) => `<h2 style="${H}font-size:15px;margin:22px 0 4px;color:#111827;">${esc(s)}</h2>`;
const tile = (label: string, value: string, sub = '') => `<td style="${H}padding:10px 12px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;vertical-align:top;width:25%;">
  <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:700;">${esc(label)}</div>
  <div style="font-size:20px;color:#111827;font-weight:700;margin-top:2px;">${esc(value)}</div>${sub ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${esc(sub)}</div>` : ''}</td>`;
const tiles = (cells: string[]) => `<table role="presentation" cellpadding="0" cellspacing="6" style="width:100%;border-collapse:separate;margin:4px -6px;"><tr>${cells.join('')}</tr></table>`;

function centerStatus(c: CenterReport, tz: string): string {
  return c.state === 'closed' ? `Closed ${closedLabel(c.closed_at, tz)} ET` : 'Still open';
}

export function renderNightly(data: NightlyData, opts: RenderOptions = {}): { subject: string; html: string; text: string } {
  const tz = opts.tz || TZ;
  const app = opts.appUrl || APP_URL;
  const cs = data.centers;
  const t = totals(cs);
  const subject = subjectOf(data, opts);
  const lastClose = cs.filter(c => c.closed_at).map(c => c.closed_at!).sort().pop() || null;
  const status = opts.forced && opts.openCenters?.length
    ? `Sent before ${opts.openCenters.join(', ')} closed: the day after has ended. Their numbers are what was saved so far.`
    : cs.length > 1 ? `All ${cs.length} locations closed · the last at ${closedLabel(lastClose, tz)} ET` : `Closed ${closedLabel(lastClose, tz)} ET`;

  const byLocation = table(
    th('Location') + th('Sales', true) + th('Jobs', true) + th('Workers', true) + th('Per worker', true) + th('Paid out', true),
    [
      ...cs.map(c => `<tr>${td(esc(c.name) + (c.state === 'live' ? ' <span style="color:#b45309;font-size:12px;">(open)</span>' : ''))}${td(money(c.gross), true)}${td(count(c.jobs), true)}${td(count(c.workers), true)}${td(money(perWorker(n(c.gross), n(c.workers))), true)}${td(money(c.payout), true)}</tr>`),
      ...(cs.length > 1 ? [`<tr>${td('Total', false, true)}${td(money(t.gross), true, true)}${td(count(t.jobs), true, true)}${td(count(t.workers), true, true)}${td(money(perWorker(t.gross, t.workers)), true, true)}${td(money(t.payout), true, true)}</tr>`] : []),
    ]);

  const paid = t.payments.length ? table(th('How it was paid') + th('Amount', true),
    [...t.payments.map(([m, a]) => `<tr>${td(esc(m))}${td(money(a), true)}</tr>`),
     `<tr>${td('Collected (all but prepaid)', false, true)}${td(money(t.collected), true, true)}</tr>`]) : '';

  const sections = cs.map(c => {
    const facts = [
      centerStatus(c, tz),
      `${count(c.showed)} showed of ${count(c.booked)} booked${n(c.no_shows) ? `, ${count(c.no_shows)} no-show${n(c.no_shows) === 1 ? '' : 's'}` : ''}`,
      `${money(c.new_sales)} new sales${n(c.prepaid_work) ? ` + ${money(c.prepaid_work)} prepaid work` : ''}`,
      ...(n(c.addons) ? [`${count(c.addons)} add-on${n(c.addons) === 1 ? '' : 's'}`] : []),
      ...(c.month ? [`Month so far: ${money(c.month.gross)} over ${count(c.month.days)} day${n(c.month.days) === 1 ? '' : 's'}, ${count(c.month.jobs)} jobs`] : []),
    ];
    const mgr = c.managers?.length ? table(th('Manager') + th('Workers', true) + th('Sales', true) + th('Per worker', true),
      c.managers.map(m => `<tr>${td(esc(m.name))}${td(count(m.workers), true)}${td(money(m.gross), true)}${td(money(perWorker(n(m.gross), n(m.workers))), true)}</tr>`)) : '';
    return `${h2(c.name)}<div style="${H}font-size:13px;color:#374151;line-height:1.6;">${facts.map(esc).join('<br>')}</div>${mgr}`;
  }).join('');

  const empty = cs.length ? '' : `<p style="${H}font-size:14px;color:#374151;">No location ran a day.</p>`;
  const html = `<div style="${H}max-width:640px;margin:0 auto;padding:20px;color:#111827;">
  <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#0f766e;">Property Stars · Nightly report</div>
  <h1 style="font-size:22px;margin:6px 0 4px;">${esc(dayLabel(data.day))}</h1>
  <div style="font-size:13px;color:${opts.forced ? '#b45309' : '#6b7280'};margin-bottom:12px;">${esc(status)}</div>
  ${empty}${cs.length ? tiles([
    tile('Sales', money(t.gross), t.prepaid_work ? `${money(t.prepaid_work)} prepaid work` : ''),
    tile('Jobs', count(t.jobs), t.addons ? `+ ${count(t.addons)} add-ons` : ''),
    tile('Workers', count(t.workers), `${money(perWorker(t.gross, t.workers))} each`),
    tile('Paid out', money(t.payout), t.gross ? `${Math.round((t.payout / t.gross) * 100)}% of sales` : ''),
  ]) : ''}
  ${cs.length ? h2('By location') + byLocation : ''}
  ${paid ? h2('Payments') + paid : ''}
  ${sections}
  <p style="font-size:12px;color:#9ca3af;margin-top:24px;line-height:1.5;">Sales are every job and add-on on the day's saved payouts. This report goes out once every location that ran a day has closed it. <a href="${esc(app)}" style="color:#0f766e;">propertystars.app</a></p>
</div>`;

  const lines: string[] = [`Property Stars nightly report: ${dayLabel(data.day)}`, status, ''];
  if (!cs.length) lines.push('No location ran a day.');
  else {
    lines.push(`Sales ${money(t.gross)} · ${count(t.jobs)} jobs · ${count(t.workers)} workers (${money(perWorker(t.gross, t.workers))} each) · paid out ${money(t.payout)}`);
    if (t.prepaid_work) lines.push(`Includes ${money(t.prepaid_work)} prepaid work`);
    lines.push('', 'By location:');
    for (const c of cs) lines.push(`  ${c.name}${c.state === 'live' ? ' (open)' : ''}: ${money(c.gross)}, ${count(c.jobs)} jobs, ${count(c.workers)} workers, paid out ${money(c.payout)}`);
    if (t.payments.length) {
      lines.push('', 'Payments:');
      for (const [m, a] of t.payments) lines.push(`  ${m}: ${money(a)}`);
      lines.push(`  Collected (all but prepaid): ${money(t.collected)}`);
    }
    for (const c of cs) {
      lines.push('', `${c.name}: ${centerStatus(c, tz)}`);
      lines.push(`  ${count(c.showed)} showed of ${count(c.booked)} booked`);
      for (const m of c.managers || []) lines.push(`  ${m.name}: ${count(m.workers)} workers, ${money(m.gross)} (${money(perWorker(n(m.gross), n(m.workers)))} each)`);
      if (c.month) lines.push(`  Month so far: ${money(c.month.gross)} over ${count(c.month.days)} days`);
    }
  }
  lines.push('', app);
  return { subject, html, text: lines.join('\n') };
}
