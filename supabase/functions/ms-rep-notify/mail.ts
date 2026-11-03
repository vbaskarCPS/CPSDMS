// supabase/functions/ms-rep-notify/mail.ts — the follow-up emails a rep can turn on in Settings. No Deno or network
// here, so the app's tests run it too (src/v2/lib/repNotify.test.ts).

export interface FollowItem {
  visit_id: string; business_id: string; business: string; address: string | null; campaign: string | null;
  follow_up_at: string; contact_name: string | null; contact_phone: string | null; contact_email: string | null; notes: string | null;
}
export interface SetNotice extends FollowItem { rep_id: string; email: string; rep_name: string | null; timezone: string }
export interface MorningNotice { rep_id: string; email: string; rep_name: string | null; timezone: string; day: string; items: FollowItem[] }

export const APP_FOLLOWUPS = 'https://propertystars.app/app/rep/followups';
const MINUTES = 15;   // same length as the calendar file the app makes when a follow-up is saved

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const first = (s: string | null) => (s || '').trim().split(/\s+/)[0] || '';

/** "Thursday, November 5 at 10:00 AM MST" in a time zone. */
export function whenLabel(iso: string, tz: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short' });
  return `${day} at ${time}`;
}
const timeLabel = (iso: string, tz: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => `\\${m}`);
const end = (iso: string) => new Date(new Date(iso).getTime() + MINUTES * 60000);
const titleOf = (x: FollowItem) => `Follow up: ${x.business}`;
const who = (x: FollowItem) => [x.contact_name, x.contact_phone, x.contact_email].filter(Boolean).join(' · ');
const detailsOf = (x: FollowItem) => [who(x) ? `Ask for: ${who(x)}` : '', x.notes ? `Notes: ${x.notes}` : '', x.campaign ? `Campaign: ${x.campaign}` : '',
  `Open in the app: ${APP_FOLLOWUPS}`].filter(Boolean).join('\n');

/** Add to calendar links: Google, Outlook (Microsoft 365) and Outlook.com. */
export function calendarLinks(x: FollowItem): { google: string; outlook: string; outlookCom: string } {
  const start = new Date(x.follow_up_at), stop = end(x.follow_up_at);
  const g = new URLSearchParams({ action: 'TEMPLATE', text: titleOf(x), dates: `${icsDate(start)}/${icsDate(stop)}`, details: detailsOf(x), location: x.address || '' });
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const o = (base: string) => `${base}?${new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: titleOf(x),
    startdt: iso(start), enddt: iso(stop), body: detailsOf(x), location: x.address || '' })}`;
  return {
    google: `https://calendar.google.com/calendar/render?${g}`,
    outlook: o('https://outlook.office.com/calendar/0/deeplink/compose'),
    outlookCom: o('https://outlook.live.com/calendar/0/deeplink/compose'),
  };
}

/** A calendar file for one follow-up (Apple Calendar and the rest), with a reminder 15 minutes before. */
export function followupIcs(x: FollowItem, now = new Date()): string {
  const fold = (line: string) => {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const parts: string[] = []; let cur = '', bytes = 0, limit = 75;
    for (const ch of line) { const n = enc.encode(ch).length; if (bytes + n > limit) { parts.push(cur); cur = ''; bytes = 0; limit = 74; } cur += ch; bytes += n; }
    parts.push(cur); return parts.join('\r\n ');
  };
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MainstreetAI//Rep//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:ms-followup-${x.visit_id}@propertystars.app`, `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(new Date(x.follow_up_at))}`, `DTEND:${icsDate(end(x.follow_up_at))}`,
    `SUMMARY:${icsText(titleOf(x))}`, ...(x.address ? [`LOCATION:${icsText(x.address)}`] : []), `DESCRIPTION:${icsText(detailsOf(x))}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(titleOf(x))}`, 'TRIGGER:-PT15M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].map(fold).join('\r\n');
}

const pill = (href: string, label: string) => `<a href="${esc(href)}" style="display:inline-block;margin:0 6px 6px 0;padding:7px 11px;border:1.5px solid #0f766e;border-radius:8px;color:#0f766e;text-decoration:none;font-size:13px;font-weight:700;">${esc(label)}</a>`;
const pills = (x: FollowItem) => { const l = calendarLinks(x); return pill(l.google, 'Google Calendar') + pill(l.outlook, 'Outlook') + pill(l.outlookCom, 'Outlook.com'); };
const rowsOf = (x: FollowItem, tz: string): [string, string][] => [
  ['When', whenLabel(x.follow_up_at, tz)],
  ...(x.address ? [['Where', x.address] as [string, string]] : []),
  ...(who(x) ? [['Ask for', who(x)] as [string, string]] : []),
  ...(x.notes ? [['Notes', x.notes] as [string, string]] : []),
  ...(x.campaign ? [['Campaign', x.campaign] as [string, string]] : []),
];
const table = (rows: [string, string][]) => `<table style="border-collapse:collapse;">${rows.map(([k, v]) =>
  `<tr><td style="padding:5px 12px 5px 0;color:#6b7280;font-size:13px;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:5px 0;font-size:14px;color:#111827;">${esc(v)}</td></tr>`).join('')}</table>`;
const frame = (head: string, title: string, intro: string, body: string) => `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
  <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#0f766e;">${esc(head)}</div>
  <h1 style="font-size:20px;margin:6px 0 10px;color:#111827;">${esc(title)}</h1>
  <p style="font-size:14px;color:#374151;line-height:1.5;margin:0 0 12px;">${intro}</p>
  ${body}
  <p style="margin:18px 0 6px;"><a href="${APP_FOLLOWUPS}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:10px;">Open follow-ups in the app</a></p>
  <p style="font-size:12px;color:#9ca3af;margin-top:18px;">MainstreetAI. You turned these emails on in the rep app’s Settings; turn them off there.</p>
</div>`;

/** The email when a rep sets a follow-up. */
export function setEmail(n: SetNotice): { subject: string; html: string; text: string } {
  const when = whenLabel(n.follow_up_at, n.timezone);
  const l = calendarLinks(n);
  const html = frame('Follow-up set', n.business, `Hi ${esc(first(n.rep_name)) || 'there'}, here’s the follow-up you just set.`,
    `${table(rowsOf(n, n.timezone))}
  <div style="margin:14px 0 0;"><div style="font-size:13px;color:#6b7280;margin-bottom:6px;">Add it to your calendar</div>${pills(n)}
  <div style="font-size:12px;color:#9ca3af;">Apple Calendar or another app: open the attached follow-up.ics.</div></div>`);
  const text = [`Follow-up set: ${n.business}`, '', ...rowsOf(n, n.timezone).map(([k, v]) => `${k}: ${v}`), '',
    'Add it to your calendar:', `Google Calendar: ${l.google}`, `Outlook: ${l.outlook}`, `Outlook.com: ${l.outlookCom}`,
    'Apple Calendar or another app: open the attached follow-up.ics.', '', `Open follow-ups in the app: ${APP_FOLLOWUPS}`].join('\n');
  return { subject: `Follow up: ${n.business} · ${when}`, html, text };
}

/** The 8 AM email: today's follow-ups. */
export function morningEmail(n: MorningNotice): { subject: string; html: string; text: string } {
  const count = n.items.length;
  const dayLabel = new Date(`${n.day}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const cards = n.items.map(x => `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;margin:0 0 10px;">
    <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">${esc(timeLabel(x.follow_up_at, n.timezone))} · ${esc(x.business)}</div>
    ${table(rowsOf(x, n.timezone).filter(([k]) => k !== 'When'))}
    <div style="margin-top:8px;">${pills(x)}</div></div>`).join('');
  const html = frame('Today’s follow-ups', `${count} follow-up${count === 1 ? '' : 's'} today`,
    `Good morning ${esc(first(n.rep_name)) || ''}. Here’s who to follow up with on ${esc(dayLabel)}.`.replace(' .', '.'), cards);
  const text = [`Today’s follow-ups (${dayLabel})`, '', ...n.items.flatMap(x => {
    const l = calendarLinks(x);
    return [`${timeLabel(x.follow_up_at, n.timezone)} · ${x.business}`, ...rowsOf(x, n.timezone).filter(([k]) => k !== 'When').map(([k, v]) => `  ${k}: ${v}`),
      `  Google Calendar: ${l.google}`, `  Outlook: ${l.outlook}`, `  Outlook.com: ${l.outlookCom}`, ''];
  }), `Open follow-ups in the app: ${APP_FOLLOWUPS}`].join('\n');
  return { subject: `${count} follow-up${count === 1 ? '' : 's'} today: ${n.items.map(x => x.business).slice(0, 3).join(', ')}${count > 3 ? '…' : ''}`, html, text };
}
