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

const first = (s: string) => (s || '').trim().split(/\s+/)[0] || s;

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
       ...((m.answers?.summary || []).map(([q, a]) => [q, a] as [string, string])),
       ...(m.answers?.proposal ? [['Proposal shown', `about $${Math.round(m.answers.proposal.yearly).toLocaleString('en-CA')} a year${m.answers.proposal.quoted ? ' plus Core (quoted)' : ''}: `
         + m.answers.proposal.lines.map(([k, v]) => `${k} ${v}`).join(', ')] as [string, string]] : []),
       ['Your Zoom', zoom || 'No Zoom link saved yet: add it under My hours']];
  const intro = who === 'owner'
    ? (kind === 'cancelled' ? `Hi ${esc(first(m.owner_name))}, your onboarding call with ${esc(company)} has been cancelled. We’ll be in touch to find a new time.`
      : kind === 'changed' ? `Hi ${esc(first(m.owner_name))}, your onboarding call with ${esc(company)} has a new time.`
      : `Hi ${esc(first(m.owner_name))}, thanks for choosing ${esc(company)}. Here’s your onboarding call, where we get you set up.`)
    : (kind === 'cancelled' ? `This onboarding call was cancelled.` : kind === 'changed' ? `This onboarding call was moved.` : `You have a new onboarding call.`);
  const rows = lines.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;vertical-align:top;white-space:nowrap;">${esc(k)}</td>`
    + `<td style="padding:6px 0;font-size:14px;color:#111827;">${/^https:\/\//.test(v) ? `<a href="${esc(v)}" style="color:#0f766e;font-weight:700;">${esc(v)}</a>` : esc(v)}</td></tr>`).join('');
  const button = zoom && kind !== 'cancelled'
    ? `<p style="margin:18px 0 6px;"><a href="${esc(zoom)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;">Join the Zoom call</a></p>` : '';
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
  <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#0f766e;">${esc(head)}</div>
  <h1 style="font-size:20px;margin:6px 0 10px;color:#111827;">${esc(company)} onboarding call</h1>
  <p style="font-size:14px;color:#374151;line-height:1.5;margin:0 0 12px;">${intro}</p>
  <table style="border-collapse:collapse;">${rows}</table>${button}
  <p style="font-size:12px;color:#9ca3af;margin-top:20px;">${who === 'owner' ? `The calendar invite is attached. To change the time, reply to this email.` : `MainstreetAI › Meetings. Mark how it went in the app afterwards.`}</p>
</div>`;
  const text = [`${head}: ${company} onboarding call`, '', ...lines.map(([k, v]) => `${k}: ${v}`)].join('\n');
  return { fromName: who === 'owner' ? `${company} onboarding` : 'MainstreetAI Meetings', subject, html, text };
}

const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => `\\${m}`);

/** A calendar invite for the call (UTC times, so every calendar shows it in its own time zone). */
export function icsFor(m: MeetingNotice, kind: Kind, now = new Date()): string {
  const desc = [`${m.campaign.name} onboarding with ${m.host.name}`, m.host.zoom_url ? `Join: ${m.host.zoom_url}` : '', `Business: ${m.business.name}`]
    .filter(Boolean).join('\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MainstreetAI//Meetings//EN', `METHOD:${kind === 'cancelled' ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT', `UID:ms-meeting-${m.id}@propertystars.app`, `DTSTAMP:${icsDate(now.toISOString())}`,
    `DTSTART:${icsDate(m.starts_at)}`, `DTEND:${icsDate(m.ends_at)}`,
    `SUMMARY:${icsText(`${m.campaign.name} onboarding call · ${m.business.name}`)}`,
    `DESCRIPTION:${icsText(desc)}`, ...(m.host.zoom_url ? [`LOCATION:${icsText(m.host.zoom_url)}`, `URL:${m.host.zoom_url}`] : []),
    `STATUS:${kind === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, `SEQUENCE:${kind === 'booked' ? 0 : Math.floor(now.getTime() / 1000)}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}
