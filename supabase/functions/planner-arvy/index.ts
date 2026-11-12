// supabase/functions/planner-arvy/index.ts — Arvy, the planner's assistant (said "AR-vee").
//
//   POST { token, action: 'turn', messages: [Claude messages], context: ArvyCtx }
//        → { content: [text | tool_use blocks], stop_reason, web?: { searches, sources, found }, raw? }
//        One step of the conversation. When Claude wants a tool, the app runs it (the planner's data and the code that
//        reads it live in the app), sends the results back as the next turn, and so on until there's an answer.
//        A question can come with pictures (a screenshot of an appointment): image blocks in what they sent, read by
//        Claude and kept nowhere. Arvy is then told how to read one, and the app holds every change for Confirm.
//        The web is the one tool that runs here (Anthropic searches, inside the same call): `web` says what was
//        searched, which pages the answer cites and which the search found, and `raw` is the step as Claude wrote it, for the app to send back
//        when the question isn't finished (tools.ts webOut).
//        context.chat = true: the question was written in the chat between the two of them, and the answer will be
//        posted there for both to read (the app does that: src/planner/features/us). Arvy is then told so, is not
//        handed the notes it keeps about the person, and is not offered what that chat never has (tools.ts
//        CHAT_NEVER: email, the cycle tracker, those notes). The answer comes back with chat: true, so the app knows
//        it was answered that way.
//   POST { token, action: 'speak', text } → { audio }   MP3, base64: Arvy's voice (a woman's for Rosh, a man's for Vijay)
//   POST { token, action: 'dayplan', context, units, library: [exercise names], answers? } → { review, questions, tomorrow }
//        After a workout: a review of it, two questions, and tomorrow's session in Arvy's exercise shape (tools.ts EXERCISE).
//   POST { token, action: 'classes', clubs?: [club keys], from: 'YYYY-MM-DD' } → { clubs: [{ key, name, classes | problem }] }
//        The class timetable of their GoodLife clubs for seven days from `from` (gym.ts): the gym_classes tool runs in
//        the app like every tool, and the app asks here because a browser can't read GoodLife's site itself.
//   POST { token, action: 'places', query, near?, open_now? } → { places: [{ name, address, phone, … }] } | { problem, broken }
//        Up to four places from Google Maps for what was asked (places.ts): the find_place tool runs in the app like
//        every tool, and the app asks here because the Google key is a secret only this function has
//        (GOOGLE_PLACES_API_KEY; Places API (New), Text Search). No key, or Google not answering: `problem` says so,
//        and Arvy tells them it couldn't reach Google Maps.
//        Each person has an allowance of look-ups for the month, so Google never bills (places.ts): the count is
//        their own planner doc (kind 'placeuse', key = the month), read and written here with their token before
//        Google is asked. Used up: `problem` says so with `broken` false, and Google isn't asked. A count that can't
//        be read or written: Google isn't asked either.
//
// The planner token (planner_sign_in) is checked with planner_me; nothing runs without it. Deployed without JWT
// verification because planner users have no Supabase account. Whose voice and which tools come from the account
// (planner_me), not from what the app says.
// Arvy is the coach too: once a conversation has pulled the coaching context it gets the coaching rules, a longer
// answer and the COACH_MODEL secret's model if set. Model otherwise: ARVY_MODEL secret, else a Sonnet-class model. Claude key: ANTHROPIC_API_KEY. Voice: GOOGLE_TTS_KEY
// (else GOOGLE_API_KEY), voices ARVY_VOICE_MORNING / ARVY_VOICE_NIGHT.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { gymClassesFrom, gymClubsFor, gymFeedUrl, type GymClass, type GymClubClasses } from './gym.ts';
import { placesLookUp, placesMemory, type PlacesDocs } from './places.ts';
import { canWeb, cleanMessages, contextText, DAYPLAN_SCHEMA, dayplanSystem, hasPictures, isCoaching, speakable, system, toolsFor, voiceFor, webOut, webRaw, WEB_SEARCH, type ArvyCtx, type Profile } from './tools.ts';

const MODEL = Deno.env.get('ARVY_MODEL') || 'claude-sonnet-5-5';
const FALLBACK = 'claude-sonnet-5-5';
// coaching answers (the conversation has pulled the coaching context): the coach's model if one is set, and room for a session plan
const COACH_MODEL = Deno.env.get('COACH_MODEL') || MODEL;
const WORKSPACE = Deno.env.get('ANTHROPIC_WORKSPACE_ID') || '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

interface Me { id: string; username: string; display_name: string; settings?: Record<string, unknown> }
const profileOf = (me: Me): Profile => (me.settings?.profile === 'morning' || (!me.settings?.profile && me.username === 'rosh') ? 'morning' : 'night');

/** Anthropic refused a request over the web search: the question is answered without it. `off` = the account has web
 *  search switched off (an admin setting), rather than something being wrong with this one request. */
class WebOff extends Error { constructor(msg: string, readonly off: boolean) { super(msg); } }
let webOff = false;   // found switched off once: not offered again until this function restarts

/** `web` = the web search tool is in `tools`: searching and reading take longer, and a long search can come back
 *  paused (stop_reason pause_turn), which is carried on here until there's an answer or a tool for the app.
 *  `pictures` = the question came with pictures: reading them takes longer, and a page of appointments is several events. */
async function claude(sys: string, messages: unknown[], tools: unknown[], coaching = false, web = false, pictures = false): Promise<{ content: unknown[]; stop_reason: string }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  let model = coaching ? COACH_MODEL : MODEL;
  const said: unknown[] = [];   // what Claude has written so far in this step (more than one call when a search pauses)
  for (let part = 0; ; part++) {
    let res: Response | null = null; let data: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(WORKSPACE ? { 'anthropic-workspace-id': WORKSPACE } : {}) },
        body: JSON.stringify({ model, max_tokens: coaching ? 3000 : pictures ? 2400 : web ? 1800 : 1200, system: sys, messages: said.length ? [...messages, { role: 'assistant', content: said }] : messages, tools }),
        signal: AbortSignal.timeout(coaching || web || pictures ? 110000 : 60000),
      });
      data = await res.json().catch(() => ({}));
      if (res.ok) break;
      const msg = String((data as { error?: { message?: string } }).error?.message || '');
      if (web && res.status === 400 && /web[ _]?search|server_tool_use|encrypted/i.test(msg)) throw new WebOff(msg, /not enabled|disabled|not available|not supported|not allowed/i.test(msg));
      if (res.status === 404 || /model/i.test(msg) && res.status === 400) { if (model !== FALLBACK) { model = FALLBACK; continue; } }
      if (!(res.status === 429 || res.status === 529 || res.status >= 500)) break;
      await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
    }
    if (!res || !res.ok) throw new Error((data as { error?: { message?: string } }).error?.message || `Anthropic ${res?.status}`);
    const d = data as { content?: unknown[]; stop_reason?: string };
    said.push(...(Array.isArray(d.content) ? d.content : []));
    if (d.stop_reason !== 'pause_turn' || part >= 3) return { content: said, stop_reason: d.stop_reason === 'pause_turn' ? 'end_turn' : d.stop_reason || 'end_turn' };
  }
}

/** A structured answer through a tool call named `answer`. Best is forcing the call (the API then makes it match the
 *  schema) with thinking off, as a forced call can't be combined with thinking. Some models can't switch thinking off
 *  or can't be forced at all: those are asked to call the tool instead (tool_choice auto) and given room to think.
 *  What worked is remembered per model. An answer that isn't a tool call is asked again from the fallback model. */
const forcedMode = new Map<string, number>();   // model → 0 forced, thinking off · 1 forced · 2 asked to call it
async function claudeForced<T>(sys: string, user: string, schema: unknown, maxTokens: number): Promise<T> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  type Out = { stop_reason?: string; content?: { type: string; input?: unknown }[]; error?: { message?: string } };
  const answerOf = (d: Out) => (d.stop_reason === 'max_tokens' ? undefined : (d.content || []).find(c => c.type === 'tool_use'));
  let model = COACH_MODEL; let res: Response | null = null; let data: Out = {}; let waits = 0;
  for (let attempt = 0; attempt < 9; attempt++) {
    const mode = forcedMode.get(model) ?? 0;
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(WORKSPACE ? { 'anthropic-workspace-id': WORKSPACE } : {}) },
      body: JSON.stringify({ model, max_tokens: mode === 2 ? maxTokens + 3000 : maxTokens,
        system: mode === 2 ? `${sys}\n\nGive your answer only by calling the "answer" tool, once, with the complete answer. Write nothing else.` : sys,
        messages: [{ role: 'user', content: user }], ...(mode === 0 ? { thinking: { type: 'disabled' } } : {}),
        tools: [{ name: 'answer', description: 'The structured answer.', input_schema: schema }], tool_choice: mode === 2 ? { type: 'auto' } : { type: 'tool', name: 'answer' } }),
      signal: AbortSignal.timeout(110000),
    });
    data = await res.json().catch(() => ({})) as Out;
    if (res.ok) {
      if (answerOf(data) || model === FALLBACK) break;
      console.error(`planner-arvy: ${model} gave no structured answer (${data.stop_reason}), asking ${FALLBACK}`);
      model = FALLBACK; continue;
    }
    const msg = String(data.error?.message || '');
    if (res.status === 400 && mode < 2 && /thinking|tool_choice/i.test(msg)) {
      console.error(`planner-arvy: ${model}, forced answer mode ${mode}: ${msg}`);
      forcedMode.set(model, /tool_choice/i.test(msg) ? 2 : mode + 1); continue;
    }
    if ((res.status === 404 || res.status === 400 && /model/i.test(msg)) && model !== FALLBACK) { console.error(`planner-arvy: ${model} unavailable (${msg || res.status}), using ${FALLBACK}`); model = FALLBACK; continue; }
    if (!(res.status === 429 || res.status === 529 || res.status >= 500) || ++waits > 3) break;
    await new Promise(r => setTimeout(r, 1200 * waits));
  }
  if (!res || !res.ok) throw new Error(data.error?.message || `Anthropic ${res?.status}`);
  if (data.stop_reason === 'max_tokens') throw new Error('That plan ran too long. Try again.');
  const use = answerOf(data);
  if (!use || !use.input || typeof use.input !== 'object') throw new Error('Arvy didn’t answer. Try again.');
  return use.input as T;
}

async function voice(text: string, profile: Profile): Promise<Response> {
  const line = speakable(text).slice(0, 700);
  if (!line) return json({ error: 'Nothing to say' }, 400);
  const key = Deno.env.get('GOOGLE_TTS_KEY') || Deno.env.get('GOOGLE_API_KEY') || Deno.env.get('GOOGLE_PLACES_API_KEY');
  if (!key) return json({ error: 'The Google voice key isn’t set (GOOGLE_TTS_KEY).', code: 'no_key' }, 503);
  const lang = 'en-US';
  const name = voiceFor(profile, { morning: Deno.env.get('ARVY_VOICE_MORNING') || undefined, night: Deno.env.get('ARVY_VOICE_NIGHT') || undefined });
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: { text: line }, voice: { languageCode: lang, name: `${lang}-Chirp3-HD-${name}` }, audioConfig: { audioEncoding: 'MP3' } }),
    signal: AbortSignal.timeout(20000),
  });
  const out = await res.json().catch(() => ({})) as { audioContent?: string; error?: { message?: string } };
  if (!res.ok || !out.audioContent) {
    const why = out.error?.message || `Google ${res.status}`;
    console.error('planner-arvy voice:', res.status, why);
    return json({ error: `The voice didn’t answer: ${why}`.slice(0, 300), code: 'google' }, 502);
  }
  return json({ audio: out.audioContent });
}

/** Their clubs' class timetables, read from GoodLife (gym.ts). Each club answers for itself: its classes, or what went
 *  wrong. Kept a few minutes, so a conversation about classes asks GoodLife once, not on every question. */
const gymKept = new Map<string, { at: number; classes: GymClass[] }>();
const GYM_KEEP_MS = 3 * 60 * 1000;
async function gymClasses(q: { clubs?: unknown; from?: unknown }): Promise<Response> {
  const from = typeof q.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : '';
  if (!from) return json({ error: 'Which day?' }, 400);
  const clubs = await Promise.all(gymClubsFor(q.clubs).map(async (club): Promise<GymClubClasses> => {
    const key = `${club.id}|${from}`, kept = gymKept.get(key);
    if (kept && Date.now() - kept.at < GYM_KEEP_MS) return { key: club.key, name: club.name, classes: kept.classes };
    try {
      const res = await fetch(gymFeedUrl(club.id, from), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
      // no content = a day GoodLife has no timetable for (it publishes today to about two weeks ahead)
      if (res.status === 204) return { key: club.key, name: club.name, problem: 'GoodLife has no timetable out for those days: it shows today to about two weeks ahead.' };
      const classes = res.ok ? gymClassesFrom(await res.json().catch(() => null)) : null;
      if (!classes) {
        console.error(`planner-arvy classes: club ${club.id} from ${from}: ${res.ok ? 'not the timetable we know' : `HTTP ${res.status}`}`);
        return { key: club.key, name: club.name, broken: true, problem: res.ok ? 'GoodLife’s timetable has changed and couldn’t be read.' : `GoodLife’s timetable didn’t answer (${res.status}).` };
      }
      if (gymKept.size > 60) gymKept.clear();
      gymKept.set(key, { at: Date.now(), classes });
      return { key: club.key, name: club.name, classes };
    } catch (e) {
      console.error(`planner-arvy classes: club ${club.id} from ${from}:`, e instanceof Error ? e.message : String(e));
      return { key: club.key, name: club.name, broken: true, problem: 'GoodLife’s timetable didn’t answer in time.' };
    }
  }));
  return json({ clubs });
}

/** Places from Google Maps for what was asked. The look-up itself is places.ts placesLookUp (the keep of a few
 *  minutes, the ten-minute limit, the month's allowance, the asking, what is logged): here it is handed the real
 *  key, network, clock and log, and `docs`, the person's own planner docs, where their count for the month is. */
const placesMem = placesMemory();   // what is remembered between look-ups, for as long as this copy of the function runs
async function findPlaces(q: unknown, username: string, docs: PlacesDocs): Promise<Response> {
  const r = await placesLookUp(q, {
    key: Deno.env.get('GOOGLE_PLACES_API_KEY') || undefined, username, docs,
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10000) }),
    now: () => Date.now(), log: line => console.error(line),
  }, placesMem);
  return json(r.body, r.status);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let action = '?';
  try {
    const b = await req.json().catch(() => ({})) as { token?: string; action?: string; messages?: unknown; context?: ArvyCtx; text?: string };
    action = String(b.action || '?');
    if (!b.token) return json({ error: 'signed_out' }, 401);
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
    const { data: me, error } = await anon.rpc('planner_me', { p_token: b.token });
    const user = (me as { ok?: boolean; user?: Me } | null)?.user;
    if (error || !(me as { ok?: boolean })?.ok || !user) return json({ error: 'signed_out' }, 401);
    const profile = profileOf(user);

    if (b.action === 'speak') return await voice(String(b.text || ''), profile);
    if (b.action === 'dayplan') {
      const d = b as unknown as { context?: unknown; units?: string; library?: unknown; answers?: unknown };
      const units = d.units === 'kg' ? 'kg' : 'lb';
      const names = (Array.isArray(d.library) ? d.library : []).map(x => String((x as { name?: unknown })?.name ?? x).slice(0, 60)).filter(Boolean).slice(0, 220);
      const answers = d.answers && typeof d.answers === 'object' ? d.answers : null;
      const r = await claudeForced<Record<string, unknown>>(dayplanSystem(),
        `Units: ${units}\n\nExercise names they already have (use these exactly when one fits):\n${names.join('; ')}\n\n${answers ? `My answers to your questions: ${JSON.stringify(answers).slice(0, 1500)}\n\n` : ''}Planner (JSON):\n${contextText(d.context ?? {}, 40000)}`,
        DAYPLAN_SCHEMA, 5000);
      // a tomorrow that isn't a session with exercises is dropped (the model has answered with a string once)
      const t = r.tomorrow as { exercises?: unknown } | string | null | undefined;
      if (!t || typeof t !== 'object' || !Array.isArray(t.exercises) || !t.exercises.length) r.tomorrow = null;
      if (!Array.isArray(r.questions)) r.questions = [];
      return json(r);
    }
    if (b.action === 'classes') return await gymClasses(b as unknown as { clubs?: unknown; from?: unknown });
    if (b.action === 'places') {
      // the month's count is their own planner doc, read and written as the app would: with their own token, through
      // planner_get and planner_put. Their token never goes in the log.
      const token = b.token;
      const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
        const { data, error } = await anon.rpc(fn, { p_token: token, ...args });
        if (error) throw new Error(`${fn} ${error.code || ''} ${String(error.message || '').split(token).join('(the token)')}`.replace(/\s+/g, ' ').trim());
        return data;
      };
      return await findPlaces(b, user.username, {
        get: (kind, key) => rpc('planner_get', { p_kind: kind, p_from: key, p_to: key }),
        put: (kind, key, data) => rpc('planner_put', { p_kind: kind, p_key: key, p_data: data }),
      });
    }
    if (b.action !== 'turn') return json({ error: 'Unknown action' }, 400);

    const c = b.context || {};
    const chat = c.chat === true;   // asked in the chat between the two of them: both read the answer (tools.ts CHAT)
    const ctx: ArvyCtx = {
      name: (user.display_name || user.username).split(/\s+/)[0], username: user.username, profile,
      today: /^\d{4}-\d{2}-\d{2}$/.test(String(c.today)) ? c.today : undefined, weekday: String(c.weekday || '').slice(0, 12),
      now: String(c.now || '').slice(0, 12), path: String(c.path || '/').slice(0, 60), spoken: !!c.spoken, units: c.units === 'kg' ? 'kg' : 'lb',
      about: !chat && Array.isArray(c.about) ? c.about.slice(-25).map(n => String(n).replace(/\s+/g, ' ').slice(0, 300)).filter(Boolean) : undefined,   // never in the shared chat, whatever the app sent
      chat,
      v: Math.max(1, Math.min(99, Math.floor(Number(c.v)) || 1)),   // an app from before the number was sent only has the first tools
    };
    // the web, for an app that can show the sources and holds changes for Confirm after a search (tools.ts WEB_SEARCH)
    let web = canWeb(ctx.v) && !webOff;
    let messages = cleanMessages(b.messages, profile, web, chat);
    if (!messages) return json({ error: 'Nothing to answer' }, 400);
    const coaching = isCoaching(messages);
    const pictures = hasPictures(messages);
    let out: { content: unknown[]; stop_reason: string };
    try {
      out = await claude(system(ctx, coaching, web, pictures), messages, web ? [...toolsFor(profile, ctx.v, chat), WEB_SEARCH] : toolsFor(profile, ctx.v, chat), coaching, web, pictures);
    } catch (e) {
      if (!(e instanceof WebOff)) throw e;
      console.error(`planner-arvy: answering without the web (${e.off ? 'switched off for this Anthropic account' : 'this request was refused'}):`, e.message);
      if (e.off) webOff = true;
      web = false;
      messages = cleanMessages(b.messages, profile, false, chat) || messages;
      out = await claude(system(ctx, coaching, false, pictures), messages, toolsFor(profile, ctx.v, chat), coaching, false, pictures);
    }
    const mode = chat ? { chat: true } : {};   // said back, so the app knows the chat's rules were in force
    if (!web) return json({ ...out, ...mode });
    const shown = webOut(out.content);
    if (!shown.searched) return json({ content: shown.content, stop_reason: out.stop_reason, ...mode });
    return json({ content: shown.content, stop_reason: out.stop_reason, web: { searches: shown.searches, sources: shown.sources, found: shown.found },
      ...(out.stop_reason === 'tool_use' ? { raw: webRaw(out.content) } : {}), ...mode });
  } catch (e) {
    console.error('planner-arvy:', action, e instanceof Error ? e.message : String(e));
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});
