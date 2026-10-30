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
//   POST { token, action: 'sway', items: [string] }               → { tags: { [item]: 'go'|'ease'|'neutral' } }  (the girl-sway food guide)
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

/** Ask for a structured answer through a forced tool call: the API guarantees the JSON matches the schema. */
async function claudeJson<T>(system: string, messages: Msg[], schema: Record<string, unknown>, maxTokens = 4000): Promise<T> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(WORKSPACE ? { 'anthropic-workspace-id': WORKSPACE } : {}) },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages,
      tools: [{ name: 'answer', description: 'The structured answer.', input_schema: schema }], tool_choice: { type: 'tool', name: 'answer' } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic ${res.status}`);
  if (data.stop_reason === 'max_tokens') throw new Error('The answer was too long; try a shorter statement (fewer pages).');
  const use = (data.content || []).find((c: { type: string }) => c.type === 'tool_use');
  if (!use) throw new Error('No structured answer');
  return use.input as T;
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

const STATEMENT_SYSTEM = `You turn the text of one page of a Canadian bank or credit-card statement (TD and similar) into transactions.
Rules: one row per transaction line, in statement order. amount is NEGATIVE for money out (withdrawals, purchases,
fees, transfers out) and POSITIVE for money in (deposits, payments received, refunds). "balance" is the running
balance when the statement prints one on that line, else omit it. Dates often lack a year (e.g. "AUG04"): take the
year from the statement period. Skip headings, STARTING/OPENING/CLOSING BALANCE, totals, fee summaries, addresses,
and any line that is not a transaction. Keep desc as printed, trimmed, without the amount. Masked numbers (####)
stay as they are. If a line's columns are ambiguous, use the running balance to decide the sign. If the page has no
transactions, return an empty rows list. Columns matter: on TD deposit-account statements the order is
Description, Withdrawals, Deposits, Date, Balance — an amount in the left money column is a withdrawal, one in the
right money column is a deposit; the text keeps the column spacing, so use it.`;
const STATEMENT_SCHEMA = {
  type: 'object', properties: {
    account_type: { type: 'string', enum: ['chequing', 'savings', 'credit', 'unknown'] },
    opening_balance: { type: 'number', description: 'the STARTING / OPENING / PREVIOUS balance printed on this page, if any' },
    period: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    rows: { type: 'array', items: { type: 'object', properties: {
      date: { type: 'string', description: 'YYYY-MM-DD' }, desc: { type: 'string' }, amount: { type: 'number' }, balance: { type: 'number' } },
      required: ['date', 'desc', 'amount'] } },
  }, required: ['rows'],
};
type StatementPage = { account_type?: string; opening_balance?: number; period?: { from?: string; to?: string }; rows: { date: string; desc: string; amount: number; balance?: number }[] };

const SWAY_SYSTEM = `You sort foods for the popular "girl sway" diet (a preference guide, not medical advice).
GO (low sodium/potassium, higher calcium/magnesium): chicken (no skin), tofu, cheese, Greek yogurt, white bread, basmati/white/jasmine rice,
white pasta, cauliflower, cabbage, romaine, iceberg lettuce, cucumbers, eggplant, zucchini, green beans, low-fat cream cheese, low-sodium
tortillas, Mrs. Dash, unsalted butter, starfruit, dragon fruit, pears, strawberries, apples, blueberries, water, Crystal Light, black coffee.
EASE OFF (sodium- or potassium-rich): tuna, beef, salmon, whole eggs, ham, bacon, turkey, deli meat, sausage, peanut butter, avocado, spinach,
kale, collards, broccoli, asparagus, tomatoes, bell peppers, potatoes, sweet potatoes, carrots, peas, beets, salt, garlic, olive oil, garlic/onion
powder, turmeric, chili powder, Italian seasoning, black pepper, hummus, pecans, chips, pretzels, chocolate, wheat pasta, chia, buckwheat,
brown rice, millet, raisins, jerky, olives, bananas, watermelon, oranges, grapes, mangoes, cherries, pineapple, banana peppers, dairy/oat/
coconut milk, soda, candy, ice cream, sports drinks, lemonade, lemon/lime water.
Rule for anything else: clearly sodium- or potassium-rich → "ease"; calcium/magnesium-rich and low-sodium → "go"; unsure or mixed → "neutral".
Return one tag per item, keyed by the item text exactly as given.`;
const SWAY_SCHEMA = { type: 'object', properties: { tags: { type: 'object', additionalProperties: { type: 'string', enum: ['go', 'ease', 'neutral'] } } }, required: ['tags'] };

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
      let hint = typeof b.hint === 'string' ? b.hint : '';
      // page by page: short answers that never run past the output limit
      const pages = text.split(/\n-{3,} page -{3,}\n/).map(p => p.trim()).filter(Boolean);
      const rows: StatementPage['rows'] = [];
      let period: StatementPage['period'] | undefined, accountType: string | undefined, opening: number | undefined;
      for (const [i, page] of pages.entries()) {
        const r = await claudeJson<StatementPage>(STATEMENT_SYSTEM, [{ role: 'user', content: `${hint ? `Hint: ${hint}\n\n` : ''}Page ${i + 1} of ${pages.length}:\n${page}` }], STATEMENT_SCHEMA, 8192);
        rows.push(...(r.rows || []));
        if (!period && r.period?.from) { period = r.period; hint = `${hint}; statement period ${r.period.from} to ${r.period.to}`.replace(/^; /, ''); }
        if (!accountType && r.account_type && r.account_type !== 'unknown') accountType = r.account_type;
        if (opening === undefined && typeof r.opening_balance === 'number') opening = r.opening_balance;
      }
      return json({ rows, period, account_type: accountType, opening_balance: opening, pages: pages.length });
    }
    if (action === 'sway') {
      const items = (Array.isArray(b.items) ? b.items : []).filter(i => typeof i === 'string' && i.trim()).slice(0, 60) as string[];
      if (!items.length) return json({ tags: {} });
      const r = await claudeJson<{ tags: Record<string, string> }>(SWAY_SYSTEM, [{ role: 'user', content: `Items:\n${items.join('\n')}` }], SWAY_SCHEMA, 1500);
      const tags: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.tags || {})) if (v === 'go' || v === 'ease' || v === 'neutral') tags[k] = v;
      return json({ tags });
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
