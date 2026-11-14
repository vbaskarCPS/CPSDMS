// supabase/functions/planner-mail/handle.ts — everything the planner's email function does, with what it needs
// handed in (the database, the network, the secrets, the clock, Claude, the notification): index.ts hands in the real
// ones, the tests hand in pretend ones (src/planner/features/mail/handle.test.ts). No Deno in this file.
//
// From the app (the planner token is checked by `me`, exactly as planner-arvy checks it):
//   connect_start { provider: 'google', app }   → { url }  Google's own sign-in page, with a one-time state value
//   connect_finish { code, state }              → { ok, connected, mailboxes } | { problem }   what Google's page handed
//       the browser, brought back by the signed-in planner. Only here is the code swapped for tokens, and only when
//       the person asking is the one who started that sign-in.
//   list                                        → { mailboxes: [{ id, provider, address, since, todos, checkedAt, problem, canSend, needsSignIn }], ready }
//   disconnect { mailbox }                      → { ok, revoked }   taken back at Google where possible, the row deleted
//   watch { mailbox, on }                       → { ok, todos }     "turn what comes in into to-dos" on or off
//   inbox { mailbox, search?, unread?, max? }   → { mails: [{ id, from, subject, when, preview, unread }], more }   15 at most
//   read { mailbox, id }                        → { mail: { id, from, to, subject, when, text, cut?, attachments, answerTo } }
//   send { mailbox, to, subject, body, reply_to? } → { ok, id }      sends as that mailbox: the app calls it only from a Confirm tap
//   receipts { since?, cursor? }                → { scanned, found, more, cursor?, mailboxes: [{ address, scanned, found, problem? }] }
//       a look back through ALL of this person's own mailboxes, one after another, for what they paid (orders, bills,
//       subscriptions, e-transfers they sent), from `since` (YYYY-MM-DD; else twelve months before today, Toronto).
//       One call reads at most RECEIPTS_MAX new emails and stops after about a minute: while `more` is true the app
//       calls again with the `cursor` it was given (an opaque string: it is only handed back). Each purchase becomes a
//       household doc of kind 'receipt' (key `${date}~${id}`, `from: 'email'`), and every email looked at is
//       remembered as a household doc of kind 'mailreceipt' (key `${mailboxId}~${messageId}`), so a look run again never
//       reads one twice or saves a receipt twice; a doc already there (a receipt the app has matched) is never written
//       over. The same `since` may be sent with a cursor: the cursor's own day is the one used. Household docs are written under the household's owner (as
//       planner-plaid writes them); the mailboxes read are only ever the person's own. A mailbox that can't be read
//       (sign-in run out, no permission, Google not answering) gets its problem in plain words and the rest go on.
//       The counts in one answer are for that call only.
// From Google's sign-in page (no planner token, so nothing is connected here):
//   GET …/planner-mail/callback?state=…&code=…  → the browser is passed on to the planner it came from:
//       <site>/<app>/settings/mail#mail_code=…&mail_state=…   (after the #: that part of an address is never sent to
//       a server or along to another site, so the two values stay in that browser)
//       or <site>/<app>/settings/mail?problem=<plain words> when Google sent no code.
//       Nothing is asked of Google and the state is not used up: that happens in connect_finish.
// From pg_cron, every 30 minutes (header x-cron-key = planner_secrets.cron_key):
//   check → for each mailbox with to-dos on: the new email in its Primary inbox is read by Claude for things the
//           person is asked to do; each is saved as an offered to-do (their own doc of kind 'mailtodo'), and one
//           notification says how many.
//
// The rules this file keeps:
//   · A person only ever reaches their own mailboxes: every look-up of a mailbox carries their id.
//   · A mailbox is only ever connected to the planner of the person who started the sign-in AND is signed in to the
//     browser that came back from Google. A sign-in link passed to someone else connects nothing.
//   · The key to a mailbox (its refresh token) is locked before it's stored (secure.ts) and is never sent to the app,
//     never logged and never put in an error. The short-lived token asked for with it is kept in memory only.
//   · What is logged when something fails: which action, the mailbox's id, and a short code. Never an address, a
//     subject, a word of an email, a state value, Google's code, or anything Google or Claude said in sentences.
//   · Nothing here deletes, moves or marks an email, or changes a mailbox's settings.
import { MAILRECEIPT_KIND, RECEIPT_BATCH, RECEIPT_CHARS, RECEIPT_KIND, RECEIPT_SCHEMA, mailReceiptKey, readReceiptsCursor, receiptInput, receiptQuery, receiptSystem, receiptsFrom, receiptsSince, writeReceiptsCursor,
  type CheckMail, type MailReceiptMark, type ReceiptsCursor } from './mail.ts';
import { EXPIRED, EXTRACT_SCHEMA, GONE, GOOGLE_DOWN, NO_SENDING, NOT_SET_UP, CHECK_CHARS, CHECK_MAX, cleanDraft, extractInput, extractSystem, forApp, freshIds, freshMails, isMessageId, nextCursor, notifyLine, readCursor, startCursor,
  todosFrom, type MailFull, type MailLine, type MailTodo, type ProviderId } from './mail.ts';
import { MailError, PROVIDERS, isProvider, type Fetch, type Provider } from './gmail.ts';
import { NoKey, looksLikeState, mailKey, newState, open, sameSecret, seal, stateExpired, stateHash, stateRow, tokenOwner, type AppId, type StateRow } from './secure.ts';

/** A connected mailbox, as it is stored (planner_mailboxes). token_enc = the locked refresh token; null = the
 *  sign-in ran out and it has to be connected again. */
export interface MailboxRow { id: string; user_id: string; provider: string; address: string; token_enc: string | null; scopes: string; todos: boolean;
  last_checked_at: string | null; cursor: unknown; problem: string | null; created_at: string }
/** household = the user whose rows hold the household's shared docs (planner_users.household_id); none = their own. */
export interface Me { id: string; name: string; app: AppId; household?: string }
/** The database, as this function uses it. Every method that takes a person's id only ever touches that person's rows. */
export interface Store {
  /** keep a sign-in that was just started; this person's finished and run-out ones are cleared away */
  startState(row: StateRow, nowIso: string): Promise<void>;
  /** the sign-in a returning value belongs to, only looked at: nothing is marked. null = unknown. */
  peekState(hash: string): Promise<StateRow | null>;
  /** the sign-in a returning value belongs to, marked used in the same step. null = unknown, or used before. */
  claimState(hash: string, nowIso: string): Promise<StateRow | null>;
  mailboxes(userId: string): Promise<MailboxRow[]>;
  /** one mailbox of this person's. null when there is none with that id, or it is someone else's. */
  mailbox(userId: string, id: string): Promise<MailboxRow | null>;
  /** connect, or connect again: one row for a person's address (whether to-dos are on is kept from before) */
  saveMailbox(m: Pick<MailboxRow, 'user_id' | 'provider' | 'address' | 'token_enc' | 'scopes' | 'cursor'>): Promise<MailboxRow>;
  updateMailbox(id: string, patch: Partial<Pick<MailboxRow, 'token_enc' | 'todos' | 'last_checked_at' | 'cursor' | 'problem'>>): Promise<void>;
  deleteMailbox(id: string): Promise<void>;
  /** every mailbox a check reads: to-dos on, and still signed in */
  watched(): Promise<MailboxRow[]>;
  person(userId: string): Promise<Me | null>;
  /** offered to-dos, saved as the person's own docs; one that is already there is left as it is. Returns how many were new. */
  addTodos(userId: string, docs: { key: string; data: MailTodo }[], nowIso: string): Promise<number>;
  /** a mailbox was disconnected: what was still on offer from it no longer is */
  dropWaiting(userId: string, mailboxId: string, nowIso: string): Promise<void>;
  cronKey(): Promise<string>;
  /** Of these keys of a household's docs of one kind (stored under `owner`, the household's user id), the ones there. */
  haveDocs(owner: string, kind: string, keys: string[]): Promise<string[]>;
  /** Household docs written under `owner`, as planner-plaid writes them, except that a doc already there is left exactly
   *  as it is (a receipt the app has matched, ignored or deleted is never written over). */
  addDocs(owner: string, list: { kind: string; key: string; data: unknown }[]): Promise<void>;
}
/** The tool Claude is made to answer with. None given: the to-dos tool of the check. */
export interface ClaudeTool { name: string; description: string; /** how long its answer may be */ maxTokens?: number; /** its answer when Claude calls no tool */ empty?: unknown }
export interface Deps {
  store: Store; fetch: Fetch; env: (name: string) => string; now: () => number;
  /** the planner person a token belongs to (planner_me). null = signed out. */
  me(token: string): Promise<Me | null>;
  /** Claude's answer in the shape of `schema`, given by calling `tool` (none: the to-dos tool) */
  claude(system: string, user: string, schema: unknown, tool?: ClaudeTool): Promise<unknown>;
  /** one notification to a person's phones, opening Today */
  notify(person: Me, body: string): Promise<void>;
  log(line: string): void;
}
export interface In { method: string; path: string; query: URLSearchParams; body: Record<string, unknown>; cronKey: string }
export type Out = { status: number; json: unknown } | { status: number; text: string } | { redirect: string };

/** The one address Google sends people back to: registered with Google exactly like this. */
export const REDIRECT = 'https://mipvcafqrmwxnoqmicxh.supabase.co/functions/v1/planner-mail/callback';
export const MAX_MAILBOXES = 6;
const INBOX_MAX = 15, CHECK_MAILBOXES = 12, CHECK_BUDGET_MS = 100_000;
const NO_READING = 'This mailbox wasn’t given permission to be read. Disconnect it, connect it again, and tick both boxes on Google’s page.';
const CHECK_DOWN = 'Google didn’t answer the last time this mailbox was checked. It’s tried again at the next check.';
const CHECK_LATER = 'The new email couldn’t be read for to-dos the last time. It’s tried once more at the next check.';
const SEND_UNSURE = 'Google didn’t answer, so it may or may not have been sent. Look in that mailbox’s Sent mail before trying again.';
const TZ = 'America/Toronto';

const json = (body: unknown, status = 200): Out => ({ status, json: body });
/** Something that can't be done right now, in plain words for the person (the app shows them; Arvy explains them). */
const problem = (words: string, code: string): Out => json({ problem: words, code });
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The secrets and addresses this runs on. null = email isn't set up yet (a secret is missing). */
function config(env: (n: string) => string): { id: string; secret: string; key: string; redirect: string } | null {
  const id = env('GOOGLE_OAUTH_CLIENT_ID'), secret = env('GOOGLE_OAUTH_CLIENT_SECRET'), key = env('PLANNER_MAIL_KEY');
  if (!id || !secret || !key) return null;
  const base = env('SUPABASE_URL').replace(/\/+$/, '');
  return { id, secret, key, redirect: env('PLANNER_MAIL_REDIRECT') || (base ? `${base}/functions/v1/planner-mail/callback` : REDIRECT) };
}
const siteOf = (env: (n: string) => string): string => (env('PLANNER_SITE') || 'https://planner.propertystars.app').replace(/\/+$/, '');
const isApp = (v: unknown): v is AppId => v === 'vijayplanner' || v === 'roshplanner';
const providerOf = (row: { provider: string }): Provider | null => (isProvider(row.provider) ? PROVIDERS[row.provider as ProviderId] : null);
const canSend = (row: MailboxRow, p: Provider | null): boolean => !!p && row.scopes.split(/\s+/).includes(p.sendScope);
/** A mailbox as the app may see it: never the token, locked or not. */
const forList = (row: MailboxRow) => ({ id: row.id, provider: row.provider, address: row.address, since: row.created_at, todos: row.todos, checkedAt: row.last_checked_at,
  problem: row.token_enc ? row.problem : EXPIRED, canSend: canSend(row, providerOf(row)), needsSignIn: !row.token_enc });
function today(nowMs: number): { today: string; weekday: string } {
  const d = new Date(nowMs);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
  return { today: `${p.year}-${p.month}-${p.day}`, weekday: new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(d) };
}

// ── the short-lived token for a mailbox ──
// Asked for with the stored refresh token and kept in this function's memory until it runs out. Never stored.
const kept = new Map<string, { access: string; until: number }>();
/** Forget every short-lived token (the tests start clean). */
export const forgetAccess = (): void => kept.clear();
async function accessFor(d: Deps, cfg: NonNullable<ReturnType<typeof config>>, row: MailboxRow, p: Provider): Promise<{ access: string; fromMemory: boolean }> {
  if (!row.token_enc) throw new MailError('expired', 'not signed in');
  const have = kept.get(row.id);
  if (have && have.until > d.now() + 60_000) return { access: have.access, fromMemory: true };
  const key = await mailKey(cfg.key);
  let refreshToken: string;
  try { refreshToken = await open(key, row.token_enc, tokenOwner(row)); }
  catch {
    // locked with another key, or not what was stored: it can't be used. Left in place (putting the right key back
    // makes it work again), and connecting again replaces it.
    await d.store.updateMailbox(row.id, { problem: EXPIRED });
    throw new MailError('expired', 'the stored sign-in would not open');
  }
  let g;
  try { g = await p.refresh({ clientId: cfg.id, clientSecret: cfg.secret, refreshToken }, d.fetch); }
  catch (e) {
    // Google says this sign-in is no good any more: the mailbox is marked, its dead token dropped, and it's left
    // alone until the person connects it again
    if (e instanceof MailError && e.kind === 'expired') { await d.store.updateMailbox(row.id, { token_enc: null, problem: EXPIRED }); row.token_enc = null; kept.delete(row.id); }
    throw e;
  }
  // Google handed back a new refresh token: that is the one to keep from now on
  if (g.refresh && g.refresh !== refreshToken) { const sealed = await seal(key, g.refresh, tokenOwner(row)); await d.store.updateMailbox(row.id, { token_enc: sealed }); row.token_enc = sealed; }
  kept.set(row.id, { access: g.access, until: d.now() + g.expiresIn * 1000 });
  return { access: g.access, fromMemory: false };
}
/** Do something with a mailbox. A short-lived token that Google refuses is asked for afresh, once. */
async function withMailbox<T>(d: Deps, cfg: NonNullable<ReturnType<typeof config>>, row: MailboxRow, fn: (access: string, p: Provider) => Promise<T>): Promise<T> {
  const p = providerOf(row);
  if (!p) throw new MailError('down', 'a mail service this version does not know');
  const first = await accessFor(d, cfg, row, p);
  try { return await fn(first.access, p); }
  catch (e) {
    if (!(e instanceof MailError) || e.kind !== 'expired') throw e;
    kept.delete(row.id);
    if (!first.fromMemory) throw new MailError('down', e.why);   // refused with a token Google made a moment ago: not the sign-in
    return await fn((await accessFor(d, cfg, row, p)).access, p);
  }
}
/** What to tell the app when a mailbox call fails, and one line for the log. */
function failed(d: Deps, action: string, row: MailboxRow, e: unknown): Out {
  if (e instanceof NoKey) { d.log(`${action}: PLANNER_MAIL_KEY is not 32 bytes of base64`); return problem(NOT_SET_UP, 'not_set_up'); }
  if (!(e instanceof MailError)) throw e;
  d.log(`${action} ${row.id}: ${e.why}`);
  return e.kind === 'expired' ? problem(EXPIRED, 'expired') : e.kind === 'gone' ? problem(GONE, 'gone')
    : e.kind === 'not_allowed' ? problem(action === 'send' ? NO_SENDING : NO_READING, 'not_allowed')
    // a send that got no answer may still have gone out: say so, so it isn't sent twice
    : problem(action === 'send' ? SEND_UNSURE : GOOGLE_DOWN, 'down');
}

// ── coming back from Google's sign-in page ──
const TOOK_TOO_LONG = 'That sign-in took too long. Tap Connect Gmail again.';
const NOT_FINISHED = 'The sign-in at Google wasn’t finished, so nothing was connected.';
const SOMEONE_ELSE = 'This sign-in was started from a different planner. Open Settings › Email in your own planner and tap Connect Gmail.';
/** Google's code as it may be carried: one piece of text, no spaces, not absurdly long. */
const looksLikeCode = (v: unknown): v is string => typeof v === 'string' && v.length >= 4 && v.length <= 1024 && /^[\x21-\x7e]+$/.test(v);

/** The address Google sends the browser to. Nobody is signed in here, so nothing is connected and Google is asked
 *  nothing: the browser is passed on to the planner the sign-in was started from, carrying Google's code and the
 *  state after the # (never sent to a server, never in a Referer). The planner, signed in, brings them back with
 *  connect_finish. The state is only looked at here, not used up. */
async function callback(q: URLSearchParams, d: Deps): Promise<Out> {
  const value = q.get('state');
  const stale = 'This sign-in has already been used, or was started too long ago. Go back to your planner, open Settings, Email, and tap Connect Gmail again.';
  if (!looksLikeState(value)) return { status: 400, text: stale };
  const row = await d.store.peekState(await stateHash(value));
  if (!row || row.used_at || stateExpired(row, d.now()) || !isApp(row.app)) return { status: 400, text: stale };
  const page = `${siteOf(d.env)}/${row.app}/settings/mail`;   // only which planner comes from the row: nothing from the request
  const code = q.get('code');
  // Google sends an error instead of a code when the person stopped, or didn't allow it
  if (q.get('error') || !looksLikeCode(code)) return { redirect: `${page}?${new URLSearchParams({ problem: NOT_FINISHED }).toString()}` };
  return { redirect: `${page}#${new URLSearchParams({ mail_code: code, mail_state: value }).toString()}` };
}

/** connect_finish: the signed-in planner brings back what Google's page handed the browser. The state is used up
 *  first (so it works once), then the person asking must be the one who started the sign-in: only then is Google
 *  asked to swap the code, and the mailbox stored for them. Neither the code nor the state is logged or sent back. */
async function connectFinish(b: Record<string, unknown>, me: Me, d: Deps): Promise<Out> {
  const cfg = config(d.env);
  if (!cfg) return problem(NOT_SET_UP, 'not_set_up');
  let key: CryptoKey;
  try { key = await mailKey(cfg.key); } catch { d.log('connect_finish: PLANNER_MAIL_KEY is not 32 bytes of base64'); return problem(NOT_SET_UP, 'not_set_up'); }
  if (!looksLikeState(b.state) || !looksLikeCode(b.code)) return problem(TOOK_TOO_LONG, 'stale');
  const code = b.code;
  // found by its hash and marked used in one step: the same value never works twice, whoever brings it
  const row = await d.store.claimState(await stateHash(b.state), new Date(d.now()).toISOString());
  if (!row || stateExpired(row, d.now())) return problem(TOOK_TOO_LONG, 'stale');
  // someone else's sign-in, finished in this person's browser: nothing is asked of Google, nothing is connected
  if (row.user_id !== me.id) { d.log('connect_finish: started by someone else'); return problem(SOMEONE_ELSE, 'someone_else'); }
  const p = providerOf(row);
  if (!p) return problem(NOT_SET_UP, 'not_set_up');
  try {
    const g = await p.exchange({ clientId: cfg.id, clientSecret: cfg.secret, redirect: cfg.redirect, code }, d.fetch);
    const undo = async () => { try { await p.revoke(g.refresh || g.access, d.fetch); } catch { /* it runs out by itself */ } };
    if (!g.refresh) { await undo(); d.log('connect_finish: Google gave no refresh token'); return problem('Google didn’t let the planner stay connected. Tap Connect Gmail again.', 'no_refresh'); }
    // Google lets people untick what an app asks for: without reading there is nothing to connect
    if (!g.scopes.includes(p.readScope)) { await undo(); return problem('The planner wasn’t allowed to read this mailbox. Tap Connect Gmail again and tick both boxes on Google’s page.', 'not_allowed'); }
    const address = await p.address(g.access, d.fetch);
    const mine = await d.store.mailboxes(me.id);
    if (!mine.some(m => m.provider === p.id && m.address === address) && mine.length >= MAX_MAILBOXES) { await undo(); return problem(`That’s as many mailboxes as one planner takes (${MAX_MAILBOXES}). Disconnect one first.`, 'too_many'); }
    // stored for the person asking, who is the person the state was made for
    const owner = { user_id: me.id, provider: p.id, address };
    const saved = await d.store.saveMailbox({ ...owner, token_enc: await seal(key, g.refresh, tokenOwner(owner)), scopes: g.scopes.join(' ').slice(0, 600), cursor: startCursor(d.now()) });
    kept.set(saved.id, { access: g.access, until: d.now() + g.expiresIn * 1000 });
    return json({ ok: true, connected: address, mailboxes: (await d.store.mailboxes(me.id)).map(forList) });
  } catch (e) {
    if (!(e instanceof MailError)) throw e;
    d.log(`connect_finish: ${e.why}`);
    return problem(e.kind === 'down' ? 'Google didn’t answer. Tap Connect Gmail again in a minute.' : 'Google didn’t finish the sign-in. Tap Connect Gmail again.', e.kind === 'down' ? 'down' : 'refused');
  }
}

// ── the check: new email → offered to-dos ──
async function checkOne(d: Deps, cfg: NonNullable<ReturnType<typeof config>>, row: MailboxRow): Promise<{ read: number; added: number }> {
  const nowIso = new Date(d.now()).toISOString();
  const cursor = readCursor(row.cursor, d.now());
  let mails: MailFull[];
  try {
    mails = await withMailbox(d, cfg, row, async (access, p) => {
      const ids = freshIds(cursor, (await p.list(access, { max: CHECK_MAX, since: cursor }, d.fetch)).ids);
      const out: MailFull[] = [];
      for (let i = 0; i < ids.length; i += 5) {   // five at a time
        const got = await Promise.all(ids.slice(i, i + 5).map(id => p.read(access, id, d.fetch, CHECK_CHARS).catch(e => { if (e instanceof MailError && e.kind === 'gone') return null; throw e; })));
        out.push(...got.filter((m): m is MailFull => !!m));
      }
      return out;
    });
  } catch (e) {
    if (!(e instanceof MailError)) throw e;
    d.log(`check ${row.id}: ${e.why}`);
    // a sign-in that ran out was marked where it was found (accessFor), and the mailbox isn't checked again until
    // it's connected again. Anything else is tried at the next check.
    if (e.kind !== 'expired') await d.store.updateMailbox(row.id, { last_checked_at: nowIso, problem: e.kind === 'not_allowed' ? NO_READING : CHECK_DOWN });
    return { read: 0, added: 0 };
  }
  const fresh = freshMails(cursor, mails);
  let added = 0, ok = true;
  if (fresh.length) {
    try {
      const who = await d.store.person(row.user_id);
      const day = today(d.now());
      const answer = await d.claude(extractSystem({ name: who?.name || 'this person', ...day }), extractInput(fresh), EXTRACT_SCHEMA);
      added = await d.store.addTodos(row.user_id, todosFrom(answer, fresh, { mailbox: { id: row.id, address: row.address }, today: day.today, nowIso }), nowIso);
    } catch (e) { ok = false; d.log(`check ${row.id}: not read for to-dos (${e instanceof Error ? e.message.slice(0, 80) : 'error'})`); }
  }
  // everything fetched is now behind the cursor (also what wasn't in the Primary inbox): never fetched again
  await d.store.updateMailbox(row.id, { cursor: nextCursor(cursor, mails, ok), last_checked_at: nowIso, problem: ok ? null : CHECK_LATER });
  return { read: fresh.length, added };
}
async function check(d: Deps): Promise<Out> {
  const cfg = config(d.env);
  if (!cfg) return json({ ok: true, skipped: 'not set up' });
  try { await mailKey(cfg.key); } catch { d.log('check: PLANNER_MAIL_KEY is not 32 bytes of base64'); return json({ ok: true, skipped: 'not set up' }); }
  const started = d.now();
  const found = new Map<string, number>();
  let mailboxes = 0, read = 0;
  for (const row of (await d.store.watched()).slice(0, CHECK_MAILBOXES)) {
    if (d.now() - started > CHECK_BUDGET_MS) { d.log('check: out of time, the rest wait for the next one'); break; }
    try {
      const r = await checkOne(d, cfg, row);
      mailboxes++; read += r.read;
      if (r.added) found.set(row.user_id, (found.get(row.user_id) || 0) + r.added);
    } catch (e) { d.log(`check ${row.id}: ${e instanceof Error ? e.name : 'error'}`); }
  }
  // one notification a person, however many of their mailboxes had something: how many, and nothing of what they say
  for (const [userId, n] of found) {
    try { const who = await d.store.person(userId); if (who) await d.notify(who, notifyLine(n)); }
    catch (e) { d.log(`check: notification not sent (${e instanceof Error ? e.name : 'error'})`); }
  }
  return json({ ok: true, mailboxes, read, found: [...found.values()].reduce((a, b) => a + b, 0) });
}

// ── receipts: a look back through a person's mailboxes for what they paid ──
/** New emails one call reads at most; how long it goes on before it stops and lets the app call again; how many
 *  emails Gmail is asked for a page at a time; how many emails are read and put to Claude in one go (three questions
 *  of RECEIPT_BATCH, side by side). */
export const RECEIPTS_MAX = 40, RECEIPTS_BUDGET_MS = 50_000;
const RECEIPTS_PAGE = 50, RECEIPTS_CHUNK = RECEIPT_BATCH * 3;
const RECEIPTS_TOOL: ClaudeTool = { name: 'receipts', description: 'What each of these emails shows this person paid: one entry per email, is_purchase false when it shows nothing paid.', maxTokens: 4000, empty: { receipts: [] } };
const LOOK_DOWN = 'Google didn’t answer while this mailbox was being looked through. Look again in a minute: what was already looked at is skipped.';
/** A receipt's id comes from the email it was found in, so reading that email again (it never is: its mark says it
 *  was looked at) would give the same id, never a second receipt. */
const receiptId = (mailboxId: string) => (mail: CheckMail): string => `email_${mailboxId.replace(/-/g, '').slice(-12)}_${mail.id}`;
interface BoxCount { address: string; scanned: number; found: number; problem?: string }

/** One mailbox, from the page the cursor is at. Returns the page to carry on from, or null when the mailbox is done. */
async function lookThrough(d: Deps, row: MailboxRow, access: string, p: Provider,
  c: { me: Me; owner: string; since: string; today: string; cur: ReceiptsCursor; count: BoxCount; left: () => number; outOfTime: () => boolean }): Promise<string | null> {
  const q = receiptQuery(c.since);
  let page = c.cur.p;
  for (;;) {
    if (c.left() <= 0 || c.outOfTime()) return page;
    const l = await p.search(access, { q, ...(page ? { pageToken: page } : {}), max: RECEIPTS_PAGE }, d.fetch);
    const ids = [...new Set(l.ids)].filter(id => isMessageId(id) && !c.cur.t.includes(id));
    const have = new Set(ids.length ? await d.store.haveDocs(c.owner, MAILRECEIPT_KIND, ids.map(id => mailReceiptKey(row.id, id))) : []);
    const fresh = ids.filter(id => !have.has(mailReceiptKey(row.id, id)));
    for (let at = 0; at < fresh.length; at += RECEIPTS_CHUNK) {
      // stopped part way through a page: the next call asks for the same page again, and skips what was done
      if (c.left() <= 0 || c.outOfTime()) return page;
      const ids = fresh.slice(at, at + Math.min(RECEIPTS_CHUNK, c.left()));
      await readForReceipts(d, row, access, p, ids, c);
      if (ids.length < Math.min(RECEIPTS_CHUNK, fresh.length - at)) return page;
    }
    if (!l.next) return null;
    page = l.next;
  }
}
/** These emails read, put to Claude a few at a time, and what they showed saved. */
async function readForReceipts(d: Deps, row: MailboxRow, access: string, p: Provider, ids: string[],
  c: { me: Me; owner: string; since: string; today: string; cur: ReceiptsCursor; count: BoxCount }): Promise<void> {
  const nowIso = new Date(d.now()).toISOString();
  const mails: MailFull[] = [], gone: string[] = [];
  for (let i = 0; i < ids.length; i += 5) {   // five at a time
    const got = await Promise.all(ids.slice(i, i + 5).map(id => p.read(access, id, d.fetch, RECEIPT_CHARS).catch(e => { if (e instanceof MailError && e.kind === 'gone') { gone.push(id); return null; } throw e; })));
    mails.push(...got.filter((m): m is MailFull => !!m));
  }
  // an email that isn't there any more is remembered as looked at, so it isn't asked for again
  if (gone.length) await d.store.addDocs(c.owner, gone.map(id => ({ kind: MAILRECEIPT_KIND, key: mailReceiptKey(row.id, id), data: { at: nowIso, found: false } satisfies MailReceiptMark })));
  c.count.scanned += mails.length + gone.length;
  const asked: CheckMail[] = mails.map(m => ({ id: m.id, at: m.at, from: m.from, subject: m.subject, text: m.text }));
  const system = receiptSystem({ name: c.me.name || 'this person', today: c.today, since: c.since });
  const batches: CheckMail[][] = [];
  for (let i = 0; i < asked.length; i += RECEIPT_BATCH) batches.push(asked.slice(i, i + RECEIPT_BATCH));
  await Promise.all(batches.map(async batch => {
    let answer: unknown;
    try { answer = await d.claude(system, receiptInput(batch), RECEIPT_SCHEMA, RECEIPTS_TOOL); }
    catch (e) {
      // not remembered: passed over for the rest of this look, and tried again the next time one is run
      d.log(`receipts ${row.id}: not read for receipts (${e instanceof Error ? e.message.slice(0, 80) : 'error'})`);
      c.cur.t.push(...batch.map(m => m.id));
      return;
    }
    const out = receiptsFrom(answer, batch, { mailbox: row.address, since: c.since, today: c.today, nowIso, uid: receiptId(row.id) });
    const writes: { kind: string; key: string; data: unknown }[] = [];
    for (const { mail, receipt } of out) {
      if (receipt) writes.push({ kind: RECEIPT_KIND, key: receipt.key, data: receipt.data });
      writes.push({ kind: MAILRECEIPT_KIND, key: mailReceiptKey(row.id, mail.id), data: { at: nowIso, found: !!receipt, ...(receipt ? { receiptKey: receipt.key } : {}) } satisfies MailReceiptMark });
    }
    // the receipts and the marks that say their emails were looked at, in one write; nothing already there is touched
    await d.store.addDocs(c.owner, writes);
    c.count.found += out.filter(o => o.receipt).length;
  }));
}
async function receipts(b: Record<string, unknown>, me: Me, d: Deps): Promise<Out> {
  const cfg = config(d.env);
  if (!cfg) return problem(NOT_SET_UP, 'not_set_up');
  try { await mailKey(cfg.key); } catch { d.log('receipts: PLANNER_MAIL_KEY is not 32 bytes of base64'); return problem(NOT_SET_UP, 'not_set_up'); }
  const started = d.now(), day = today(started).today;
  // money belongs to the household: written under its owner, as planner-plaid does
  const owner = me.household || me.id;
  // this person's own mailboxes, and no one else's
  const boxes = (await d.store.mailboxes(me.id)).filter(r => r.user_id === me.id);
  const given = b.cursor === undefined || b.cursor === null || b.cursor === '' ? null : readReceiptsCursor(b.cursor);
  if (given && given.s > day) given.s = receiptsSince(undefined, day);
  const cur: ReceiptsCursor = given || { s: receiptsSince(b.since, day), m: boxes[0]?.id || '', i: 0, p: '', t: [] };
  // where the look had got to: that mailbox (found by its id). One disconnected since: the one now in its place, from its first page.
  let i = boxes.findIndex(r => r.id === cur.m);
  if (i < 0) { i = Math.min(cur.i, boxes.length); cur.p = ''; }
  const counts: BoxCount[] = [];
  let read = 0;
  const outOfTime = () => d.now() - started > RECEIPTS_BUDGET_MS;
  for (; i < boxes.length; i++, cur.p = '') {
    if (read >= RECEIPTS_MAX || outOfTime()) break;
    const row = boxes[i];
    const count: BoxCount = { address: row.address, scanned: 0, found: 0 };
    counts.push(count);
    cur.m = row.id; cur.i = i;
    if (!row.token_enc) { count.problem = EXPIRED; continue; }
    let page: string | null;
    try {
      page = await withMailbox(d, cfg, row, (access, p) => lookThrough(d, row, access, p, { me, owner, since: cur.s, today: day, cur, count,
        left: () => RECEIPTS_MAX - read - count.scanned, outOfTime }));
    } catch (e) {
      if (e instanceof NoKey) { d.log('receipts: PLANNER_MAIL_KEY is not 32 bytes of base64'); return problem(NOT_SET_UP, 'not_set_up'); }
      if (!(e instanceof MailError)) throw e;
      d.log(`receipts ${row.id}: ${e.why}`);
      // this mailbox's problem in plain words, and on to the next one
      count.problem = e.kind === 'expired' ? EXPIRED : e.kind === 'not_allowed' ? NO_READING : LOOK_DOWN;
      read += count.scanned;
      continue;
    }
    read += count.scanned;
    if (page !== null) { cur.p = page; break; }   // stopped part way: carried on from here at the next call
  }
  const more = i < boxes.length;
  return json({ scanned: read, found: counts.reduce((a, x) => a + x.found, 0), more, ...(more ? { cursor: writeReceiptsCursor({ ...cur, m: boxes[i].id, i }) } : {}),
    mailboxes: counts });
}

/** One request to the function. Never throws for something a person did: the answer says what went wrong. */
export async function handle(req: In, d: Deps): Promise<Out> {
  // the one address Google knows: a GET on …/planner-mail/callback
  if (req.method === 'GET') return /\/planner-mail\/callback$/.test(req.path) ? callback(req.query, d) : json({ error: 'Not found' }, 404);
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const b = req.body, action = str(b.action, 30);

  if (action === 'check') {
    const want = d.env('PLANNER_CRON_KEY') || await d.store.cronKey();
    if (!sameSecret(req.cronKey, want)) return json({ error: 'Not allowed' }, 403);
    return check(d);
  }

  const me = typeof b.token === 'string' && b.token ? await d.me(b.token) : null;
  if (!me) return json({ error: 'signed_out' }, 401);
  const cfg = config(d.env);
  const nowIso = new Date(d.now()).toISOString();

  if (action === 'list') return json({ mailboxes: (await d.store.mailboxes(me.id)).map(forList), ready: !!cfg });

  if (action === 'connect_start') {
    if (!isProvider(b.provider)) return json({ error: 'Only Gmail can be connected for now.' }, 400);
    if (!cfg) return problem(NOT_SET_UP, 'not_set_up');
    try { await mailKey(cfg.key); } catch { d.log('connect_start: PLANNER_MAIL_KEY is not 32 bytes of base64'); return problem(NOT_SET_UP, 'not_set_up'); }
    // unguessable, good for one use and for ten minutes, and tied to this person and the planner they came from
    const value = newState();
    await d.store.startState(await stateRow(value, { userId: me.id, app: isApp(b.app) ? b.app : me.app, provider: b.provider }, d.now()), nowIso);
    return json({ url: PROVIDERS[b.provider].signInUrl({ clientId: cfg.id, redirect: cfg.redirect, state: value }) });
  }

  if (action === 'connect_finish') return connectFinish(b, me, d);

  if (action === 'receipts') return receipts(b, me, d);

  // everything below is about one mailbox: this person's own, or nothing
  if (!['disconnect', 'watch', 'inbox', 'read', 'send'].includes(action)) return json({ error: 'Unknown action' }, 400);
  const row = await d.store.mailbox(me.id, str(b.mailbox, 60));
  if (!row || row.user_id !== me.id) return json({ error: 'That mailbox isn’t connected to your planner.' }, 404);

  if (action === 'disconnect') {
    // taken back at Google where that can be done, then forgotten here either way
    let revoked = false;
    const p = providerOf(row);
    if (row.token_enc && cfg && p) {
      try { await p.revoke(await open(await mailKey(cfg.key), row.token_enc, tokenOwner(row)), d.fetch); revoked = true; }
      catch (e) { d.log(`disconnect ${row.id}: not taken back at Google (${e instanceof MailError ? e.why : e instanceof Error ? e.name : 'error'})`); }
    }
    await d.store.deleteMailbox(row.id);
    kept.delete(row.id);
    await d.store.dropWaiting(me.id, row.id, nowIso);
    return json({ ok: true, revoked });
  }

  if (action === 'watch') {
    const on = b.on === true;
    // switched on: from now, not what came in while it was off
    await d.store.updateMailbox(row.id, { todos: on, ...(on && !row.todos ? { cursor: startCursor(d.now()) } : {}) });
    return json({ ok: true, todos: on });
  }

  if (!cfg) return problem(NOT_SET_UP, 'not_set_up');
  try {
    if (action === 'inbox') {
      const max = Math.max(1, Math.min(INBOX_MAX, Math.floor(Number(b.max)) || INBOX_MAX));
      return json(await withMailbox(d, cfg, row, async (access, p) => {
        const l = await p.list(access, { search: str(b.search, 120), unread: b.unread === true, max }, d.fetch);
        const lines = await Promise.all(l.ids.map(id => p.line(access, id, d.fetch).catch(e => { if (e instanceof MailError && e.kind === 'gone') return null; throw e; })));
        return { mails: lines.filter((m): m is MailLine => !!m), more: l.more };
      }));
    }
    if (action === 'read') {
      if (!isMessageId(b.id)) return json({ error: 'Which email?' }, 400);
      const id = b.id;
      return json({ mail: forApp(await withMailbox(d, cfg, row, (access, p) => p.read(access, id, d.fetch))) });
    }
    // send: exactly who, what subject and which words the app gave (what the Confirm card showed), as this mailbox
    const draft = cleanDraft({ to: b.to, subject: b.subject, body: b.body });
    if ('problem' in draft) return problem(draft.problem, 'draft');
    if (b.reply_to !== undefined && b.reply_to !== null && b.reply_to !== '' && !isMessageId(b.reply_to)) return json({ error: 'Which email is this an answer to?' }, 400);
    if (!canSend(row, providerOf(row))) return problem(NO_SENDING, 'not_allowed');
    const replyTo = isMessageId(b.reply_to) ? b.reply_to : undefined;
    const sent = await withMailbox(d, cfg, row, (access, p) => p.send(access, { from: row.address, draft, ...(replyTo ? { replyTo } : {}) }, d.fetch));
    return json({ ok: true, id: sent.id });
  } catch (e) { return failed(d, action, row, e); }
}
