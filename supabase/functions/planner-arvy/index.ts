// supabase/functions/planner-arvy/index.ts — Arvy, the planner's assistant (said "AR-vee").
//
//   POST { token, action: 'turn', messages: [Claude messages], context: ArvyCtx }
//        → { content: [text | tool_use blocks], stop_reason }
//        One step of the conversation. When Claude wants a tool, the app runs it (the planner's data and the code that
//        reads it live in the app), sends the results back as the next turn, and so on until there's an answer.
//   POST { token, action: 'speak', text } → { audio }   MP3, base64: Arvy's voice (a woman's for Rosh, a man's for Vijay)
//
// The planner token (planner_sign_in) is checked with planner_me; nothing runs without it. Deployed without JWT
// verification because planner users have no Supabase account. Whose voice and which tools come from the account
// (planner_me), not from what the app says.
// Arvy is the coach too: once a conversation has pulled the coaching context it gets the coaching rules, a longer
// answer and the COACH_MODEL secret's model if set. Model otherwise: ARVY_MODEL secret, else a Sonnet-class model. Claude key: ANTHROPIC_API_KEY. Voice: GOOGLE_TTS_KEY
// (else GOOGLE_API_KEY), voices ARVY_VOICE_MORNING / ARVY_VOICE_NIGHT.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { cleanMessages, isCoaching, speakable, system, toolsFor, voiceFor, type ArvyCtx, type Profile } from './tools.ts';

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

async function claude(sys: string, messages: unknown[], tools: unknown[], coaching = false): Promise<{ content: unknown[]; stop_reason: string }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  let model = coaching ? COACH_MODEL : MODEL; let res: Response | null = null; let data: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(WORKSPACE ? { 'anthropic-workspace-id': WORKSPACE } : {}) },
      body: JSON.stringify({ model, max_tokens: coaching ? 3000 : 1200, system: sys, messages, tools }),
      signal: AbortSignal.timeout(coaching ? 110000 : 60000),
    });
    data = await res.json().catch(() => ({}));
    if (res.ok) break;
    const msg = String((data as { error?: { message?: string } }).error?.message || '');
    if (res.status === 404 || /model/i.test(msg) && res.status === 400) { if (model !== FALLBACK) { model = FALLBACK; continue; } }
    if (!(res.status === 429 || res.status === 529 || res.status >= 500)) break;
    await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
  }
  if (!res || !res.ok) throw new Error((data as { error?: { message?: string } }).error?.message || `Anthropic ${res?.status}`);
  const d = data as { content?: unknown[]; stop_reason?: string };
  return { content: Array.isArray(d.content) ? d.content : [], stop_reason: d.stop_reason || 'end_turn' };
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
    if (b.action !== 'turn') return json({ error: 'Unknown action' }, 400);

    const messages = cleanMessages(b.messages, profile);
    if (!messages) return json({ error: 'Nothing to answer' }, 400);
    const c = b.context || {};
    const ctx: ArvyCtx = {
      name: (user.display_name || user.username).split(/\s+/)[0], username: user.username, profile,
      today: /^\d{4}-\d{2}-\d{2}$/.test(String(c.today)) ? c.today : undefined, weekday: String(c.weekday || '').slice(0, 12),
      now: String(c.now || '').slice(0, 12), path: String(c.path || '/').slice(0, 60), spoken: !!c.spoken, units: c.units === 'kg' ? 'kg' : 'lb',
      about: Array.isArray(c.about) ? c.about.slice(-25).map(n => String(n).replace(/\s+/g, ' ').slice(0, 300)).filter(Boolean) : undefined,
    };
    const coaching = isCoaching(messages);
    const out = await claude(system(ctx, coaching), messages, toolsFor(profile), coaching);
    return json(out);
  } catch (e) {
    console.error('planner-arvy:', action, e instanceof Error ? e.message : String(e));
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});
