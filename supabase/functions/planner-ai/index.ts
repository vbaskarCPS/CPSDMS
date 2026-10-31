// supabase/functions/planner-ai/index.ts — the planner's AI: food photos → items and calories, the
// workout coach, bank-transaction categories, and short reflections on a day. Separate from Benny.
//
//   POST { token, action: 'food_photo', image: { media_type, data(base64) }, note? }
//        → { items: [{ name, portion, grams?, kcal, protein, carbs, fat, confidence }], tips?: string }
//   POST { token, action: 'food_text', text }                     → same shape
//   POST { token, action: 'coach', messages: [{ role, content }], context }   → { reply }
//   POST { token, action: 'habit', text, blocks: [{id,label,at,until?}], existing: [string] }  → a designed habit (implementation intention + stack)
//   POST { token, action: 'dayplan', context, answers?, library, units }  → { review, questions, tomorrow }  (after a session: review + tomorrow's plan)
//   POST { token, action: 'briefhints', context }   → suggestions for each Bed/Morning Brief question (once there is history)
//   POST { token, action: 'todos', brief, priorities, context }   → { items: [{ text, time?, note? }] }  the day's to-do list from the Brief
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

const COACH_SYSTEM = `You are Coach Claude, the personal coach inside this planner app — strength and conditioning first, but also the
person's whole day: routine, habits, food, sleep, priorities and reviews. The context JSON is the planner's actual data:
every logged set (weight x reps, @RPE, L/R for one-arm moves), the person's own notes per exercise and per session,
earlier reviews and prescriptions, habits and their marks, meals, recent days and the about_me notes. Read it before
answering and quote the real numbers and notes; never say you lack data that is in the context. Be concise (phone
screen): short paragraphs, specific numbers, no fluff. Weights in the user's units. If something sounds like an
injury, say to see a professional and keep the advice conservative. You are Coach Claude; don't describe yourself
as an AI model.`;

const REFLECT_SYSTEM = `You are Coach Claude, a warm, direct high-performance coach reviewing one day of a personal planner (morning
intentions, priorities, habits, evening answers, scores, meals, the workout) with the person's recent days and about_me notes for context. Reply in 2–3 short sentences, second person: one thing
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

const PLAN_SYSTEM = `You turn a coach's written workout plan into a structured session, in the order written.
Each item: name; exerciseId = the id from the library list whose name means the same exercise (omit when none matches);
mode 'time' for warm-up walks, bikes, rowing, stretching, planks and anything given in minutes/seconds (put the length in
seconds), otherwise 'reps'. sets and reps as written ("2 x 8-12" → sets 2, reps "8-12"; "2 x 15" → reps "15"; per-side
counts stay as written). restSec from the text; if not stated: 90 for compound lifts, 60 for isolation/accessory, 0 for
warm-ups. note: the coach's cue for that exercise, under 12 words, or omit. weight only when a number is stated, in the
user's units. A warm-up of "1 light set" of a lift is its own 'reps' item with sets 1 and note "light, ~50%".
name: a short session name. warmup_note: one line if the text has warm-up advice that isn't an exercise.`;
const PLAN_SCHEMA = {
  type: 'object', properties: {
    name: { type: 'string' }, warmup_note: { type: 'string' },
    exercises: { type: 'array', items: { type: 'object', properties: {
      name: { type: 'string' }, exerciseId: { type: 'string' }, mode: { type: 'string', enum: ['reps', 'time'] },
      sets: { type: 'integer' }, reps: { type: 'string' }, seconds: { type: 'integer' }, restSec: { type: 'integer' }, note: { type: 'string' }, weight: { type: 'number' },
    }, required: ['name', 'mode', 'sets', 'restSec'] } },
  }, required: ['name', 'exercises'],
};

const HABIT_SYSTEM = `You are Coach Claude, a habit coach who designs habits the Atomic Habits way for a busy dad with a fixed daily routine.
Given what the person wants to do, their day's blocks (in order, with times) and their existing habits, return ONE habit:
- name: the action, not the outcome, small and concrete ("Read 10 pages", not "read more")
- implementation intention: "I will [action] at [time] in [place]" — pick the time from the block you anchor to
- anchor: the block of the routine to stack it before or after (the most natural, lowest-friction moment), with a stack sentence "After I [the thing the block ends with], I will [action]" (or "Before I …")
- identity: "someone who …" (one line), why: one line on what it gives them in a year, twoMinute: the under-2-minute version
- days: weekday numbers 0-6 (Sunday 0) it's due; default every day
- auto: if the habit is literally one of these planner events, set it so it ticks itself: wake, brief, daycare, fast, dinner, gym, sauna, review, shake, lightsOut; otherwise omit.
Keep every line short. Use the person's own words where they fit.`;
const HABIT_SCHEMA = {
  type: 'object', properties: {
    name: { type: 'string' }, identity: { type: 'string' }, why: { type: 'string' }, twoMinute: { type: 'string' },
    anchor: { type: 'object', properties: { block: { type: 'string' }, when: { type: 'string', enum: ['before', 'after'] } }, required: ['block', 'when'] },
    stack: { type: 'string' }, cue: { type: 'object', properties: { time: { type: 'string' }, place: { type: 'string' } }, required: ['time', 'place'] },
    days: { type: 'array', items: { type: 'integer' } }, auto: { type: 'string' }, coach_note: { type: 'string' },
  }, required: ['name', 'identity', 'why', 'twoMinute', 'anchor', 'stack', 'cue'],
};

const DAYPLAN_SYSTEM = `You are Coach Claude. The person just completed today's workout (it is in the context with every set and note,
along with recent sessions, habits, meals, days and the about_me notes — read the about_me notes first: they hold the
training goals, health limits and session length). Produce:
1. review: one or two short paragraphs (120-200 words total, no lists/headings) reviewing today's session using the real
   numbers and notes, then what tomorrow's session is and why it fits the goals (everyday habit, no overtraining, strength
   a couple of days a week, beginner HIIT for the lungs, mobility, hips/knees). Speak to the person directly.
2. questions: exactly 2 short multiple-choice questions whose answers would change tomorrow's plan (e.g. how the hips/knees
   feel, energy/sleep, time available, what they feel like). 3-4 choices each, a few words per choice. When answers are
   provided in the message, return an empty questions list and fold the answers into the plan.
3. tomorrow: a complete session for tomorrow, 40-70 minutes: name (short, with the focus), focus (strength | hiit |
   mobility | mixed | active-recovery), minutes, why (one line), exercises in order with the same fields as a plan:
   name, exerciseId from the library when one matches, mode 'time' for walks/bike/intervals/holds/flows (seconds), else
   'reps' with sets, reps, restSec, a short note, and a starting weight in the user's units when it applies. Beginner
   HIIT = short work intervals with generous rest (e.g. 20s on / 40s off, 8-10 rounds) on bike/rower/walk-run; mobility =
   hip/knee-friendly flows and holds; never load painful joints. Keep the person's session length.`;
const DAYPLAN_SCHEMA = {
  type: 'object', properties: {
    review: { type: 'string' },
    questions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, choices: { type: 'array', items: { type: 'string' } } }, required: ['id', 'text', 'choices'] } },
    tomorrow: { type: 'object', properties: {
      name: { type: 'string' }, focus: { type: 'string', enum: ['strength', 'hiit', 'mobility', 'mixed', 'active-recovery'] }, minutes: { type: 'integer' }, why: { type: 'string' },
      exercises: { type: 'array', items: { type: 'object', properties: {
        name: { type: 'string' }, exerciseId: { type: 'string' }, mode: { type: 'string', enum: ['reps', 'time'] },
        sets: { type: 'integer' }, reps: { type: 'string' }, seconds: { type: 'integer' }, restSec: { type: 'integer' }, note: { type: 'string' }, weight: { type: 'number' },
      }, required: ['name', 'mode', 'sets', 'restSec'] } },
    }, required: ['name', 'focus', 'minutes', 'why', 'exercises'] },
  }, required: ['review', 'questions', 'tomorrow'],
};

const BRIEFHINTS_SYSTEM = `You are Coach Claude. It is morning; the person is about to do their Bed Brief (from bed, under ten minutes): one
word for the day, three things that must get done, who needs them on their A-game, what might stress them and how their
best self responds, one thing to look forward to. The context is their planner: the about_me notes, recent days (yesterday's
review, scores, priorities done or not, "one change for tomorrow", tomorrow's #1 they wrote last night), habits, workouts
and today's planned session, meals, the routine. Suggest, don't decide: short, specific, in their own language, drawn from
what you actually see (carry over an unfinished priority, echo last night's "tomorrow's #1", flag the stress they named
before, name the session on today). words: 3 single words. priorities: 3 short lines. aGame, stress, stressResponse,
excited: one short line each. noticed: one sentence on a pattern you see in their recent days (or empty if too early).`;
const BRIEFHINTS_SCHEMA = {
  type: 'object', properties: {
    words: { type: 'array', items: { type: 'string' } }, priorities: { type: 'array', items: { type: 'string' } },
    aGame: { type: 'string' }, stress: { type: 'string' }, stressResponse: { type: 'string' }, excited: { type: 'string' }, noticed: { type: 'string' },
  }, required: ['words', 'priorities', 'aGame', 'stress', 'stressResponse', 'excited'],
};

const TODOS_SYSTEM = `You are Coach Claude. The person just finished their Bed Brief from bed; turn it into today's to-do list — the list
they will work through from now until dinner. Rules:
- Start with their three priorities exactly as written (keep the wording), in order. Skip empty ones.
- Then the concrete actions the other answers imply: who needs their A-game (the specific thing to do for that person),
  the stress they named (the one prep step that defuses it), what they look forward to (anything to arrange for it).
- Household/logistics that the day needs: on weekdays "Kiaan → daycare" at the daycare time; on weekends there is no
  daycare unless the person said so — it's a weekend day with Kiaan, so include what that implies, briefly.
- Carry over last night's "tomorrow's #1" if it isn't already a priority, and any unfinished priority from yesterday
  that still looks live. Habits anchored to the work block can be one line each.
- 6–12 items, each a short imperative line in the person's own words. Give a time (HH:MM, 24h) only where the day
  really has a slot for it (drop-off, calls, appointments, the first deep-work block); leave the rest untimed.
- Do not add the workout, shake, review or anything after dinner — those are already in the routine.
- note: at most a few words of why, only when useful.`;
const TODOS_SCHEMA = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, time: { type: 'string' }, note: { type: 'string' }, priority: { type: 'integer', description: '0-2 when the item is one of the three priorities, verbatim' } }, required: ['text'] } } }, required: ['items'] };

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
    if (action === 'plan') {
      const text = typeof b.text === 'string' ? b.text.trim().slice(0, 8000) : '';
      if (!text) return json({ error: 'No plan text' }, 400);
      const library = (Array.isArray(b.library) ? b.library : []).filter(x => x && typeof x.id === 'string' && typeof x.name === 'string').slice(0, 200) as { id: string; name: string }[];
      const units = b.units === 'kg' ? 'kg' : 'lb';
      const r = await claudeJson<{ name: string; exercises: unknown[]; warmup_note?: string }>(PLAN_SYSTEM,
        [{ role: 'user', content: `Units: ${units}\n\nLibrary (id — name):\n${library.map(x => `${x.id} — ${x.name}`).join('\n')}\n\nPlan:\n${text}` }], PLAN_SCHEMA, 4000);
      return json({ name: r.name, exercises: Array.isArray(r.exercises) ? r.exercises : [], warmup_note: r.warmup_note });
    }
    if (action === 'habit') {
      const text = typeof b.text === 'string' ? b.text.trim().slice(0, 2000) : '';
      if (!text) return json({ error: 'Tell me the habit first' }, 400);
      const blocks = (Array.isArray(b.blocks) ? b.blocks : []).slice(0, 20) as { id: string; label: string; at: string; until?: string }[];
      const existing = (Array.isArray(b.existing) ? b.existing : []).slice(0, 30) as string[];
      const r = await claudeJson<Record<string, unknown>>(HABIT_SYSTEM,
        [{ role: 'user', content: `My day (block id — label — time):\n${blocks.map(x => `${x.id} — ${x.label} — ${x.at}${x.until ? `–${x.until}` : ''}`).join('\n')}\n\nHabits I already have: ${existing.join('; ') || 'none'}\n\nWhat I want to do: ${text}` }], HABIT_SCHEMA, 1500);
      return json(r);
    }
    if (action === 'dayplan') {
      const library = (Array.isArray(b.library) ? b.library : []).filter(x => x && typeof x.id === 'string' && typeof x.name === 'string').slice(0, 200) as { id: string; name: string }[];
      const units = b.units === 'kg' ? 'kg' : 'lb';
      const answers = b.answers && typeof b.answers === 'object' ? b.answers as Record<string, string> : null;
      const ctx = JSON.stringify(b.context ?? {}).slice(0, 24000);
      const r = await claudeJson<Record<string, unknown>>(DAYPLAN_SYSTEM,
        [{ role: 'user', content: `Units: ${units}\n\nLibrary (id — name):\n${library.map(x => `${x.id} — ${x.name}`).join('\n')}\n\n${answers ? `My answers to your questions: ${JSON.stringify(answers)}\n\n` : ''}Planner (JSON):\n${ctx}` }], DAYPLAN_SCHEMA, 4000);
      return json(r);
    }
    if (action === 'briefhints') {
      const r = await claudeJson<Record<string, unknown>>(BRIEFHINTS_SYSTEM, [{ role: 'user', content: `Planner (JSON):\n${JSON.stringify(b.context ?? {}).slice(0, 24000)}` }], BRIEFHINTS_SCHEMA, 1200);
      return json(r);
    }
    if (action === 'todos') {
      const brief = b.brief && typeof b.brief === 'object' ? b.brief : {};
      const priorities = (Array.isArray(b.priorities) ? b.priorities : []).filter(x => typeof x === 'string') as string[];
      const r = await claudeJson<{ items: unknown[] }>(TODOS_SYSTEM,
        [{ role: 'user', content: `Brief answers: ${JSON.stringify(brief)}\nPriorities (0-2): ${JSON.stringify(priorities)}\n\nPlanner (JSON):\n${JSON.stringify(b.context ?? {}).slice(0, 20000)}` }], TODOS_SCHEMA, 1500);
      return json({ items: Array.isArray(r.items) ? r.items : [] });
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
