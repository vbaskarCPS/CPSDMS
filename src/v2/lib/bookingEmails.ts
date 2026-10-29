// src/v2/lib/bookingEmails.ts — Master Bookings › Send booking emails (RUN_69): the day-before and next-try
// emails for a map's routes. Each email is the centre's saved template, filled in for the customer, with one
// personal paragraph Claude writes from what we know of them. The office reads them all, then sends; they go
// out from the centre's customer mailbox, so replies come back there.
import { db, must } from './client';
import { fillTemplate, dateFriendly, isEmail, htmlToText, type EmailTemplate } from './mail';
import { lastAttempt } from './bookingCrew';
import type { Booking, Services } from './bookings';

export type BookingEmailKind = 'day_before' | 'next_try';
export const KIND_LABEL: Record<BookingEmailKind, string> = { day_before: 'Day before', next_try: 'Next try' };

const WORDS: [keyof Services, string][] = [['aeration', 'aeration'], ['dethatch', 'dethatching'], ['fertilizer', 'fertilizer'], ['seed', 'overseeding'], ['lime', 'lime']];
const CODE: Record<string, keyof Services> = { A: 'aeration', D: 'dethatch', F: 'fertilizer', S: 'seed', L: 'lime' };
/** {aeration, seed} or "AFSL" → "aeration, fertilizer, overseeding and lime" */
export function servicesWords(s: Services | null | undefined, jobCode?: string | null): string {
  const on: Services = { ...(s || {}) };
  if (!WORDS.some(([k]) => on[k]) && jobCode) for (const c of jobCode.toUpperCase()) if (CODE[c]) on[CODE[c]] = true;
  const w = WORDS.filter(([k]) => on[k]).map(([, x]) => x);
  if (!w.length) return 'your lawn service';
  return w.length === 1 ? w[0] : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
}

/** What a booking email was sent as: "day_before:2026-10-30". */
export const sentKey = (kind: BookingEmailKind, date: string) => `${kind}:${date}`;
export interface SentEmail { kind: string; at: string; thread_id?: string | null }
export const alreadySent = (b: { sent_emails?: SentEmail[] | null }, kind: BookingEmailKind, date: string) =>
  (b.sent_emails || []).some(s => s.kind === sentKey(kind, date));

export const emailsOf = (b: Pick<Booking, 'emails'>) => [...new Set((b.emails || []).map(e => e.trim().toLowerCase()).filter(isEmail))];

/** The template's {{variables}} for one booking. */
export function bookingVars(b: Booking, date: string, companyName: string): Record<string, string> {
  const last = lastAttempt(b.attempts || []);
  return {
    firstName: (b.people?.[0]?.first || '').trim() || 'there',
    address: `${b.house_no} ${b.street_name}${b.unit ? ` #${b.unit}` : ''}${b.city ? `, ${b.city}` : ''}`,
    dateFriendly: dateFriendly(date),
    services: servicesWords(b.services, b.job_code),
    reason: (last?.reason || 'we couldn’t get to it').toLowerCase(),
    companyName,
  };
}

export interface BookingDraft {
  booking: Booking; to: string[]; subject: string; note: string;   // note: the personal paragraph, HTML
  include: boolean; status?: 'sending' | 'sent' | 'failed'; error?: string;
}
/** A draft's email, from the template, its variables and its note. */
export function renderDraft(t: Pick<EmailTemplate, 'subject' | 'html'>, d: Pick<BookingDraft, 'booking' | 'note'>, date: string, companyName: string): { subject: string; html: string; text: string } {
  const vars = { ...bookingVars(d.booking, date, companyName), note: d.note || '' };
  const subject = fillTemplate(t.subject, vars).replace(/<[^>]+>/g, '').trim();
  const html = fillTemplate(t.html, vars);
  return { subject, html, text: htmlToText(html) };
}
/** Plain text typed in the review → the note's HTML. */
export const noteHtml = (s: string) => s.trim() ? s.trim().split(/\n{2,}/).map(p => `<p>${p.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)).replace(/\n/g, '<br>')}</p>`).join('') : '';

/** Tomorrow and the day after, as yyyy-mm-dd in local time. */
export function nextDays(now = new Date()): { tomorrow: string; after: string } {
  const f = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  return { tomorrow: f(1), after: f(2) };
}

export async function markEmailed(bookingId: string, kind: BookingEmailKind, date: string, threadId: string | null): Promise<void> {
  must(await db.rpc('app_mb_booking_emailed', { p_id: bookingId, p_kind: sentKey(kind, date), p_thread: threadId }));
}
