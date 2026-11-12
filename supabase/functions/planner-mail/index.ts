// supabase/functions/planner-mail/index.ts — the planner's email: each person connects their own mailboxes, Arvy
// reads them when asked and drafts answers, nothing is sent without a Confirm tap, and what comes in is turned into
// offered to-dos. Gmail only for now (gmail.ts keeps the mail service behind one small interface).
//
// This file is the wiring: the database, the secrets, Claude and the notification, handed to handle.ts, where every
// action is written and documented (connect_start, connect_finish, list, disconnect, watch, inbox, read, send; the
// callback Google sends people back to; check, from pg_cron). mail.ts reads an email, secure.ts locks the stored token.
//
// Sign-in happens on Google's own page: this function never sees or asks for an email password. Connecting takes two
// steps on purpose. Google sends the browser to the callback, which connects nothing: it passes the browser on to the
// planner with Google's code after the # of the address. The planner, signed in, then hands the code back
// (connect_finish), and only if the person signed in there is the one who tapped Connect is the code swapped for
// tokens. So a sign-in link handed to someone else can't put their mailbox in the wrong planner.
// What is kept for a mailbox is Google's refresh token, encrypted (AES-GCM, key = PLANNER_MAIL_KEY), in
// planner_mailboxes: a table only the service role reaches. It is never sent to the app, never logged, never part
// of an error.
//
// Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET (the planner's Google sign-in client),
//   PLANNER_MAIL_KEY (32 random bytes, base64). Any of them missing: "Email isn't set up yet", not a crash.
//   Optional: PLANNER_MAIL_REDIRECT (else <SUPABASE_URL>/functions/v1/planner-mail/callback, the address registered
//   with Google), PLANNER_SITE (where the planner is served, as planner-push), PLANNER_CRON_KEY (else
//   planner_secrets.cron_key). Claude: ANTHROPIC_API_KEY and ARVY_MODEL, as planner-arvy.
// Deployed without JWT verification, like the other planner functions: planner users have no Supabase account, and
// Google's redirect and pg_cron can't send one. The app's calls carry the planner token (checked with planner_me),
// the callback only passes the browser on (it changes nothing), the check carries the cron key.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { handle, type Deps, type MailboxRow, type Me, type Store } from './handle.ts';
import { MAILTODO_KIND, type MailTodo } from './mail.ts';
import type { StateRow } from './secure.ts';
import { sendPush, type VapidKeys } from './webpush.ts';

const env = (k: string) => (Deno.env.get(k) || '').trim();
const MODEL = env('ARVY_MODEL') || 'claude-sonnet-5-5';
const FALLBACK = 'claude-sonnet-5-5';
const WORKSPACE = env('ANTHROPIC_WORKSPACE_ID');
const SUBJECT = 'mailto:planner@propertystars.app';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const plain = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };
// deno-lint-ignore no-explicit-any
type Svc = any;

interface UserRow { id: string; username: string; display_name: string | null; settings: { app?: string } | null }
const meOf = (u: UserRow): Me => ({ id: u.id, name: (u.display_name || u.username || '').split(/\s+/)[0] || 'there', app: u.settings?.app === 'roshplanner' ? 'roshplanner' : 'vijayplanner' });

// ── the database (service role: the two mail tables have no policies, nothing else reaches them) ──
const COLS = 'id, user_id, provider, address, token_enc, scopes, todos, last_checked_at, cursor, problem, created_at';
/** A database refusal as an error that says where and Postgres's short code: never the row, never its values. */
const must = (what: string, error: { code?: string } | null) => { if (error) throw new Error(`db ${what}: ${String(error.code || 'failed').slice(0, 20)}`); };
function storeOf(svc: Svc): Store {
  return {
    async startState(row: StateRow, nowIso: string) {
      await svc.from('planner_mail_states').delete().eq('user_id', row.user_id).not('used_at', 'is', null);
      await svc.from('planner_mail_states').delete().eq('user_id', row.user_id).lt('expires_at', nowIso);
      must('state', (await svc.from('planner_mail_states').insert(row)).error);
    },
    async peekState(hash: string) {
      const { data, error } = await svc.from('planner_mail_states').select('state_hash, user_id, app, provider, expires_at, used_at').eq('state_hash', hash).maybeSingle();
      must('state', error);
      return (data as StateRow | null) || null;
    },
    async claimState(hash: string, nowIso: string) {
      // one statement: only a row not yet used is marked, and only the request that marked it gets it back
      const { data, error } = await svc.from('planner_mail_states').update({ used_at: nowIso }).eq('state_hash', hash).is('used_at', null).select('state_hash, user_id, app, provider, expires_at, used_at');
      must('claim', error);
      return ((data || []) as StateRow[])[0] || null;
    },
    async mailboxes(userId: string) {
      const { data, error } = await svc.from('planner_mailboxes').select(COLS).eq('user_id', userId).order('created_at');
      must('mailboxes', error);
      return (data || []) as MailboxRow[];
    },
    async mailbox(userId: string, id: string) {
      if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return null;
      const { data, error } = await svc.from('planner_mailboxes').select(COLS).eq('id', id).eq('user_id', userId).maybeSingle();
      must('mailbox', error);
      return (data as MailboxRow | null) || null;
    },
    async saveMailbox(m) {
      // one row for a person's address. Connecting it again replaces the token and clears what was wrong; whether
      // its to-dos are on is left as it was (it isn't written here: a new row takes the table's default, on)
      const { data, error } = await svc.from('planner_mailboxes').upsert({ ...m, problem: null, last_checked_at: null }, { onConflict: 'user_id,provider,address' }).select(COLS).single();
      must('save', error);
      return data as MailboxRow;
    },
    async updateMailbox(id: string, patch) { must('update', (await svc.from('planner_mailboxes').update(patch).eq('id', id)).error); },
    async deleteMailbox(id: string) { must('delete', (await svc.from('planner_mailboxes').delete().eq('id', id)).error); },
    async watched() {
      // the one checked longest ago first, so a check that runs out of time picks up where it stopped
      const { data, error } = await svc.from('planner_mailboxes').select(COLS).eq('todos', true).not('token_enc', 'is', null).order('last_checked_at', { ascending: true, nullsFirst: true });
      must('watched', error);
      return (data || []) as MailboxRow[];
    },
    async person(userId: string) {
      const { data } = await svc.from('planner_users').select('id, username, display_name, settings').eq('id', userId).maybeSingle();
      return data ? meOf(data as UserRow) : null;
    },
    async addTodos(userId: string, docs: { key: string; data: MailTodo }[], nowIso: string) {
      if (!docs.length) return 0;
      // their own docs, like any other the planner keeps. One that is already there (added, turned down) is not touched.
      const { data, error } = await svc.from('planner_docs').upsert(docs.map(d => ({ user_id: userId, kind: MAILTODO_KIND, key: d.key, data: d.data, updated_at: nowIso })), { onConflict: 'user_id,kind,key', ignoreDuplicates: true }).select('key');
      must('to-dos', error);
      return ((data || []) as unknown[]).length;
    },
    async dropWaiting(userId: string, mailboxId: string, nowIso: string) {
      const { data } = await svc.from('planner_docs').select('key, data').eq('user_id', userId).eq('kind', MAILTODO_KIND);
      for (const doc of (data || []) as { key: string; data: MailTodo | null }[]) {
        const t = doc.data;
        if (!t || typeof t !== 'object' || t.state !== 'waiting' || t.mailbox?.id !== mailboxId) continue;
        await svc.from('planner_docs').update({ data: { ...t, state: 'dismissed', doneAt: nowIso }, updated_at: nowIso }).eq('user_id', userId).eq('kind', MAILTODO_KIND).eq('key', doc.key);
      }
    },
    async cronKey() {
      const { data } = await svc.from('planner_secrets').select('value').eq('name', 'cron_key').maybeSingle();
      return typeof data?.value === 'string' ? data.value : '';
    },
  };
}

// ── Claude reads the new email for to-dos: one forced tool call, as planner-chat asks for its structured answers ──
const forcedMode = new Map<string, number>();   // model → 0 forced, thinking off · 1 forced · 2 asked to call it
/** Errors say the status and Anthropic's short type ("529 overloaded_error"), never its sentences. */
async function claude(sys: string, user: string, schema: unknown): Promise<unknown> {
  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Claude: no key');
  type Out = { stop_reason?: string; content?: { type: string; input?: unknown }[]; error?: { type?: string; message?: string } };
  let model = MODEL; let res: Response | null = null; let data: Out = {}; let waits = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    const mode = forcedMode.get(model) ?? 0;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(WORKSPACE ? { 'anthropic-workspace-id': WORKSPACE } : {}) },
        body: JSON.stringify({ model, max_tokens: mode === 2 ? 4000 : 1500,
          system: mode === 2 ? `${sys}\n\nGive your answer only by calling the "todos" tool, once. Write nothing else.` : sys,
          messages: [{ role: 'user', content: user }], ...(mode === 0 ? { thinking: { type: 'disabled' } } : {}),
          tools: [{ name: 'todos', description: 'What these emails ask this person to do. An empty list when none of them does.', input_schema: schema }],
          tool_choice: mode === 2 ? { type: 'auto' } : { type: 'tool', name: 'todos' } }),
        signal: AbortSignal.timeout(60000),
      });
    } catch (e) { throw new Error(`Claude: ${e instanceof Error && e.name === 'TimeoutError' ? 'no answer in time' : 'the request failed'}`); }
    data = await res.json().catch(() => ({})) as Out;
    if (res.ok) break;
    const msg = String(data.error?.message || '');
    if (res.status === 400 && mode < 2 && /thinking|tool_choice/i.test(msg)) { forcedMode.set(model, /tool_choice/i.test(msg) ? 2 : mode + 1); continue; }
    if ((res.status === 404 || res.status === 400 && /model/i.test(msg)) && model !== FALLBACK) { model = FALLBACK; continue; }
    if (!(res.status === 429 || res.status === 529 || res.status >= 500) || ++waits > 2) break;
    await new Promise(r => setTimeout(r, 1200 * waits));
  }
  if (!res || !res.ok) throw new Error(`Claude: ${res?.status ?? 'no answer'} ${String(data.error?.type || '').replace(/[^a-z_]/gi, '').slice(0, 40)}`.trim());
  if (data.stop_reason === 'max_tokens') throw new Error('Claude: the answer ran too long');
  return (data.content || []).find(c => c.type === 'tool_use')?.input ?? { todos: [] };   // no call = nothing to do in them
}

// ── one notification (as planner-push and planner-chat send theirs: the same keys, the same subscriptions) ──
async function notify(svc: Svc, to: Me, body: string): Promise<void> {
  const { data: k } = await svc.from('push_keys').select('public_key, private_jwk').eq('id', 1).maybeSingle();
  if (!k) return;
  const keys: VapidKeys = { publicKey: k.public_key, privateJwk: k.private_jwk };
  const { data } = await svc.from('planner_docs').select('key, data').eq('user_id', to.id).eq('kind', 'push');
  for (const d of (data || []) as { key: string; data: { endpoint?: string; p256dh: string; auth: string } | null }[]) {
    if (!d.data?.endpoint) continue;
    try {
      // opens Today, where the "From your email" card is
      const status = await sendPush(d.data as { endpoint: string; p256dh: string; auth: string }, { title: 'Arvy', body, url: `/${to.app}/`, tag: 'mail', icon: `/${to.app}/icon-192.png` }, keys, SUBJECT);
      if (status === 404 || status === 410) await svc.from('planner_docs').update({ data: { gone: true, at: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq('user_id', to.id).eq('kind', 'push').eq('key', d.key);
    } catch { console.error('planner-mail: a notification was not sent'); }
  }
}

function deps(): Deps {
  const url = env('SUPABASE_URL');
  const svc = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  return {
    store: storeOf(svc), fetch: (u, init) => fetch(u, init), env, now: () => Date.now(), claude,
    // the planner token, checked exactly as planner-arvy checks it
    async me(token: string) {
      const anon = createClient(url, env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
      const { data, error } = await anon.rpc('planner_me', { p_token: token });
      const user = (data as { ok?: boolean; user?: UserRow } | null)?.user;
      return error || !(data as { ok?: boolean } | null)?.ok || !user?.id ? null : meOf(user);
    },
    notify: (to, body) => notify(svc, to, body),
    log: line => console.error(`planner-mail ${line}`),
  };
}
/** What an unexpected error may leave in the log: the lines this function wrote itself, else only the kind of error. */
const safe = (e: unknown): string => (e instanceof Error ? (/^(db |Claude: |mail: )/.test(e.message) ? e.message.slice(0, 120) : e.name) : 'error');

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);
  let action = req.method === 'GET' ? 'callback' : '?';
  try {
    const raw = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const body = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    if (req.method === 'POST') action = String(body.action || '?').slice(0, 30);
    const out = await handle({ method: req.method, path: url.pathname, query: url.searchParams, body, cronKey: req.headers.get('x-cron-key') || '' }, deps());
    // on to the planner. Google's code and the state go along only after the # of that address, which a browser
    // keeps to itself (it is not sent to the planner's site, and no-referrer keeps this address from being passed on)
    if ('redirect' in out) return new Response(null, { status: 302, headers: { Location: out.redirect, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    if ('text' in out) return new Response(out.text, { status: out.status, headers: plain });
    return json(out.json, out.status);
  } catch (e) {
    console.error('planner-mail:', action, safe(e));
    if (req.method === 'GET') return new Response('Something went wrong connecting the mailbox. Go back to your planner and try again.', { status: 500, headers: plain });
    return json({ error: 'Something went wrong' }, 500);
  }
});
