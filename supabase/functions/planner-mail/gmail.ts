// supabase/functions/planner-mail/gmail.ts — talking to a mail service. `Provider` is everything the rest of the
// function needs from one (handle.ts only ever uses this interface); `gmail` is the only one built. Outlook would be
// a second object of the same shape, with nothing else rewritten.
// No Deno here: every request goes through the `fetch` handed in, so the tests answer as Google would
// (src/planner/features/mail/handle.test.ts). Google's REST services, no SDK:
//   sign-in   https://accounts.google.com/o/oauth2/v2/auth   (Google's own page: the planner never sees a password)
//   tokens    https://oauth2.googleapis.com/token , /revoke
//   mail      https://gmail.googleapis.com/gmail/v1/users/me/…   read-only calls, and messages/send
// What is asked of Google: read the mail (gmail.readonly) and send (gmail.send), plus which address it is. Nothing
// here can delete, move or mark an email or change a mailbox's settings: those calls aren't written.
// A token only ever travels in a request's Authorization header or the body of a token request: never in an address,
// never in an error (MailError carries a kind and a short code, nothing Google said in words).
import { forApp, gmailLine, gmailRead, rawFor, rfc822, sinceQuery, type Cursor, type Draft, type MailFull, type MailLine, type ProviderId } from './mail.ts';

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
/** What went wrong with a mailbox. expired = its sign-in no longer works (connect again); not_allowed = it wasn't
 *  given that permission; gone = that email isn't there; down = Google didn't answer or refused for now.
 *  `why` is for the server's log: a status and Google's short code ("400 invalid_grant"), never its sentences. */
export class MailError extends Error {
  constructor(readonly kind: 'expired' | 'not_allowed' | 'gone' | 'down', readonly why: string) { super(`mail: ${kind} (${why})`); }
}
/** What a sign-in gives: a short-lived token to ask with, and (the first time) the one that keeps the mailbox connected. */
export interface Grant { access: string; expiresIn: number; refresh?: string; scopes: string[] }
export interface Provider {
  id: ProviderId;
  /** as people call it: "Gmail" */ name: string;
  scopes: string[];
  /** the permission that reading needs, and the one sending needs */ readScope: string; sendScope: string;
  /** the address of the service's own sign-in page for this sign-in */
  signInUrl(o: { clientId: string; redirect: string; state: string }): string;
  /** the code a finished sign-in came back with → tokens */
  exchange(o: { clientId: string; clientSecret: string; redirect: string; code: string }, f: Fetch): Promise<Grant>;
  refresh(o: { clientId: string; clientSecret: string; refreshToken: string }, f: Fetch): Promise<Grant>;
  /** take the permission back at the service */
  revoke(token: string, f: Fetch): Promise<void>;
  /** which mailbox this is */
  address(access: string, f: Fetch): Promise<string>;
  /** ids, newest first. `since` = only what a check still has to look at (the Primary inbox since its cursor). */
  list(access: string, o: { search?: string; unread?: boolean; max: number; since?: Cursor }, f: Fetch): Promise<{ ids: string[]; more: boolean }>;
  line(access: string, id: string, f: Fetch): Promise<MailLine | null>;
  read(access: string, id: string, f: Fetch, max?: number): Promise<MailFull>;
  /** send as this mailbox. `replyTo` = the id of the email being answered. */
  send(access: string, o: { from: string; draft: Draft; replyTo?: string }, f: Fetch): Promise<{ id: string }>;
}

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const READ = 'https://www.googleapis.com/auth/gmail.readonly', SEND = 'https://www.googleapis.com/auth/gmail.send';
const WAIT_MS = 12_000;
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
/** Google's short code for a refusal: "invalid_grant", "PERMISSION_DENIED", "rateLimitExceeded". Letters only: never its sentences. */
function codeOf(body: unknown): string {
  const b = body as { error?: unknown } | null;
  const e = b?.error as { status?: unknown; errors?: { reason?: unknown }[] } | string | undefined;
  const word = typeof e === 'string' ? e : typeof e?.errors?.[0]?.reason === 'string' ? e.errors[0].reason : typeof e?.status === 'string' ? e.status : '';
  return /^[A-Za-z_]{1,40}$/.test(word) ? word : '';
}
async function ask(f: Fetch, url: string, init: Parameters<Fetch>[1], what: string): Promise<{ status: number; ok: boolean; body: unknown }> {
  try {
    const res = await f(url, { ...init, signal: AbortSignal.timeout(WAIT_MS) });
    return { status: res.status, ok: res.ok, body: await res.json().catch(() => null) };
  } catch (e) {
    throw new MailError('down', `${what}: ${e instanceof Error && e.name === 'TimeoutError' ? 'no answer in time' : 'the request failed'}`);
  }
}
/** A token request (the code swapped, or a fresh token asked for). Google saying the sign-in is no good = expired. */
async function token(f: Fetch, body: Record<string, string>, what: string): Promise<Grant> {
  const r = await ask(f, TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body) }, what);
  const b = (r.body || {}) as { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown; scope?: unknown };
  if (!r.ok || typeof b.access_token !== 'string' || !b.access_token) {
    // only "invalid_grant" means this mailbox's sign-in is no good. Anything else (Google busy, or the planner's own
    // client id or secret refused) is not the mailbox's fault, and must not cost it its connection
    const code = codeOf(r.body);
    throw new MailError(code === 'invalid_grant' ? 'expired' : 'down', `${what}: ${r.status}${code ? ` ${code}` : ''}`);
  }
  return { access: b.access_token, expiresIn: Number(b.expires_in) > 0 ? Number(b.expires_in) : 3000, ...(typeof b.refresh_token === 'string' && b.refresh_token ? { refresh: b.refresh_token } : {}),
    scopes: typeof b.scope === 'string' ? b.scope.split(/\s+/).filter(Boolean) : [] };
}
/** One call to Gmail with the short-lived token. */
async function api<T>(f: Fetch, access: string, path: string, what: string, post?: unknown): Promise<T> {
  const r = await ask(f, `${API}${path}`, { method: post === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${access}`, ...(post === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(post === undefined ? {} : { body: JSON.stringify(post) }) }, what);
  if (r.ok && r.body && typeof r.body === 'object') return r.body as T;
  const code = codeOf(r.body), why = `${what}: ${r.status}${code ? ` ${code}` : ''}`;
  if (r.status === 401) throw new MailError('expired', why);
  // 403 for a permission this sign-in wasn't given (a box left unticked on Google's page). Other 403s (too many
  // requests, the Gmail service not switched on for the planner's Google project) are not the mailbox's doing
  if (r.status === 403 && (/insufficient/i.test(code) || code === 'PERMISSION_DENIED' || code === 'forbidden')) throw new MailError('not_allowed', why);
  if (r.status === 404) throw new MailError('gone', why);
  throw new MailError('down', why);
}
const param = (o: Record<string, string | string[] | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) p.append(k, x);
  return p.toString();
};

export const gmail: Provider = {
  id: 'google', name: 'Gmail', scopes: ['openid', 'email', READ, SEND], readScope: READ, sendScope: SEND,
  // offline + consent: Google hands back a refresh token every time; select_account: the list of Google accounts
  // shows, so a second mailbox can be picked
  signInUrl: o => `${AUTH}?${form({ client_id: o.clientId, redirect_uri: o.redirect, response_type: 'code', scope: gmail.scopes.join(' '), access_type: 'offline', prompt: 'consent select_account', state: o.state })}`,
  exchange: (o, f) => token(f, { grant_type: 'authorization_code', code: o.code, client_id: o.clientId, client_secret: o.clientSecret, redirect_uri: o.redirect }, 'sign-in'),
  refresh: (o, f) => token(f, { grant_type: 'refresh_token', refresh_token: o.refreshToken, client_id: o.clientId, client_secret: o.clientSecret }, 'fresh token'),
  async revoke(tok, f) {
    const r = await ask(f, REVOKE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ token: tok }) }, 'revoke');
    // 400 = Google no longer knows it: already taken back
    if (!r.ok && r.status !== 400) throw new MailError('down', `revoke: ${r.status}`);
  },
  async address(access, f) {
    const p = await api<{ emailAddress?: unknown }>(f, access, '/profile', 'profile');
    const a = typeof p.emailAddress === 'string' ? p.emailAddress.trim().toLowerCase() : '';
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(a) || a.length > 254) throw new MailError('down', 'profile: no address');
    return a;
  },
  async list(access, o, f) {
    const max = Math.max(1, Math.min(50, Math.floor(o.max) || 15));
    // a check: the Primary inbox since its cursor. A look with words: anywhere but spam and the bin. Otherwise: the inbox.
    const q = o.since ? sinceQuery(o.since) : (o.search || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const labels = o.since || q ? (o.unread ? ['UNREAD'] : []) : ['INBOX', ...(o.unread ? ['UNREAD'] : [])];
    const r = await api<{ messages?: { id?: unknown }[]; nextPageToken?: unknown }>(f, access, `/messages?${param({ maxResults: String(max), ...(q ? { q } : {}), labelIds: labels })}`, 'list');
    return { ids: (Array.isArray(r.messages) ? r.messages : []).map(m => m?.id).filter((id): id is string => typeof id === 'string').slice(0, max), more: typeof r.nextPageToken === 'string' && !!r.nextPageToken };
  },
  async line(access, id, f) {
    return gmailLine(await api(f, access, `/messages/${encodeURIComponent(id)}?${param({ format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] })}`, 'message'));
  },
  async read(access, id, f, max) {
    const m = gmailRead(await api(f, access, `/messages/${encodeURIComponent(id)}?format=full`, 'message'), max);
    if (!m) throw new MailError('gone', 'message: not one we can read');
    return m;
  },
  async send(access, o, f) {
    // an answer goes into the conversation of the email it answers
    let thread = '', inReplyTo = '', references = '';
    if (o.replyTo) {
      const orig = gmailRead(await api(f, access, `/messages/${encodeURIComponent(o.replyTo)}?${param({ format: 'metadata', metadataHeaders: ['Message-ID', 'References', 'Subject', 'From'] })}`, 'message'));
      if (!orig) throw new MailError('gone', 'message: not one we can read');
      thread = orig.thread; inReplyTo = orig.messageId; references = orig.references;
    }
    // the name this mailbox sends under, so the email arrives from a person and not a bare address. Only read; if
    // Google won't say, the address alone is used.
    let name = '';
    try {
      const s = await api<{ sendAs?: { sendAsEmail?: unknown; displayName?: unknown; isPrimary?: unknown }[] }>(f, access, '/settings/sendAs', 'send-as');
      const mine = (Array.isArray(s.sendAs) ? s.sendAs : []).find(x => typeof x?.sendAsEmail === 'string' && x.sendAsEmail.toLowerCase() === o.from.toLowerCase());
      name = typeof mine?.displayName === 'string' ? mine.displayName : '';
    } catch { /* the address alone */ }
    const sent = await api<{ id?: unknown }>(f, access, '/messages/send', 'send', { raw: rawFor(rfc822({ from: o.from, name, draft: o.draft, inReplyTo, references })), ...(thread ? { threadId: thread } : {}) });
    return { id: typeof sent.id === 'string' ? sent.id : '' };
  },
};
/** The services a mailbox can be with. */
export const PROVIDERS: Record<ProviderId, Provider> = { google: gmail };
export const isProvider = (v: unknown): v is ProviderId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, v);
export { forApp };
