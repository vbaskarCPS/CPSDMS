// supabase/functions/planner-chat/index.ts — the chat between the two of them (src/planner/features/us).
//
//   POST { token, action: 'say', text?, media?: [Media], looks?: [{ media_type, data }], reply?: { key, text?, media? } } → { ok, key, msg }
//        Saves the message for the household, tells the other person's phone, then Arvy reads it (the words, and
//        `looks`: the photos, or a few stills of a video) and hangs its proposals on the message: shopping items, a
//        calendar event, a to-do. A proposal sends a push and waits for a Confirm tap; nothing is added by itself.
//        `reply` makes it a reply to the message under that key: the original is looked up in this household's chat
//        and the quote saved with the reply is taken from it (who wrote it, its first line), not from the app.
//        A message addressed to Arvy ("RV plan…", "Arvy, can you…", "@rv": chat.ts toArvy) from an app that can
//        answer it (`turn: true`) is NOT read along: it is saved with ask: { state: 'working' }, and that phone runs
//        Arvy with its own tools and posts the answer (action 'answer'). `picked: [key]` = messages picked out for
//        Arvy with it ("Ask Arvy", their own words): all of them have to be in this household's chat. An app from
//        before this sends no `turn`, and its messages are read along as they always were.
//   POST { token, action: 'answer', key, text, links?, sources?, changes?: [{ tool, input, lines, for? }] } → { ok, key, msg, asked: { key, msg } }
//        Arvy's answer to the message under `key`, posted by the phone that worked it out. Only the one who wrote
//        that message may post it, only when the message was addressed to Arvy, and only once. The words are cleaned
//        and cut, the buttons under it can only be tel: and https: links, and what Arvy set up becomes proposals on
//        the new message (chat.ts arvyAnswer). It is saved as a message written by Arvy, tied to the asking one like
//        a reply, and the other person's phone is told.
//   POST { token, action: 'asked', key, state: 'failed' | 'working' } → { ok, msg }
//        The asker's phone says its try gave up (a plain line shows under the message), or that they asked again.
//   POST { token, action: 'ask', keys: [key], what: 'shopping' | 'todo' | 'calendar' | 'words', for?, words? } → { ok, key, msg, added, note? }
//        One of them picked messages out (12 at most, all from this household's chat) and asked Arvy to do something
//        with them: put them on the shopping list, make a to-do for one of them (`for`), put them on the calendar,
//        or what they typed (`words`). Arvy reads those messages and their pictures and its proposals are hung on
//        the last one picked, to be confirmed like any other. `note` = why there was nothing to propose.
//   POST { token, action: 'resolve', key, id, state: 'done' | 'dismissed' | 'waiting' } → { ok, msg }
//        A proposal confirmed (the phone then makes the change), turned down, or put back after a failed change.
//        The first one to answer wins: ok false = someone already had.
//   POST { token, action: 'upload', files: [{ type, size }] } → { files: [{ kind, path, token }] }   where to put photos and videos
//   POST { token, action: 'media', paths: [path] } → { urls: { [path]: url } }                      links to see them, good for an hour
//
// Messages are planner docs of kind 'chat', owned by the household (the app reads them with planner_get like the
// shopping list). Photos and videos sit in the private bucket planner-chat under the household's folder; only this
// function reaches it. The planner token (planner_sign_in) is checked with planner_me: deployed without JWT
// verification because planner users have no Supabase account. Claude key: ANTHROPIC_API_KEY; model: ARVY_MODEL.
// What a message is and how Arvy's reading becomes proposals: chat.ts (shared with the app).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { sendPush, type VapidKeys } from './webpush.ts';
import { ARVY_NAME, BUCKET, CHAT_KIND, MAX_ASK, MAX_IMAGE_BYTES, MAX_MEDIA, MAX_VIDEO_BYTES, MEDIA_TYPES, READ_SCHEMA, addProposals, arvyAnswer, askSystem, askText, askWords, askedNext, cleanAsk, cleanMessage, cleanPicked, isKey, onlyAsked, pickedFrom, proposalsFrom, pushLine, readSystem, readText, readingOf, replyFrom, resolveProposal, settleReading, type ChatMsg } from './chat.ts';

const MODEL = Deno.env.get('ARVY_MODEL') || 'claude-sonnet-5-5';
const FALLBACK = 'claude-sonnet-5-5';
const WORKSPACE = Deno.env.get('ANTHROPIC_WORKSPACE_ID') || '';
const SUBJECT = 'mailto:planner@propertystars.app';
const TZ = 'America/Toronto';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
// deno-lint-ignore no-explicit-any
type Svc = any;
declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;
interface Person { id: string; username: string; display_name: string; settings: { app?: string } | null; household_id: string | null }
const first = (p: Person) => (p.display_name || p.username).split(/\s+/)[0];
const appOf = (p: Person) => (p.settings?.app === 'roshplanner' ? 'roshplanner' : 'vijayplanner');
const rand = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => (b % 36).toString(36)).join('');

// ── push (as planner-push does it: the same keys and the same subscriptions) ──
async function vapid(svc: Svc): Promise<VapidKeys | null> {
  const { data } = await svc.from('push_keys').select('public_key, private_jwk').eq('id', 1).maybeSingle();
  return data ? { publicKey: data.public_key, privateJwk: data.private_jwk } : null;
}
async function push(svc: Svc, to: Person, payload: { title: string; body: string; tag: string }): Promise<number> {
  const k = await vapid(svc);
  if (!k) return 0;
  const { data } = await svc.from('planner_docs').select('key, data').eq('user_id', to.id).eq('kind', 'push');
  let sent = 0;
  for (const d of (data || []) as { key: string; data: { endpoint?: string; p256dh: string; auth: string } | null }[]) {
    if (!d.data?.endpoint) continue;
    try {
      const status = await sendPush(d.data as { endpoint: string; p256dh: string; auth: string }, { ...payload, url: `/${appOf(to)}/us`, icon: `/${appOf(to)}/icon-192.png` }, k, SUBJECT);
      if (status === 404 || status === 410) await svc.from('planner_docs').update({ data: { gone: true, at: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq('user_id', to.id).eq('kind', 'push').eq('key', d.key);
      else if (status < 300) sent++;
    } catch (e) { console.error('planner-chat push:', e instanceof Error ? e.message : e); }
  }
  return sent;
}

// ── Arvy reads a message: one forced tool call, as planner-arvy asks for structured answers ──
const forcedMode = new Map<string, number>();   // model → 0 forced, thinking off · 1 forced · 2 asked to call it
const READS = 'What this message means for their shopping list, calendar and to-dos. Leave everything out when it means nothing for them.';
async function claudeRead(sys: string, content: unknown[], about = READS): Promise<unknown> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  type Out = { stop_reason?: string; content?: { type: string; input?: unknown }[]; error?: { message?: string } };
  let model = MODEL; let res: Response | null = null; let data: Out = {}; let waits = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    const mode = forcedMode.get(model) ?? 0;
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(WORKSPACE ? { 'anthropic-workspace-id': WORKSPACE } : {}) },
      body: JSON.stringify({ model, max_tokens: mode === 2 ? 3000 : 700,
        system: mode === 2 ? `${sys}\n\nGive your answer only by calling the "propose" tool, once. Write nothing else.` : sys,
        messages: [{ role: 'user', content }], ...(mode === 0 ? { thinking: { type: 'disabled' } } : {}),
        tools: [{ name: 'propose', description: about, input_schema: READ_SCHEMA }],
        tool_choice: mode === 2 ? { type: 'auto' } : { type: 'tool', name: 'propose' } }),
      signal: AbortSignal.timeout(60000),
    });
    data = await res.json().catch(() => ({})) as Out;
    if (res.ok) break;
    const msg = String(data.error?.message || '');
    if (res.status === 400 && mode < 2 && /thinking|tool_choice/i.test(msg)) { forcedMode.set(model, /tool_choice/i.test(msg) ? 2 : mode + 1); continue; }
    if ((res.status === 404 || res.status === 400 && /model/i.test(msg)) && model !== FALLBACK) { model = FALLBACK; continue; }
    if (!(res.status === 429 || res.status === 529 || res.status >= 500) || ++waits > 2) break;
    await new Promise(r => setTimeout(r, 1200 * waits));
  }
  if (!res || !res.ok) throw new Error(data.error?.message || `Anthropic ${res?.status}`);
  return (data.content || []).find(c => c.type === 'tool_use')?.input ?? {};   // no call = nothing to propose
}

function nowParts(): { today: string; weekday: string; now: string } {
  const d = new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
  return { today: `${p.year}-${p.month}-${p.day}`, weekday: new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(d), now: new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d) };
}

/** Arvy reads one message and its proposals are saved on it; a push goes out for what waits for a tap. */
async function readAndPropose(svc: Svc, owner: string, members: Person[], key: string, msg: ChatMsg, looks: { media_type: string; data: string }[]): Promise<void> {
  const put = async (arvy: ChatMsg['arvy']) => {
    const { data: cur } = await svc.from('planner_docs').select('data').eq('user_id', owner).eq('kind', CHAT_KIND).eq('key', key).maybeSingle();
    // proposals asked for by hand while this was being read (action 'ask') stay on the message
    if (cur?.data) await svc.from('planner_docs').update({ data: { ...(cur.data as ChatMsg), arvy: settleReading((cur.data as ChatMsg).arvy, arvy!) }, updated_at: new Date().toISOString() }).eq('user_id', owner).eq('kind', CHAT_KIND).eq('key', key);
  };
  try {
    const { data: earlier } = await svc.from('planner_docs').select('key, data').eq('user_id', owner).eq('kind', CHAT_KIND).lt('key', key).order('key', { ascending: false }).limit(8);
    const before = ((earlier || []) as { data: ChatMsg | null }[]).map(d => d.data).filter((m): m is ChatMsg => !!m && typeof m === 'object' && !!m.by).reverse();
    const video = msg.media?.some(m => m.kind === 'video');
    const t = nowParts();
    // what it reads (chat.ts readText): a reply is read with what it answers, the chat's own emoji as ordinary ones
    const out = await claudeRead(readSystem({ ...t, members: members.map(m => ({ username: m.username, name: first(m) })), writer: msg.name }), [
      { type: 'text', text: readText(before, msg, looks.length ? (video ? 'stills' : 'photos') : null) },
      ...looks.map(l => ({ type: 'image', source: { type: 'base64', media_type: l.media_type, data: l.data } })),
    ]);
    const { proposals, note } = proposalsFrom(out, { today: t.today, members: members.map(m => ({ username: m.username, name: first(m) })), id: () => rand(6) });
    await put(proposals.length || note ? { state: 'done', ...(note ? { note } : {}), ...(proposals.length ? { proposals } : {}) } : { state: 'none' });
    for (const p of proposals) {
      const to = p.for ? members.filter(m => m.username === p.for) : members;   // a to-do: only the person it's for
      await Promise.all(to.map(m => push(svc, m, { title: 'Arvy', body: `${p.lines.join(' ')}? Tap to confirm.`, tag: `arvy-${p.id}` })));
    }
  } catch (e) {
    console.error('planner-chat read:', e instanceof Error ? e.message : String(e));
    await put({ state: 'failed' }).catch(() => undefined);
  }
}

// ── picked messages (action 'ask'): their pictures, as Arvy can look at them ──
const b64 = (bytes: Uint8Array) => { let out = ''; for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(out); };
const LOOK_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
/** The pictures in these messages, oldest first, six at most (the newest are kept): a photo out of the household's
 *  folder; for a video, or a photo that can't be fetched, the small still saved with the message. */
async function looksOf(svc: Svc, owner: string, msgs: ChatMsg[]): Promise<{ media_type: string; data: string }[]> {
  const out: { media_type: string; data: string }[] = [];
  for (const x of msgs.flatMap(m => m.media || []).slice(-6)) {
    const still = x.thumb?.startsWith('data:image/jpeg;base64,') ? { media_type: 'image/jpeg', data: x.thumb.split(',')[1] } : null;
    const type = LOOK_TYPES[x.path.split('.').pop() || ''];
    try {
      if (x.kind !== 'image' || !type || !x.path.startsWith(`${owner}/`) || x.path.includes('..')) throw new Error('not a photo of theirs');
      const { data: file, error } = await svc.storage.from(BUCKET).download(x.path);
      if (error || !file) throw new Error(error?.message || 'no file');
      const bytes = new Uint8Array(await (file as Blob).arrayBuffer());
      if (bytes.length > 3_600_000) throw new Error('too big to look at');   // Claude takes 5 MB a picture, as text
      out.push({ media_type: type, data: b64(bytes) });
    } catch { if (still) out.push(still); }
  }
  return out;
}
const sentWhen = (at: string) => { const d = new Date(at); return isNaN(d.getTime()) ? 'some time ago' : new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d); };

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let action = '?';
  try {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    action = String(b.action || '?');
    if (!b.token) return json({ error: 'signed_out' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
    const { data: me, error } = await anon.rpc('planner_me', { p_token: b.token });
    const uid = (me as { ok?: boolean; user?: { id?: string } } | null)?.user?.id;
    if (error || !(me as { ok?: boolean })?.ok || !uid) return json({ error: 'signed_out' }, 401);
    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: self } = await svc.from('planner_users').select('id, username, display_name, settings, household_id').eq('id', uid).single();
    const user = self as Person;
    const owner = user.household_id || user.id;   // the household: where its shared documents and its media folder live
    const { data: all } = await svc.from('planner_users').select('id, username, display_name, settings, household_id').or(`id.eq.${owner},household_id.eq.${owner}`);
    const members = ((all || []) as Person[]).filter(p => (p.household_id || p.id) === owner);

    if (action === 'upload') {
      const files = (Array.isArray(b.files) ? b.files : []).slice(0, MAX_MEDIA) as { type?: unknown; size?: unknown }[];
      const out: { kind: string; path: string; token: string }[] = [];
      for (const f of files) {
        const t = MEDIA_TYPES[String(f?.type || '')];
        const size = Number(f?.size) || 0;
        if (!t) return json({ error: 'That kind of file can’t be sent here: photos (JPEG, PNG) and videos (MP4, MOV, WebM) only.' }, 400);
        if (size > (t.kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) return json({ error: t.kind === 'video' ? 'That video is too big (50 MB at most). A shorter clip will go through.' : 'That photo is too big.' }, 400);
        const path = `${owner}/${new Date().toISOString().slice(0, 7)}/${rand(12)}.${t.ext}`;
        const { data: s, error: e } = await svc.storage.from(BUCKET).createSignedUploadUrl(path);
        if (e || !s?.token) throw new Error(e?.message || 'Could not make room for the file');
        out.push({ kind: t.kind, path, token: s.token });
      }
      return json({ files: out });
    }

    if (action === 'media') {
      const paths = (Array.isArray(b.paths) ? b.paths : []).filter((p): p is string => typeof p === 'string' && p.startsWith(`${owner}/`) && !p.includes('..')).slice(0, 40);
      if (!paths.length) return json({ urls: {} });
      const { data: signed, error: e } = await svc.storage.from(BUCKET).createSignedUrls(paths, 3600);
      if (e) throw new Error(e.message);
      return json({ urls: Object.fromEntries(((signed || []) as { path: string | null; signedUrl: string | null }[]).filter(s => s.path && s.signedUrl).map(s => [s.path, s.signedUrl])) });
    }

    if (action === 'say') {
      const clean = cleanMessage(b, owner);
      if (!clean) return json({ error: 'Nothing to send' }, 400);
      const at = new Date().toISOString(), id = rand(6), key = `${at}~${id}`;
      const looks = (Array.isArray(b.looks) ? b.looks : []).filter((l): l is { media_type: string; data: string } => !!l && typeof l === 'object'
        && ['image/jpeg', 'image/png', 'image/webp'].includes((l as { media_type?: string }).media_type || '') && typeof (l as { data?: unknown }).data === 'string' && (l as { data: string }).data.length <= 1_400_000).slice(0, 6);
      // a reply: the original is looked up in this household's chat, and the quote is taken from it (chat.ts replyFrom)
      let reply = clean.reply;
      if (reply) {
        const { data: orig, error: oe } = await svc.from('planner_docs').select('data').eq('user_id', owner).eq('kind', CHAT_KIND).eq('key', reply.key).maybeSingle();
        reply = replyFrom(reply, oe ? undefined : ((orig?.data as ChatMsg | undefined) || null));
      }
      // messages picked out for Arvy with it: every one has to be in this household's chat (as for action 'ask')
      const picked = b.turn === true ? cleanPicked(b.picked) : [];
      if (!picked) return json({ error: `${MAX_ASK} messages at a time at most.` }, 400);
      if (picked.length) {
        const { data: docs, error: de } = await svc.from('planner_docs').select('key, data').eq('user_id', owner).eq('kind', CHAT_KIND).in('key', picked);
        if (de) throw new Error(de.message);
        if (!pickedFrom(picked, (docs || []) as { key: string; data: ChatMsg | null }[])) return json({ error: 'One of those messages isn’t in your chat any more.' }, 404);
      }
      // what it sets off (chat.ts readingOf). For Arvy, from an app that can answer it: that phone runs Arvy and
      // posts the answer, and it is not read along here too. Otherwise words (not just emoji) or something to look
      // at is worth a read; a reply can be shorter and still mean something ("2")
      const how = readingOf({ text: clean.text, reply: !!reply, looks: looks.length, turn: b.turn === true, picked: picked.length });
      const reads = how === 'read';
      const msg: ChatMsg = { id, at, by: user.username, name: first(user), ...(clean.text ? { text: clean.text } : {}), ...(clean.media.length ? { media: clean.media } : {}), ...(reply ? { reply } : {}), ...(reads ? { arvy: { state: 'reading' } } : {}),
        ...(how === 'asked' ? { ask: { state: 'working', at, ...(picked.length ? { keys: picked } : {}) } } : {}) };
      const { error: e } = await svc.from('planner_docs').insert({ user_id: owner, kind: CHAT_KIND, key, data: msg });
      if (e) throw new Error(e.message);
      const after = (async () => {
        await Promise.all(members.filter(m => m.id !== user.id).map(m => push(svc, m, { title: msg.name, body: pushLine(msg), tag: 'chat' })));
        if (reads) await readAndPropose(svc, owner, members, key, msg, looks);
      })().catch(err => console.error('planner-chat after say:', err instanceof Error ? err.message : String(err)));
      // the message is saved: the phone gets its answer now, the telling and the reading carry on behind it
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(after); else await after;
      return json({ ok: true, key, msg });
    }

    if (action === 'answer') {
      const key = String(b.key || '');
      if (!isKey(key)) return json({ error: 'Which message?' }, 400);
      const who = members.map(m => ({ username: m.username, name: first(m) }));
      for (let attempt = 0; attempt < 3; attempt++) {
        // the asking message is looked for in this household's chat and nowhere else
        const { data: cur, error: ce } = await svc.from('planner_docs').select('data, updated_at').eq('user_id', owner).eq('kind', CHAT_KIND).eq('key', key).maybeSingle();
        if (ce) throw new Error(ce.message);
        const at = new Date().toISOString();
        const next = arvyAnswer({ asking: (cur?.data as ChatMsg | undefined) || null, key, raw: b, user, members: who, today: nowParts().today, at, id: () => rand(6) });
        if ('error' in next) return json({ error: next.error }, next.status);
        // marked answered first, and only if nobody changed that message meanwhile: of two posts at once, one wins
        const { data: done } = await svc.from('planner_docs').update({ data: next.asking, updated_at: at }).eq('user_id', owner).eq('kind', CHAT_KIND).eq('key', key).eq('updated_at', cur!.updated_at).select('key');
        if (!done?.length) continue;
        const { error: ie } = await svc.from('planner_docs').insert({ user_id: owner, kind: CHAT_KIND, key: next.key, data: next.msg });
        if (ie) {   // the answer wasn't kept: the asking message says so, and they can ask again
          const ask = next.asking.ask!;
          await svc.from('planner_docs').update({ data: { ...next.asking, ask: { state: 'failed', at: ask.at, ...(ask.keys?.length ? { keys: ask.keys } : {}) } }, updated_at: new Date().toISOString() }).eq('user_id', owner).eq('kind', CHAT_KIND).eq('key', key);
          throw new Error(ie.message);
        }
        // the one who asked is looking at it; the other one hears that Arvy wrote
        const tell = Promise.all(members.filter(m => m.id !== user.id).map(m => push(svc, m, { title: ARVY_NAME, body: pushLine({ text: next.msg.text }), tag: 'chat' })))
          .catch(err => console.error('planner-chat after answer:', err instanceof Error ? err.message : String(err)));
        if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(tell); else await tell;
        return json({ ok: true, key: next.key, msg: next.msg, asked: { key, msg: next.asking } });
      }
      return json({ error: 'Busy. Try again.' }, 409);
    }

    if (action === 'asked') {
      const key = String(b.key || '');
      if (!isKey(key)) return json({ error: 'Which message?' }, 400);
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: cur, error: ce } = await svc.from('planner_docs').select('data, updated_at').eq('user_id', owner).eq('kind', CHAT_KIND).eq('key', key).maybeSingle();
        if (ce) throw new Error(ce.message);
        const at = new Date().toISOString();
        const next = askedNext((cur?.data as ChatMsg | undefined) || null, user.username, b.state, at);
        if ('error' in next) return json({ error: next.error }, next.status);
        if (!next.changed) return json({ ok: true, msg: next.msg });
        const { data: done } = await svc.from('planner_docs').update({ data: next.msg, updated_at: at }).eq('user_id', owner).eq('kind', CHAT_KIND).eq('key', key).eq('updated_at', cur!.updated_at).select('key');
        if (done?.length) return json({ ok: true, msg: next.msg });
      }
      return json({ error: 'Busy. Try again.' }, 409);
    }

    if (action === 'ask') {
      const ask = cleanAsk(b, members);
      if (typeof ask === 'string') return json({ error: ask }, 400);
      // every key has to be a message in this household's chat: they are read from there and nowhere else
      const { data: docs, error: de } = await svc.from('planner_docs').select('key, data').eq('user_id', owner).eq('kind', CHAT_KIND).in('key', ask.keys);
      if (de) throw new Error(de.message);
      const picked = pickedFrom(ask.keys, (docs || []) as { key: string; data: ChatMsg | null }[]);
      if (!picked) return json({ error: 'One of those messages isn’t in your chat any more.' }, 404);
      const who = members.map(m => ({ username: m.username, name: first(m) }));
      const looks = await looksOf(svc, owner, picked.map(p => p.msg));
      const t = nowParts();
      const out = await claudeRead(askSystem({ ...t, members: who, asker: first(user) }), [
        { type: 'text', text: askText(picked.map(p => ({ msg: p.msg, when: sentWhen(p.msg.at) })), askWords(ask, who), first(user), looks.length) },
        ...looks.map(l => ({ type: 'image', source: { type: 'base64', media_type: l.media_type, data: l.data } })),
      ], 'What to propose for their shopping list, calendar and to-do lists from the picked messages, as asked. Leave everything out when there is nothing to propose, and say why in note.');
      const { proposals, note } = proposalsFrom(onlyAsked(out, ask), { today: t.today, members: who, id: () => rand(6) });
      // hung on the last one picked, beside what is already there; only if nobody changed that message meanwhile
      const last = picked[picked.length - 1].key;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: cur } = await svc.from('planner_docs').select('data, updated_at').eq('user_id', owner).eq('kind', CHAT_KIND).eq('key', last).maybeSingle();
        if (!cur?.data) return json({ error: 'That message is gone' }, 404);
        const next = addProposals(cur.data as ChatMsg, proposals, note);
        const { data: done } = await svc.from('planner_docs').update({ data: next.msg, updated_at: new Date().toISOString() }).eq('user_id', owner).eq('kind', CHAT_KIND).eq('key', last).eq('updated_at', cur.updated_at).select('key');
        if (!done?.length) continue;
        // the one who asked is looking at it; the other one hears about what they can confirm (a to-do: only the person it's for)
        const tell = (async () => {
          for (const p of next.added) await Promise.all(members.filter(m => m.id !== user.id && (!p.for || p.for === m.username)).map(m => push(svc, m, { title: 'Arvy', body: `${p.lines.join(' ')}? Tap to confirm.`, tag: `arvy-${p.id}` })));
        })().catch(err => console.error('planner-chat after ask:', err instanceof Error ? err.message : String(err)));
        if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(tell); else await tell;
        return json({ ok: true, key: last, msg: next.msg, added: next.added.length, ...(next.note ? { note: next.note } : {}) });
      }
      return json({ error: 'Busy. Try again.' }, 409);
    }

    if (action === 'resolve') {
      const key = String(b.key || ''), id = String(b.id || '');
      const state = b.state === 'done' || b.state === 'dismissed' || b.state === 'waiting' ? b.state : null;
      if (!key || !id || !state) return json({ error: 'Which one?' }, 400);
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: cur } = await svc.from('planner_docs').select('data, updated_at').eq('user_id', owner).eq('kind', CHAT_KIND).eq('key', key).maybeSingle();
        if (!cur?.data) return json({ error: 'That message is gone' }, 404);
        const next = resolveProposal(cur.data as ChatMsg, id, state, user.username, new Date().toISOString());
        if (!next) return json({ ok: false, msg: cur.data });   // already answered, or not theirs to confirm
        // only if nobody changed the message in the meantime (the other phone confirming at the same moment)
        const { data: done } = await svc.from('planner_docs').update({ data: next, updated_at: new Date().toISOString() }).eq('user_id', owner).eq('kind', CHAT_KIND).eq('key', key).eq('updated_at', cur.updated_at).select('key');
        if (done?.length) return json({ ok: true, msg: next });
      }
      return json({ error: 'Busy. Try again.' }, 409);
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('planner-chat:', action, e instanceof Error ? e.message : String(e));
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});
