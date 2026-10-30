// supabase/functions/planner-ai/index.ts — the planner's AI: food photos → items and calories, the
// workout coach, bank-transaction categories, and short reflections on a day. Separate from Benny.
//
//   POST { token, action: 'food_photo', image: { media_type, data(base64) }, note? }
//        → { items: [{ name, portion, grams?, kcal, protein, carbs, fat, confidence }], tips?: string }
//   POST { token, action: 'food_text', text }                     → same shape
//   POST { token, action: 'coach', messages: [{ role, content }], context }   → { reply }
//   POST { token, action: 'categorize', merchants: [string], categories: [string] }
//        → { categories: { [merchant]: category } }
//   POST { token, action: 'reflect', context }                     → { reply }  (2–3 sentences on the day)
//   POST { token, action: 'statement', text, hint? }               → { rows: [{ date, desc, amount, balance? }], period?, account_type? }
//        (text of a bank-statement PDF, account numbers already masked by the browser)
//
// The planner token (planner_sign_in) is checked with planner_me through the anon client; nothing runs
// without it. Deployed without JWT verification because planner users have no Supabase account.
// Model: PLANNER_MODEL secret, else a Haiku-class model (cheap: ~1¢ a call).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const MODEL = Deno.env.get('PLANNER_MODEL') || 'claude-haiku-5-5';
const WORKSPACE = Deno.env.get('ANTHROPIC_WORKSPACE_ID') || '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Msg = { role: 'user' | 'assistant'; content: unknown };

async function claude(system: string, messages: Msg[], maxTokens = 1500): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(WORKSPACE ? { 'anthropic-workspace-id': WORKSPACE } : {}) },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic ${res.status}`);
  return (data.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
}

function parseJson(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) throw new Error('No JSON in reply');
  return JSON.parse(m[0]);
}

const FOOD_SYSTEM = `You estimate the nutrition of a meal for a personal food log. Reply with JSON only:
{"items":[{"name":"","portion":"","grams":0,"kcal":0,"protein":0,"carbs":0,"fat":0,"confidence":"high|medium|low"}],"tips":""}
Rules: one item per distinct food; portion in plain words ("1 cup", "2 rotis", "palm-sized"); grams your best estimate;
macros in grams; kcal consistent with macros. Count cooking oil, butter, dressings and sauces as their own items
when they are likely present even if not visible (and say so in "tips"). Photo estimates run low, so lean a little
generous on portions. Keep "tips" to one short sentence or empty. No text outside the JSON.`;

const COACH_SYSTEM = `You are a strength and conditioning coach inside a personal planner app. The user is an adult
training for general strength, muscle and health. Be concise (phone screen): short paragraphs, specific numbers,
no fluff. Use the training history and settings in the context to answer: suggest the next session, explain a
plateau, adjust for soreness or time, write a weekly plan. Weights in the user's units. If something sounds like
an injury, say to see a professional and keep the advice conservative. Never mention being an AI model.`;

const REFLECT_SYSTEM = `You are a warm, direct high-performance coach reviewing one day of a personal planner (morning
intentions, priorities, habits, evening answers, scores). Reply in 2–3 short sentences, second person: one thing
to appreciate, one honest observation, one small adjustment for tomorrow. No lists, no headings, no emojis.`;

const STATEMENT_SYSTEM = `You turn the text of a Canadian bank or credit-card statement (TD and similar) into transactions.
Reply with JSON only: {"account_type":"chequing|savings|credit","period":{"from":"YYYY-MM-DD","to":"YYYY-MM-DD"},
"rows":[{"date":"YYYY-MM-DD","desc":"","amount":0,"balance":0}]}
Rules: one row per transaction line, in statement order. amount is NEGATIVE for money out (withdrawals, purchases,
fees, transfers out) and POSITIVE for money in (deposits, payments received, refunds). "balance" is the running
balance when the statement prints one on that line, else omit it. Dates often lack a year (e.g. "AUG04"): take the
year from the statement period. Skip headings, STARTING/OPENING/CLOSING BALANCE, totals, fee summaries, addresses,
and any line that is not a transaction. Keep desc as printed, trimmed, without the amount. Masked numbers (####)
stay as they are. If a line's columns are ambiguous, use the running balance to decide the sign. No text outside the JSON.`;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const token = typeof b.token === 'string' ? b.token : '';
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
    const { data: me, error } = await anon.rpc('planner_me', { p_token: token });
    if (error || !me?.ok) return json({ error: 'signed_out' }, 401);

    const action = b.action;
    if (action === 'food_photo') {
      const img = b.image as { media_type: string; data: string } | undefined;
      if (!img?.data) return json({ error: 'No image' }, 400);
      const note = typeof b.note === 'string' && b.note.trim() ? `\nThe user adds: ${b.note.trim()}` : '';
      const text = await claude(FOOD_SYSTEM, [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.data } },
        { type: 'text', text: `Estimate this meal.${note}` },
      ] }]);
      return json(parseJson(text));
    }
    if (action === 'food_text') {
      const text = typeof b.text === 'string' ? b.text.trim() : '';
      if (!text) return json({ error: 'No text' }, 400);
      const out = await claude(FOOD_SYSTEM, [{ role: 'user', content: `Estimate this meal from the description: ${text}` }]);
      return json(parseJson(out));
    }
    if (action === 'coach') {
      const messages = (Array.isArray(b.messages) ? b.messages : []).slice(-20) as Msg[];
      if (!messages.length) return json({ error: 'No messages' }, 400);
      const ctx = b.context ? `\n\nContext (JSON):\n${JSON.stringify(b.context).slice(0, 20000)}` : '';
      const reply = await claude(COACH_SYSTEM + ctx, messages, 1200);
      return json({ reply });
    }
    if (action === 'reflect') {
      const reply = await claude(REFLECT_SYSTEM, [{ role: 'user', content: `Today (JSON):\n${JSON.stringify(b.context ?? {}).slice(0, 12000)}` }], 400);
      return json({ reply });
    }
    if (action === 'statement') {
      const text = typeof b.text === 'string' ? b.text.slice(0, 60000) : '';
      if (!text.trim()) return json({ error: 'No text' }, 400);
      const hint = typeof b.hint === 'string' ? b.hint : '';
      const out = await claude(STATEMENT_SYSTEM, [{ role: 'user', content: `${hint ? `Hint: ${hint}\n\n` : ''}Statement text:\n${text}` }], 8192);
      return json(parseJson(out));
    }
    if (action === 'categorize') {
      const merchants = (Array.isArray(b.merchants) ? b.merchants : []).filter(m => typeof m === 'string').slice(0, 200) as string[];
      const categories = (Array.isArray(b.categories) ? b.categories : []).filter(c => typeof c === 'string') as string[];
      if (!merchants.length || !categories.length) return json({ categories: {} });
      const out = await claude(
        `You sort Canadian bank-statement merchant descriptions into spending categories. Reply with JSON only: {"categories":{"<merchant exactly as given>":"<one of the categories>"}}. Use "Other" only when nothing fits.`,
        [{ role: 'user', content: `Categories: ${categories.join(', ')}\n\nMerchants:\n${merchants.join('\n')}` }], 4000);
      return json(parseJson(out));
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
