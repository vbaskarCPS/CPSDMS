// supabase/functions/benny-voice/index.ts — The Benny's voice: Google Cloud Text-to-Speech (a Chirp 3 HD voice).
//
//   POST { text } → { audio }   audio = MP3, base64
//
// For anyone who can use the Benny (super admins, route managers). The Google key lives only in a secret:
// GOOGLE_TTS_KEY (else GOOGLE_API_KEY, else GOOGLE_PLACES_API_KEY). The voice is BENNY_VOICE, else Charon (a man's voice).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const VOICE = Deno.env.get('BENNY_VOICE') || 'Charon';
const LANG = Deno.env.get('BENNY_VOICE_LANG') || 'en-US';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false }, global: { headers: { Authorization: auth } },
    });
    const { data: me } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    if (!me?.user) return json({ error: 'signed_out' }, 401);
    const { data: role, error: roleErr } = await sb.rpc('benny_ok_any', { p_center: null });
    if (roleErr || (role !== 'admin' && role !== 'rm')) return json({ error: 'Not allowed' }, 403);

    const b = await req.json().catch(() => ({})) as { text?: string };
    const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 700);
    if (!text) return json({ error: 'Nothing to say' }, 400);

    const key = Deno.env.get('GOOGLE_TTS_KEY') || Deno.env.get('GOOGLE_API_KEY') || Deno.env.get('GOOGLE_PLACES_API_KEY');
    if (!key) return json({ error: 'The Google voice key isn’t set (GOOGLE_TTS_KEY).', code: 'no_key' }, 503);

    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text }, voice: { languageCode: LANG, name: `${LANG}-Chirp3-HD-${VOICE}` }, audioConfig: { audioEncoding: 'MP3' } }),
      signal: AbortSignal.timeout(20000),
    });
    const out = await res.json().catch(() => ({})) as { audioContent?: string; error?: { message?: string; status?: string } };
    if (!res.ok || !out.audioContent) {
      const why = out.error?.message || `Google ${res.status}`;
      console.error('benny-voice:', res.status, why);
      return json({ error: `Google’s voice didn’t answer: ${why}`.slice(0, 300), code: 'google' }, 502);
    }
    return json({ audio: out.audioContent, voice: VOICE });
  } catch (e) {
    console.error('benny-voice:', e instanceof Error ? e.message : String(e));
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
