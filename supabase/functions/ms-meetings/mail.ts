// supabase/functions/ms-meetings/mail.ts — the onboarding-call emails and calendar invite. No Deno or network
// here, so the app's tests run it too (src/v2/lib/meetings.test.ts).

export interface MeetingNotice {
  id: string; status: string; starts_at: string; ends_at: string; length_min: number; timezone: string;
  owner_name: string; owner_phone: string | null; owner_email: string | null; notes: string | null;
  campaign: { id: string; name: string; color?: string | null };
  business: { id: string; name: string; address: string | null; phone: string | null };
  host: { id: string; name: string; email: string | null; zoom_url: string | null; timezone: string };
  rep: { id: string; name: string; phone: string | null; email: string | null } | null;
  answers?: { summary?: [string, string][]; proposal?: { yearly: number; quoted: boolean; lines: [string, string][] } | null } | null;
}
type Kind = 'booked' | 'changed' | 'cancelled';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** "Tuesday, November 3 at 2:30 PM EST" in a time zone. */
export function whenLabel(iso: string, tz: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short' });
  return `${day} at ${time}`;
}

/** What the owner is asked to have ready, so the call goes quickly. */
export const OWNER_PREP = {
  title: 'To prepare for the call',
  intro: 'To streamline the process, please have one of these ready:',
  items: ['Financials from the previous year', 'OR one month of bank statements and/or credit card statements'],
};

const first = (s: string) => (s || '').trim().split(/\s+/)[0] || s;

/** "Add to calendar" links for the owner. Each makes its own copy of the event in that calendar (it won't follow a
 *  move or cancellation; the attached invite does). */
export function calendarLinks(m: MeetingNotice): { google: string; outlook: string; outlookCom: string } {
  const title = `${m.campaign.name} onboarding call with ${m.host.name}`;
  const details = [m.host.zoom_url ? `Join the Zoom call: ${m.host.zoom_url}` : '', `${OWNER_PREP.intro} ${OWNER_PREP.items.join(' ')}`]
    .filter(Boolean).join('\n\n');
  const where = m.host.zoom_url || '';
  const g = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${icsDate(m.starts_at)}/${icsDate(m.ends_at)}`, details, location: where });
  const iso = (s: string) => new Date(s).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const o = (base: string) => `${base}?${new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: title,
    startdt: iso(m.starts_at), enddt: iso(m.ends_at), body: details, location: where })}`;
  return {
    google: `https://calendar.google.com/calendar/render?${g}`,
    outlook: o('https://outlook.office.com/calendar/0/deeplink/compose'),       // work / school (Microsoft 365)
    outlookCom: o('https://outlook.live.com/calendar/0/deeplink/compose'),      // Outlook.com, Hotmail
  };
}

export function meetingEmail(m: MeetingNotice, who: 'owner' | 'host', kind: Kind): { fromName: string; subject: string; html: string; text: string } {
  const tz = who === 'host' ? (m.host.timezone || m.timezone) : m.timezone;
  const when = whenLabel(m.starts_at, tz);
  const company = m.campaign.name;
  const zoom = m.host.zoom_url;
  const head = kind === 'cancelled' ? 'Cancelled' : kind === 'changed' ? 'New time' : who === 'owner' ? 'You’re booked' : 'New onboarding call';
  const subject = who === 'owner'
    ? (kind === 'cancelled' ? `Cancelled: your ${company} onboarding call` : kind === 'changed' ? `New time for your ${company} onboarding call` : `Your ${company} onboarding call · ${when}`)
    : (kind === 'cancelled' ? `Cancelled: ${m.business.name} onboarding` : kind === 'changed' ? `Moved: ${m.business.name} onboarding · ${when}` : `Onboarding call: ${m.business.name} · ${when}`);
  const lines: [string, string][] = who === 'owner'
    ? [['When', `${when} (${m.length_min} minutes)`], ['With', `${m.host.name}, ${company}`], ...(zoom && kind !== 'cancelled' ? [['Join', zoom] as [string, string]] : [])]
    : [['When', `${when} (${m.length_min} minutes)`], ['Business', `${m.business.name}${m.business.address ? `, ${m.business.address}` : ''}`],
       ['Owner', [m.owner_name, m.owner_phone, m.owner_email].filter(Boolean).join(' · ')],
       ...(m.rep ? [['Booked by', `${m.rep.name}${m.rep.phone ? ` · ${m.rep.phone}` : ''}`] as [string, string]] : []),
       ...(m.notes ? [['Rep’s notes', m.notes] as [string, string]] : []),
       ['Your Zoom', zoom || 'No Zoom link saved yet: add it under My hours']];
  // the host's prep: what the owner answered on the deck, the proposal they saw, and what they were asked to bring
  const prep: [string, string][] = who === 'host' && kind !== 'cancelled' ? [
    ...((m.answers?.summary || []).map(([q, a]) => [q, a] as [string, string])),
    ...(m.answers?.proposal ? [['Proposal shown', `about $${Math.round(m.answers.proposal.yearly).toLocaleString('en-CA')} a year${m.answers.proposal.quoted ? ' plus Core (quoted)' : ''}: `
      + m.answers.proposal.lines.map(([k, v]) => `${k} ${v}`).join(', ')] as [string, string]] : []),
    ['Owner was asked to have ready', OWNER_PREP.items.join(' ')],
  ] : [];
  const hasDeck = !!(m.answers?.summary?.length || m.answers?.proposal);
  const intro = who === 'owner'
    ? (kind === 'cancelled' ? `Hi ${esc(first(m.owner_name))}, your onboarding call with ${esc(company)} has been cancelled. We’ll be in touch to find a new time.`
      : kind === 'changed' ? `Hi ${esc(first(m.owner_name))}, your onboarding call with ${esc(company)} has a new time.`
      : `Hi ${esc(first(m.owner_name))}, thanks for choosing ${esc(company)}. Here’s your onboarding call, where we get you set up.`)
    : (kind === 'cancelled' ? `This onboarding call was cancelled.` : kind === 'changed' ? `This onboarding call was moved.` : `You have a new onboarding call.`);
  const row = ([k, v]: [string, string]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;vertical-align:top;">${esc(k)}</td>`
    + `<td style="padding:6px 0;font-size:14px;color:#111827;">${esc(v)}</td></tr>`;
  const links = who === 'owner' && kind !== 'cancelled' ? calendarLinks(m) : null;
  const pill = (href: string, label: string) => `<a href="${esc(href)}" style="display:inline-block;margin:0 6px 6px 0;padding:8px 12px;border:1.5px solid #0f766e;border-radius:8px;color:#0f766e;text-decoration:none;font-size:13px;font-weight:700;">${esc(label)}</a>`;
  const addCal = links
    ? `<div style="margin:14px 0 0;">
    <div style="font-size:13px;color:#6b7280;margin-bottom:6px;">Add it to your calendar</div>
    ${pill(links.google, 'Google Calendar')}${pill(links.outlook, 'Outlook')}${pill(links.outlookCom, 'Outlook.com')}
    <div style="font-size:12px;color:#9ca3af;">Apple Calendar or another app: open the attached onboarding-call.ics.</div>
  </div>` : '';
  const ownerPrep = who === 'owner' && kind !== 'cancelled'
    ? `<div style="margin:18px 0 0;padding:12px 14px;border:1.5px solid #99d5cb;background:#f0fdfa;border-radius:10px;">
    <div style="font-size:14px;font-weight:700;color:#0f766e;margin-bottom:4px;">${esc(OWNER_PREP.title)}</div>
    <div style="font-size:14px;color:#374151;line-height:1.5;">${esc(OWNER_PREP.intro)}</div>
    <ul style="margin:6px 0 0;padding-left:20px;font-size:14px;color:#111827;line-height:1.6;">${OWNER_PREP.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
  </div>` : '';
  const hostPrep = prep.length
    ? `<div style="margin:18px 0 0;padding:12px 14px;border:1.5px solid #99d5cb;background:#f0fdfa;border-radius:10px;">
    <div style="font-size:14px;font-weight:700;color:#0f766e;margin-bottom:4px;">Prep for the call</div>
    ${hasDeck ? '' : `<div style="font-size:13px;color:#6b7280;margin-bottom:4px;">No answers from the deck for this one.</div>`}
    <table style="border-collapse:collapse;">${prep.map(row).join('')}</table>
  </div>` : '';
  const rows = lines.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;vertical-align:top;white-space:nowrap;">${esc(k)}</td>`
    + `<td style="padding:6px 0;font-size:14px;color:#111827;">${/^https:\/\//.test(v) ? `<a href="${esc(v)}" style="color:#0f766e;font-weight:700;">${esc(v)}</a>` : esc(v)}</td></tr>`).join('');
  const button = zoom && kind !== 'cancelled'
    ? `<p style="margin:18px 0 6px;"><a href="${esc(zoom)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;">Join the Zoom call</a></p>` : '';
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
  <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#0f766e;">${esc(head)}</div>
  <h1 style="font-size:20px;margin:6px 0 10px;color:#111827;">${esc(company)} onboarding call</h1>
  <p style="font-size:14px;color:#374151;line-height:1.5;margin:0 0 12px;">${intro}</p>
  <table style="border-collapse:collapse;">${rows}</table>${button}${addCal}${ownerPrep}${hostPrep}
  <p style="font-size:12px;color:#9ca3af;margin-top:20px;">${who === 'owner' ? `The calendar invite is attached. To change the time, reply to this email.` : `MainstreetAI › Meetings. Mark how it went in the app afterwards.`}</p>
</div>`;
  const text = [`${head}: ${company} onboarding call`, '', ...lines.map(([k, v]) => `${k}: ${v}`),
    ...(links ? ['', 'Add it to your calendar:', `Google Calendar: ${links.google}`, `Outlook: ${links.outlook}`, `Outlook.com: ${links.outlookCom}`,
      'Apple Calendar or another app: open the attached onboarding-call.ics.'] : []),
    ...(who === 'owner' && kind !== 'cancelled' ? ['', `${OWNER_PREP.title}: ${OWNER_PREP.intro}`, ...OWNER_PREP.items.map(i => `- ${i}`)] : []),
    ...(prep.length ? ['', 'Prep for the call', ...(hasDeck ? [] : ['No answers from the deck for this one.']), ...prep.map(([k, v]) => `${k}: ${v}`)] : [])].join('\n');
  return { fromName: who === 'owner' ? `${company} onboarding` : 'MainstreetAI Meetings', subject, html, text };
}

const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => `\\${m}`);

// a name for CN="…" (no quotes or line breaks allowed inside)
const icsName = (s: string) => (s || '').replace(/["\r\n]/g, '').replace(/[\\]/g, '').trim();
const isEmail = (s: string | null | undefined): s is string => !!s && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s.trim());

/** Calendar lines are at most 75 bytes; longer ones continue on the next line after a space (RFC 5545 §3.1). */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { parts.push(cur); cur = ''; bytes = 0; limit = 74; }   // the leading space counts
    cur += ch; bytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/** A calendar invite for the call (UTC times, so every calendar shows it in its own time zone). The host is the
 *  organizer and the owner is an invited guest, so it lands in both calendars as a meeting with both on it, and
 *  the owner's Accept/Decline goes to the host. */
export function icsFor(m: MeetingNotice, kind: Kind, now = new Date(), fallbackOrganizer = 'mainstreetai@propertystars.app'): string {
  const desc = [`${m.campaign.name} onboarding with ${m.host.name}`, m.host.zoom_url ? `Join: ${m.host.zoom_url}` : '', `Business: ${m.business.name}`,
    `${OWNER_PREP.intro} ${OWNER_PREP.items.join(' ')}`]
    .filter(Boolean).join('\n');
  const hostEmail = isEmail(m.host.email) ? m.host.email.trim() : null;
  const ownerEmail = isEmail(m.owner_email) ? m.owner_email.trim() : null;
  const organizer = `ORGANIZER;CN="${icsName(m.host.name || m.campaign.name)}":mailto:${hostEmail || fallbackOrganizer}`;
  const guests = [
    ...(hostEmail ? [`ATTENDEE;CN="${icsName(m.host.name)}";ROLE=CHAIR;PARTSTAT=ACCEPTED;CUTYPE=INDIVIDUAL:mailto:${hostEmail}`] : []),
    ...(ownerEmail && ownerEmail.toLowerCase() !== hostEmail?.toLowerCase()
      ? [`ATTENDEE;CN="${icsName(m.owner_name)}";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CUTYPE=INDIVIDUAL:mailto:${ownerEmail}`] : []),
  ];
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MainstreetAI//Meetings//EN', 'CALSCALE:GREGORIAN', `METHOD:${kind === 'cancelled' ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT', `UID:ms-meeting-${m.id}@propertystars.app`, `DTSTAMP:${icsDate(now.toISOString())}`,
    `DTSTART:${icsDate(m.starts_at)}`, `DTEND:${icsDate(m.ends_at)}`,
    `SUMMARY:${icsText(`${m.campaign.name} onboarding call · ${m.business.name}`)}`,
    `DESCRIPTION:${icsText(desc)}`, ...(m.host.zoom_url ? [`LOCATION:${icsText(m.host.zoom_url)}`, `URL:${m.host.zoom_url}`] : []),
    organizer, ...guests,
    `STATUS:${kind === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, `SEQUENCE:${kind === 'booked' ? 0 : Math.floor(now.getTime() / 1000)}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].map(fold).join('\r\n');
}
