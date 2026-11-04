// src/v2/lib/deckEmail.ts — a copy of the deck's questionnaire and proposal, written as an email to the owner.
// It opens in the rep's email composer, where they can change anything before sending. The rep's signature is added
// when it sends, so there's no sign-off here. The savings figure is a rough estimate and says so.
import type { DeckAnswers } from './meetings';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const money = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`;
const first = (s: string | null | undefined) => (s || '').trim().split(/\s+/)[0] || '';

export const SAVINGS_DISCLAIMER = 'This is a rough estimate from the ranges you picked and taxifi’s starting prices. It isn’t a quote or a guarantee: your price is confirmed on your onboarding call.';

/** "Thursday, November 5 at 10:00 AM" in this phone's time zone. */
export function followWhen(iso: string, tz?: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  return `${day} at ${time}`;
}

export function deckEmail(p: {
  business: string; campaign: string; answers: DeckAnswers; contactName?: string | null; followUpAt?: string | null; tz?: string;
}): { subject: string; html: string } {
  const a = p.answers, pr = a.proposal;
  const name = first(p.contactName || a.contact?.name);
  const rows = (a.summary || []).filter(([q]) => q !== 'Talking with');
  const parts: string[] = [];
  parts.push(`<p>Hi${name ? ` ${esc(name)}` : ''},</p>`);
  parts.push(`<p>Thanks for your time today. As promised, here’s a copy of what we went over for ${esc(p.business)}.</p>`);
  if (rows.length) {
    parts.push('<p><strong>Your answers</strong></p>');
    parts.push(`<ul>${rows.map(([q, v]) => `<li>${esc(q)}: ${esc(v)}</li>`).join('')}</ul>`);
  }
  if (pr) {
    parts.push(`<p><strong>Your ${esc(p.campaign)} proposal</strong></p>`);
    parts.push(`<ul>${pr.lines.map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join('')}</ul>`);
    parts.push(`<p><strong>About ${money(pr.yearly)} a year</strong> (about ${money(pr.monthly)} a month)${pr.quoted ? ', plus Core bookkeeping, which is quoted on your onboarding call' : ''}. These are starting prices, confirmed on your onboarding call.</p>`);
    if (pr.fit) parts.push(`<p>${esc(pr.fit)}</p>`);
    if (pr.today_yearly != null && pr.savings != null && pr.savings > 0) {
      parts.push(`<p><strong>Rough estimate:</strong> you pay about ${money(pr.today_yearly)} a year now, so this could save you about ${money(pr.savings)} a year.</p>`);
      parts.push(`<p><em>${esc(SAVINGS_DISCLAIMER)}</em></p>`);
    }
  }
  if (p.followUpAt) parts.push(`<p>I’ll follow up with you on ${esc(followWhen(p.followUpAt, p.tz))}. If anything changes before then, just reply to this email.</p>`);
  else parts.push('<p>If you have any questions, just reply to this email.</p>');
  return { subject: `Your ${p.campaign} questionnaire and proposal: ${p.business}`, html: parts.join('') };
}
