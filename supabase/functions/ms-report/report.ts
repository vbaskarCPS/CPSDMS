// supabase/functions/ms-report/report.ts — the MainstreetAI daily report email (subject, HTML and plain text) from
// ms_report_data(). No Deno or network here, so the app's tests run it too (src/v2/lib/msReport.test.ts).

export interface RepRow {
  name: string; visits: number; goal: number;
  interested: number; follow_up: number; come_back: number; not_interested: number; other: number;
  far: number; meetings: number; deals: number;
  started_at: string | null; ended_at: string | null; distance_m: number;
}
export interface MeetingRow { business: string | null; rep: string | null; host: string | null; starts_at: string }
export interface OutcomeRow { business: string | null; rep: string | null; status: 'closed' | 'no_show' | 'not_fit'; note: string | null }
export interface MsData {
  day: string; from: string; to: string; tz: string;
  totals: {
    visits: number; businesses: number; reps_out: number; reps_total: number;
    interested: number; follow_up: number; come_back: number; not_interested: number; other: number;
    meetings_booked: number; deals_new: number; deals_approved: number; deals_rejected: number;
    questionnaires: number; pitched: number; leads_added: number; followups_sent: number; info_sent: number;
  };
  reps: RepRow[];
  meetings_booked: MeetingRow[]; meetings_next: MeetingRow[]; meeting_outcomes: OutcomeRow[];
  deals_waiting: number;
  pipeline: { new: number; pitched: number; questionnaire: number; booked: number; won: number; lost: number };
  week: { from: string; visits: number; reps_out: number; meetings: number; deals: number; approved: number };
  zones: { active: number; no_rep: number; reps_with_zone: number; quiet_reps: number };
  flags: { far_open: number; leads_waiting: number };
}

export const APP_URL = 'https://propertystars.app/app/mainstreet';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const count = (v: unknown) => Math.round(n(v)).toLocaleString('en-CA');
const plural = (v: unknown, one: string, many = one + 's') => `${count(v)} ${n(v) === 1 ? one : many}`;

/** "Wednesday, November 18" for a plain YYYY-MM-DD day (no time zone shift). */
export function dayLabel(day: string, weekday: 'long' | 'short' = 'long'): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-CA', { weekday, month: weekday === 'long' ? 'long' : 'short', day: 'numeric', timeZone: 'UTC' });
}
/** "9:30 PM" in the report's time zone. */
export function timeLabel(iso: string | null, tz: string): string {
  return iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }) : '';
}
/** "Thu 10:00 AM" in the report's time zone. */
export function whenLabel(iso: string, tz: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz })} ${timeLabel(iso, tz)}`;
}
/** Time out in the field: "6h 20m", or "" when the rep never started a day in the app. */
export function outFor(r: Pick<RepRow, 'started_at' | 'ended_at'>): string {
  if (!r.started_at || !r.ended_at) return '';
  const min = Math.round((new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 60000);
  if (!(min > 0)) return '';
  return min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min}m`;
}
const OUTCOME: Record<OutcomeRow['status'], string> = { closed: 'Closed (won)', no_show: 'No-show', not_fit: 'Not a fit' };
const quiet = (d: MsData) => !n(d.totals.visits) && !d.reps.length && !d.meetings_booked.length && !d.meeting_outcomes.length
  && !n(d.totals.deals_new) && !n(d.totals.deals_approved) && !n(d.totals.deals_rejected) && !n(d.totals.questionnaires) && !n(d.totals.leads_added);

export function subjectOf(d: MsData): string {
  const t = d.totals;
  const bits = quiet(d) ? ['no activity'] : [plural(t.visits, 'visit'), `${plural(t.reps_out, 'rep')} out`,
    ...(n(t.meetings_booked) ? [`${plural(t.meetings_booked, 'meeting')} booked`] : []),
    ...(n(t.deals_new) ? [plural(t.deals_new, 'deal')] : [])];
  return `MainstreetAI daily report · ${dayLabel(d.day, 'short')} · ${bits.join(' · ')}`;
}

// ───────────── HTML ─────────────
const H = 'font-family:Helvetica,Arial,sans-serif;';
const th = (s: string, right = false) => `<th style="${H}padding:7px 6px;border-bottom:2px solid #e5e7eb;font-size:11px;color:#6b7280;text-align:${right ? 'right' : 'left'};font-weight:700;text-transform:uppercase;letter-spacing:.04em;">${esc(s)}</th>`;
const td = (s: string, right = false, bold = false) => `<td style="${H}padding:7px 6px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#111827;text-align:${right ? 'right' : 'left'};${bold ? 'font-weight:700;' : ''}">${s}</td>`;
const table = (head: string, rows: string[]) => `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:6px 0 4px;"><tr>${head}</tr>${rows.join('')}</table>`;
const h2 = (s: string) => `<h2 style="${H}font-size:15px;margin:22px 0 4px;color:#111827;">${esc(s)}</h2>`;
const note = (s: string) => `<div style="${H}font-size:13px;color:#374151;line-height:1.6;">${s}</div>`;
const tile = (label: string, value: string, ...subs: string[]) => `<td style="${H}padding:10px 12px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;vertical-align:top;width:25%;">
  <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:700;">${esc(label)}</div>
  <div style="font-size:20px;color:#111827;font-weight:700;margin-top:2px;">${esc(value)}</div>${subs.filter(Boolean).map(x => `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${esc(x)}</div>`).join('')}</td>`;
const tiles = (cells: string[]) => `<table role="presentation" cellpadding="0" cellspacing="6" style="width:100%;border-collapse:separate;margin:4px -6px;"><tr>${cells.join('')}</tr></table>`;
const meetingLine = (m: MeetingRow, tz: string) => `${m.business || 'A business'} · ${whenLabel(m.starts_at, tz)} ET${m.host ? ` with ${m.host}` : ''}${m.rep ? ` (booked by ${m.rep})` : ''}`;

export function renderMsReport(d: MsData, opts: { appUrl?: string } = {}): { subject: string; html: string; text: string } {
  const tz = d.tz || 'America/Toronto';
  const app = opts.appUrl || APP_URL;
  const t = d.totals, p = d.pipeline, w = d.week, z = d.zones;
  const subject = subjectOf(d);
  const covers = `Covers ${timeLabel(d.from, tz)} the night before to ${timeLabel(d.to, tz)} Eastern.`;
  const totalRow: RepRow | null = d.reps.length > 1 ? {
    name: 'Total', visits: n(t.visits), goal: 0, interested: n(t.interested), follow_up: n(t.follow_up), come_back: n(t.come_back),
    not_interested: n(t.not_interested), other: n(t.other), far: 0, meetings: n(t.meetings_booked), deals: n(t.deals_new), started_at: null, ended_at: null, distance_m: 0 } : null;
  const repRow = (r: RepRow, bold = false) => `<tr>${td(esc(r.name) + (n(r.far) ? ` <span style="color:#b45309;font-size:12px;">${esc(count(r.far))} logged far away</span>` : ''), false, bold)}${td(count(r.visits) + (n(r.goal) ? `<span style="color:#9ca3af;font-size:12px;"> / ${esc(count(r.goal))}</span>` : ''), true, bold)}${td(count(r.interested), true, bold)}${td(count(r.follow_up), true, bold)}${td(count(r.come_back), true, bold)}${td(count(n(r.not_interested) + n(r.other)), true, bold)}${td(count(r.meetings), true, bold)}${td(count(r.deals), true, bold)}${td(bold ? '' : esc(outFor(r)), true)}</tr>`;
  const reps = d.reps.length ? table(
    th('Rep') + th('Visits', true) + th('Interested', true) + th('Follow up', true) + th('Come back', true) + th('No', true) + th('Meetings', true) + th('Deals', true) + th('Time out', true),
    [...d.reps.map(r => repRow(r)), ...(totalRow ? [repRow(totalRow, true)] : [])]) : note('No rep logged a visit, a meeting or a deal.');

  const extras = [
    n(t.questionnaires) ? `${plural(t.questionnaires, 'questionnaire')} filled in` : '',
    n(t.pitched) ? `${plural(t.pitched, 'business', 'businesses')} pitched` : '',
    n(t.leads_added) ? `${plural(t.leads_added, 'business', 'businesses')} added by reps` : '',
    n(t.info_sent) ? `info sent ${plural(t.info_sent, 'time')}` : '',
    n(t.followups_sent) ? `${plural(t.followups_sent, 'follow-up email')} sent` : '',
  ].filter(Boolean);

  const meet = [
    ...(d.meetings_booked.length ? [`<b>Booked today</b><br>${d.meetings_booked.map(m => esc(meetingLine(m, tz))).join('<br>')}`] : []),
    ...(d.meeting_outcomes.length ? [`<b>Held today</b><br>${d.meeting_outcomes.map(o => esc(`${o.business || 'A business'} · ${OUTCOME[o.status] || o.status}${o.note ? `: ${o.note}` : ''}`)).join('<br>')}`] : []),
    ...(d.meetings_next.length ? [`<b>Next 24 hours</b><br>${d.meetings_next.map(m => esc(meetingLine(m, tz))).join('<br>')}`] : []),
  ];
  const deals = [
    n(t.deals_new) ? `${plural(t.deals_new, 'new deal')} sent in` : '',
    n(t.deals_approved) ? `${count(t.deals_approved)} approved` : '',
    n(t.deals_rejected) ? `${count(t.deals_rejected)} rejected` : '',
    n(d.deals_waiting) ? `${count(d.deals_waiting)} waiting for approval` : '',
  ].filter(Boolean);
  const watch = [
    n(z.no_rep) ? `${plural(z.no_rep, 'zone')} of ${count(z.active)} with no rep` : '',
    n(z.quiet_reps) ? `${count(z.quiet_reps)} of ${plural(z.reps_with_zone, 'rep')} with a zone logged no visit in 7 days` : '',
    n(d.flags.far_open) ? `${plural(d.flags.far_open, 'visit')} logged far from the business, not yet reviewed` : '',
    n(d.flags.leads_waiting) ? `${plural(d.flags.leads_waiting, 'card lead')} waiting` : '',
  ].filter(Boolean);
  const pipe = table(th('New', true) + th('Pitched', true) + th('Questionnaire', true) + th('Booked', true) + th('Won', true) + th('Lost', true),
    [`<tr>${[p.new, p.pitched, p.questionnaire, p.booked, p.won, p.lost].map(x => td(count(x), true)).join('')}</tr>`]);
  const weekLine = `${plural(w.visits, 'visit')} by ${plural(w.reps_out, 'rep')} · ${plural(w.meetings, 'meeting')} booked · ${plural(w.deals, 'deal')} sent in, ${count(w.approved)} approved`;

  const html = `<div style="${H}max-width:680px;margin:0 auto;padding:20px;color:#111827;">
  <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#1d4ed8;">MainstreetAI · Daily report</div>
  <h1 style="font-size:22px;margin:6px 0 4px;">${esc(dayLabel(d.day))}</h1>
  <div style="font-size:13px;color:#6b7280;margin-bottom:12px;">${esc(quiet(d) ? `Nothing was logged. ${covers}` : covers)}</div>
  ${tiles([
    tile('Visits', count(t.visits), n(t.businesses) !== n(t.visits) ? `${plural(t.businesses, 'business', 'businesses')}` : ''),
    tile('Reps out', count(t.reps_out), `of ${count(t.reps_total)}`),
    tile('Meetings booked', count(t.meetings_booked)),
    tile('Deals', count(t.deals_new), n(d.deals_waiting) ? `${count(d.deals_waiting)} waiting for approval` : ''),
  ])}
  ${h2('By rep')}${reps}
  ${extras.length ? note(esc(extras.join(' · '))) : ''}
  ${meet.length ? h2('Meetings') + note(meet.join('<br><br>')) : ''}
  ${deals.length ? h2('Deals') + note(esc(deals.join(' · '))) : ''}
  ${h2('Pipeline now')}${pipe}
  ${h2('Week so far')}${note(esc(weekLine))}
  ${watch.length ? h2('Worth a look') + note(watch.map(esc).join('<br>')) : ''}
  <p style="font-size:12px;color:#9ca3af;margin-top:24px;line-height:1.5;">A visit is one logged stop at a business. "No" is not interested, closed for good, or can't be sold. The week starts Monday. <a href="${esc(app)}" style="color:#1d4ed8;">Open MainstreetAI</a></p>
</div>`;

  const lines: string[] = [`MainstreetAI daily report: ${dayLabel(d.day)}`, quiet(d) ? `Nothing was logged. ${covers}` : covers, '',
    `${plural(t.visits, 'visit')} · ${count(t.reps_out)} of ${plural(t.reps_total, 'rep')} out · ${plural(t.meetings_booked, 'meeting')} booked · ${plural(t.deals_new, 'deal')}`];
  if (d.reps.length) {
    lines.push('', 'By rep:');
    for (const r of d.reps) lines.push(`  ${r.name}: ${plural(r.visits, 'visit')}${n(r.goal) ? ` of ${count(r.goal)}` : ''} (${count(r.interested)} interested, ${count(r.follow_up)} follow up, ${count(r.come_back)} come back, ${count(n(r.not_interested) + n(r.other))} no), ${plural(r.meetings, 'meeting')}, ${plural(r.deals, 'deal')}${outFor(r) ? `, out ${outFor(r)}` : ''}${n(r.far) ? `, ${count(r.far)} logged far away` : ''}`);
  }
  if (extras.length) lines.push('', extras.join(' · '));
  if (d.meetings_booked.length) { lines.push('', 'Meetings booked today:'); for (const m of d.meetings_booked) lines.push(`  ${meetingLine(m, tz)}`); }
  if (d.meeting_outcomes.length) { lines.push('', 'Meetings held today:'); for (const o of d.meeting_outcomes) lines.push(`  ${o.business || 'A business'}: ${OUTCOME[o.status] || o.status}${o.note ? `: ${o.note}` : ''}`); }
  if (d.meetings_next.length) { lines.push('', 'Meetings in the next 24 hours:'); for (const m of d.meetings_next) lines.push(`  ${meetingLine(m, tz)}`); }
  if (deals.length) lines.push('', `Deals: ${deals.join(' · ')}`);
  lines.push('', `Pipeline now: ${count(p.new)} new, ${count(p.pitched)} pitched, ${count(p.questionnaire)} questionnaire, ${count(p.booked)} booked, ${count(p.won)} won, ${count(p.lost)} lost`);
  lines.push(`Week so far: ${weekLine}`);
  if (watch.length) { lines.push('', 'Worth a look:'); for (const x of watch) lines.push(`  ${x}`); }
  lines.push('', app);
  return { subject, html, text: lines.join('\n') };
}
