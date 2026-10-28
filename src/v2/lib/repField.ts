// src/v2/lib/repField.ts — the rep app's field helpers, no database: is it open now (Google hours),
// the nearest business, a calendar file for a follow-up, the send-info texts, and reading a business
// card's text into a name, phone and email.

// ───────────── open now ─────────────
/** Google hours are 7 lines, Monday first: "Monday: 8:30 AM – 5:00 PM", or without the day name. */
type Range = [number, number];   // minutes from the start of the day; the end can pass 1440 (overnight)

function toMin(t: string, fallbackMer: string | null): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(t.trim());
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] || 0);
  const mer = (m[3] || fallbackMer || '').toLowerCase();
  if (h > 24 || min > 59) return null;
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

/** One day's text → its open ranges; [] when closed; null when it can't be read. */
export function parseDay(text: string): Range[] | null {
  const s = text.replace(/^[A-Za-z]+:\s*/, '').replace(/[\u202f\u00a0\u2009]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/^closed$/i.test(s)) return [];
  if (/open 24 hours/i.test(s)) return [[0, 1440]];
  const out: Range[] = [];
  for (const part of s.split(/,\s*/)) {
    const m = /^(.+?)\s*[–—-]\s*(.+)$/.exec(part);
    if (!m) return null;
    const endMer = (/(am|pm)\s*$/i.exec(m[2]) || [])[1] || null;
    const inherit = endMer && !/(am|pm)/i.test(m[1]) ? endMer : null;
    const b = toMin(m[2], null);
    let a = toMin(m[1], inherit);
    if (inherit && a != null && b != null && a >= b) a = toMin(m[1], 'am');   // "11:00 – 2:00 PM" is 11 AM
    if (a == null || b == null) return null;
    out.push([a, b <= a ? b + 1440 : b]);
  }
  return out;
}

/** Open (true), closed (false), or unknown (null) at this moment. */
export function openAt(hours: unknown, at = new Date()): boolean | null {
  if (!Array.isArray(hours) || hours.length !== 7) return null;
  const days = hours.map(h => (typeof h === 'string' ? parseDay(h) : null));
  const dow = (at.getDay() + 6) % 7;   // Monday = 0
  const now = at.getHours() * 60 + at.getMinutes();
  const today = days[dow], yest = days[(dow + 6) % 7];
  if (today == null) return null;
  if (today.some(([a, b]) => now >= a && now < b)) return true;
  if (yest && yest.some(([, b]) => b > 1440 && now < b - 1440)) return true;   // open past midnight
  return false;
}

/** "Opens 9:00 AM", "Closes 5:00 PM", or '' — for the business card. */
export function hoursToday(hours: unknown, at = new Date()): string {
  if (!Array.isArray(hours) || hours.length !== 7) return '';
  const dow = (at.getDay() + 6) % 7;
  const t = hours[dow];
  return typeof t === 'string' ? t.replace(/^[A-Za-z]+:\s*/, '').replace(/[\u202f\u00a0]/g, ' ') : '';
}

// ───────────── nearest ─────────────
export function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
/** The nearest of these to here, leaving out any ids given (the one just visited). */
export function nearest<T extends { id: string; lat: number; lng: number }>(here: { lat: number; lng: number }, list: T[], skip: string[] = []): { item: T; m: number } | null {
  let best: { item: T; m: number } | null = null;
  for (const b of list) {
    if (skip.includes(b.id)) continue;
    const m = metres(here, b);
    if (!best || m < best.m) best = { item: b, m };
  }
  return best;
}
export const distLabel = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

// ───────────── follow-up in the calendar ─────────────
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
export function followUpIcs(p: { uid: string; title: string; at: string; minutes?: number; where?: string | null; notes?: string | null }, now = new Date()): string {
  const start = new Date(p.at);
  const end = new Date(start.getTime() + (p.minutes || 15) * 60000);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MainstreetAI//Rep//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${p.uid}@mainstreetai`, `DTSTAMP:${icsDate(now)}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(p.title)}`, ...(p.where ? [`LOCATION:${icsText(p.where)}`] : []), ...(p.notes ? [`DESCRIPTION:${icsText(p.notes)}`] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(p.title)}`, 'TRIGGER:-PT15M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

// ───────────── send info ─────────────
/** The campaign link with the rep's code on it, so a sign-up is credited to them. */
export function refLink(url: string | null | undefined, ref: string): string {
  if (!url) return '';
  try { const u = new URL(url); u.searchParams.set('ref', ref); return u.toString(); } catch { return url; }
}
export function fillTemplate(t: string, v: { business: string; link: string; rep: string; contact?: string }): string {
  return t.replace(/\{business\}/gi, v.business).replace(/\{link\}/gi, v.link).replace(/\{rep\}/gi, v.rep)
    .replace(/\{contact\}/gi, v.contact || 'there').replace(/[ \t]+\n/g, '\n').trim();
}
export const DEFAULT_SMS = 'Hi {contact}, thanks for your time today at {business}. Here’s the information: {link} — {rep}';
export const DEFAULT_EMAIL_SUBJECT = 'The information for {business}';
export const DEFAULT_EMAIL_BODY = 'Hi {contact},\n\nThanks for your time today. Here’s the information we talked about:\n{link}\n\n{rep}';
export function smsHref(phone: string, body: string): string {
  return `sms:${phone.replace(/[^0-9+]/g, '')}?&body=${encodeURIComponent(body)}`;
}
export function mailHref(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ───────────── reading a business card ─────────────
export interface CardFields { name: string | null; phone: string | null; email: string | null; title: string | null }
const TITLE = /\b(owner|president|ceo|cfo|coo|founder|director|manager|partner|principal|broker|agent|dr\.?|accountant|cpa|bookkeeper)\b/i;
export function parseCard(text: string): CardFields {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length > 1);
  const email = (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(text.replace(/\s*@\s*/g, '@')) || [])[0] || null;
  let phone: string | null = null;
  for (const l of lines) {
    if (/\bfax\b/i.test(l)) continue;
    const m = /(\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/.exec(l);
    if (m) { phone = `(${m[2]}) ${m[3]}-${m[4]}`; break; }
  }
  const titleLine = lines.find(l => TITLE.test(l) && !/@|\d{3}/.test(l)) || null;
  // a name: two or three words, letters only, capitalised, not the title, not a company word
  const name = lines.find(l => l !== titleLine && /^[A-Z][a-zA-Z'’.-]+(\s+[A-Z][a-zA-Z'’.-]+){1,2}$/.test(l)
    && !/\b(inc|ltd|llc|corp|group|services|solutions|company|co\.|street|st\.|road|rd\.|avenue|ave)\b/i.test(l)) || null;
  return { name, phone, email: email ? email.toLowerCase() : null, title: titleLine };
}

// ───────────── offline ids ─────────────
export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** A failed call that's the network, not the server saying no. */
export function isOffline(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? '');
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|the internet connection appears to be offline/i.test(msg);
}
