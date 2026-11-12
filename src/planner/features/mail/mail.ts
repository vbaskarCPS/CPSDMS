// src/planner/features/mail/mail.ts — the app's side of a connected mailbox: what it asks the planner-mail function
// (supabase/functions/planner-mail) and what it gets back. No React here; tested in client.test.ts.
// The app never holds the key to a mailbox: it knows which mailboxes are connected, and gets mail when it asks for it.
// Each person only ever sees their own (the function looks every mailbox up by the signed-in person).
// Connecting sends the browser to Google's own sign-in page and nowhere else: connectStart refuses any other address.
// The demo (/demo) has one pretend mailbox, with made-up mail, and sends nothing.
import { invoke } from '../../lib/ai';
import { appId, isDemo } from '../../lib/app';
import type { MailLine, MailRead } from '../../../../supabase/functions/planner-mail/mail';

/** A connected mailbox, as the app knows it. needsSignIn = its sign-in ran out: it has to be connected again. */
export interface Mailbox { id: string; provider: 'google'; address: string; /** connected since */ since: string; /** turn what comes in into to-dos */ todos: boolean;
  checkedAt: string | null; /** what went wrong last, in plain words */ problem: string | null; canSend: boolean; needsSignIn: boolean }
/** Something a mailbox can't do right now, in plain words for the person (its sign-in ran out, Google didn't answer,
 *  email isn't set up yet). Not a fault in the app. */
export class MailProblem extends Error { constructor(message: string, readonly code = '') { super(message); } }

async function ask<T>(body: Record<string, unknown>): Promise<T> {
  const r = await invoke<T & { problem?: unknown; code?: unknown }>(body, 'planner-mail');
  if (r && typeof r.problem === 'string' && r.problem) throw new MailProblem(r.problem.slice(0, 300), typeof r.code === 'string' ? r.code : '');
  return r;
}
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const cleanBox = (m: Partial<Mailbox> | null): Mailbox | null => (m && typeof m.id === 'string' && typeof m.address === 'string' && m.address
  ? { id: m.id, provider: 'google', address: m.address.slice(0, 254), since: text(m.since, 40), todos: m.todos === true, checkedAt: typeof m.checkedAt === 'string' ? m.checkedAt : null,
      problem: typeof m.problem === 'string' && m.problem ? m.problem.slice(0, 300) : null, canSend: m.canSend === true, needsSignIn: m.needsSignIn === true } : null);

// ── the demo's pretend mailbox ──
const DEMO_BOX: Mailbox = { id: 'demo', provider: 'google', address: 'you@example.com', since: '2026-11-01T12:00:00.000Z', todos: true, checkedAt: null, problem: null, canSend: true, needsSignIn: false };
let demoBoxes: Mailbox[] = [DEMO_BOX];
const DEMO_MAILS: MailLine[] = [
  { id: 'demo-dentist-1', from: 'Maple Leaf Dental <office@mapleleafdental.example>', subject: 'Your appointment on Thursday', when: '', preview: 'Can you confirm Thursday at 3:00 pm with Dr. Shah still works? Just reply to this email.', unread: true },
  { id: 'demo-school-22', from: 'Little Oaks Daycare <hello@littleoaks.example>', subject: 'Photo day is next Tuesday', when: '', preview: 'Photo day is next Tuesday morning. Please send the order form back by Friday.', unread: false },
];

/** This person's mailboxes. `ready` false = email isn't set up on the server yet (nothing can be connected). */
export async function mailboxes(): Promise<{ mailboxes: Mailbox[]; ready: boolean }> {
  if (isDemo()) return { mailboxes: demoBoxes, ready: true };
  const r = await ask<{ mailboxes?: unknown; ready?: unknown }>({ action: 'list' });
  return { mailboxes: (Array.isArray(r?.mailboxes) ? r.mailboxes : []).map(m => cleanBox(m as Partial<Mailbox>)).filter((m): m is Mailbox => !!m), ready: r?.ready !== false };
}
/** Is this Google's own sign-in page? The only address Connect may open. */
export const signInAddressOk = (url: unknown): url is string => typeof url === 'string' && url.length < 2000 && /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?[^\s]+$/.test(url);
/** Start connecting a mailbox: the address of Google's sign-in page to open. Coming back, the planner shows what happened. */
export async function connectStart(): Promise<string> {
  if (isDemo()) throw new MailProblem('Connecting a mailbox isn’t part of the demo. In your own planner this opens Google’s sign-in page.', 'demo');
  const r = await ask<{ url?: unknown }>({ action: 'connect_start', provider: 'google', app: appId() });
  if (!signInAddressOk(r?.url)) throw new Error('The sign-in page couldn’t be opened. Try again.');
  return r.url;
}
/** Disconnect a mailbox. `revoked` false = it is forgotten here, but Google couldn't be told. */
export async function disconnect(id: string): Promise<{ revoked: boolean }> {
  if (isDemo()) { demoBoxes = demoBoxes.filter(m => m.id !== id); return { revoked: true }; }
  const r = await ask<{ revoked?: unknown }>({ action: 'disconnect', mailbox: id });
  return { revoked: r?.revoked === true };
}
/** "Turn what comes in into to-dos" on or off for one mailbox. */
export async function setWatch(id: string, on: boolean): Promise<void> {
  if (isDemo()) { demoBoxes = demoBoxes.map(m => (m.id === id ? { ...m, todos: on } : m)); return; }
  await ask({ action: 'watch', mailbox: id, on });
}
/** The latest emails of one mailbox (15 at most), or the ones with the words looked for. */
export async function inbox(id: string, o: { search?: string; unread?: boolean; max?: number } = {}): Promise<{ mails: MailLine[]; more: boolean }> {
  if (isDemo()) return { mails: DEMO_MAILS.map(m => ({ ...m, when: new Date().toISOString() })), more: false };
  const r = await ask<{ mails?: unknown; more?: unknown }>({ action: 'inbox', mailbox: id, ...(o.search ? { search: o.search } : {}), ...(o.unread ? { unread: true } : {}), ...(o.max ? { max: o.max } : {}) });
  const mails = (Array.isArray(r?.mails) ? r.mails : []) as Partial<MailLine>[];
  return { mails: mails.filter(m => m && typeof m.id === 'string').map(m => ({ id: m.id as string, from: text(m.from, 160), subject: text(m.subject, 200), when: text(m.when, 40), preview: text(m.preview, 240), unread: m.unread === true })), more: r?.more === true };
}
/** One email, opened. */
export async function readMail(id: string, messageId: string): Promise<MailRead> {
  if (isDemo()) return { id: messageId, from: DEMO_MAILS[0].from, to: DEMO_BOX.address, subject: DEMO_MAILS[0].subject, when: new Date().toISOString(), text: 'Hi,\n\nCan you confirm Thursday at 3:00 pm with Dr. Shah still works? Just reply to this email.\n\nThanks,\nMaple Leaf Dental (a made-up place, for the demo)', attachments: [], answerTo: 'office@mapleleafdental.example' };
  const m = (await ask<{ mail?: Partial<MailRead> }>({ action: 'read', mailbox: id, id: messageId }))?.mail;
  if (!m || typeof m.id !== 'string') throw new Error('That email couldn’t be opened.');
  return { id: m.id, from: text(m.from, 160), to: text(m.to, 300), subject: text(m.subject, 200), when: text(m.when, 40), text: text(m.text, 8000), ...(m.cut ? { cut: true } : {}),
    attachments: (Array.isArray(m.attachments) ? m.attachments : []).filter((a): a is string => typeof a === 'string').map(a => a.slice(0, 80)).slice(0, 20), answerTo: text(m.answerTo, 254) };
}
/** Send an email as one of their mailboxes. Called from a Confirm tap and from nowhere else (features/arvy/act.ts). */
export async function sendMail(o: { mailbox: string; to: string[]; subject: string; body: string; replyTo?: string }): Promise<void> {
  if (isDemo()) return;   // nothing is sent from the demo
  await ask({ action: 'send', mailbox: o.mailbox, to: o.to, subject: o.subject, body: o.body, ...(o.replyTo ? { reply_to: o.replyTo } : {}) });
}

/** Which mailbox is meant. Named by its address or a word from it ("work"): that one, null when none fits, or the
 *  ones that fit when several do. Not named: the only one, or all of them. */
export function pickMailbox(list: Mailbox[], named: unknown): Mailbox | Mailbox[] | null {
  const want = typeof named === 'string' ? named.trim().toLowerCase().replace(/^<|>$/g, '') : '';
  if (!want) return list.length === 1 ? list[0] : list.length ? list : null;
  const exact = list.find(m => m.address.toLowerCase() === want);
  if (exact) return exact;
  const words = want.split(/[^a-z0-9@._+-]+/).filter(w => w.length > 1 && !['the', 'my', 'mailbox', 'email', 'mail', 'account', 'one', 'address', 'inbox'].includes(w));
  const fits = words.length ? list.filter(m => words.every(w => m.address.toLowerCase().includes(w))) : [];
  return fits.length === 1 ? fits[0] : fits.length ? fits : null;
}

// ── coming back from Google's sign-in page ──
/** What the address the planner was sent back to says happened: `connected` = that mailbox was connected,
 *  `problem` = why it wasn't, in plain words. Anyone can write an address, so only an email address is taken as one,
 *  and only plain words (no links, nothing that looks like a web address) are shown as the problem. */
export function cameBack(params: { get(name: string): string | null }): { connected?: string; problem?: string } {
  const a = (params.get('connected') || '').trim().toLowerCase();
  if (a.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(a)) return { connected: a };
  const p = (params.get('problem') || '').replace(/\s+/g, ' ').trim();
  if (p && p.length <= 200 && /^[A-Za-z0-9 ,.’'()-]+$/.test(p) && !/https?|www|\w\.\w/i.test(p)) return { problem: p };
  return params.get('connected') || params.get('problem') ? { problem: 'The mailbox wasn’t connected. Try again.' } : {};
}
/** How long ago something was, in a few words: "just now", "12 minutes ago", "3 hours ago", "on Nov 9". */
export function ago(iso: string | null, nowMs: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const min = Math.round((nowMs - t) / 60000);
  if (min < 2) return 'just now';
  if (min < 60) return `${min} minutes ago`;
  if (min < 36 * 60) { const h = Math.round(min / 60); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  return `on ${new Date(t).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`;
}
