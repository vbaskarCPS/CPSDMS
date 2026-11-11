// supabase/functions/planner-recipes/index.ts — the planner's recipes (kept apart from planner-ai so each stays small).
//
//   POST { token, action: 'recipe', url? | text? | image? }
//        → { name, servings, minutes?, ingredients: [{ qty?, unit?, item, note?, section, pantry }], steps, perServing: { kcal, protein, carbs, fat }, source? }
//        a recipe from a link (fetched here; the page's schema.org Recipe when it has one), pasted text or a photo
//   POST { token, action: 'recipe_idea', protein, note?, avoid? }   → the same shape: a high-protein recipe, ~protein g a serving
//
// The planner token is checked with planner_me through the anon client. Deployed without JWT verification (planner users
// have no Supabase account). Model: PLANNER_MODEL secret, else a Haiku-class model.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const MODEL = Deno.env.get('PLANNER_MODEL') || 'claude-haiku-5-5';
const WORKSPACE = Deno.env.get('ANTHROPIC_WORKSPACE_ID') || '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** A structured answer through a forced tool call (the API guarantees it matches the schema). Busy/rate-limited is retried. */
async function claudeJson<T>(system: string, content: unknown, schema: Record<string, unknown>, maxTokens: number): Promise<T> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  let thinking = true;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(WORKSPACE ? { 'anthropic-workspace-id': WORKSPACE } : {}) },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content }], ...(thinking ? { thinking: { type: 'disabled' } } : {}),
        tools: [{ name: 'answer', description: 'The structured recipe.', input_schema: schema }], tool_choice: { type: 'tool', name: 'answer' } }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 400 && thinking && /thinking/i.test(data?.error?.message || '')) { thinking = false; continue; }
    if (res.status === 429 || res.status === 529 || res.status >= 500) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(data?.error?.message || `Anthropic ${res.status}`);
    if (data.stop_reason === 'max_tokens') throw new Error('That recipe is too long to read in one go — paste just the ingredients and steps.');
    const use = (data.content || []).find((c: { type: string }) => c.type === 'tool_use');
    if (!use) throw new Error('No recipe in the answer — try again');
    return use.input as T;
  }
  throw new Error('Arvy is busy right now — try again in a minute.');
}

const SECTIONS = ['Produce', 'Bakery', 'Deli', 'Meat & Seafood', 'Dairy & Eggs', 'Frozen', 'Pantry', 'Snacks & Drinks', 'Baby', 'Health & Beauty', 'Household & Cleaning', 'Pet', 'Hardware & Auto', 'Other'];
const RECIPE_SYSTEM = `You turn a recipe into structured data for a personal planner whose owner is chasing a daily protein goal.
- name: the dish, short. servings: how many it makes (a whole number; 1 when unclear). minutes: total time if stated or obvious.
- ingredients: one per line as written, in order. qty a number (fractions as decimals; ranges → the middle; omit when there is none,
  e.g. "salt to taste"); unit as written, short ("cup", "tbsp", "g", "lb", "clove"; omit for countable things like "2 eggs");
  item: the thing to buy in plain grocery words ("boneless skinless chicken thighs", not "chicken, cut into pieces"); note: prep
  ("diced", "rinsed") or omit. section: the grocery-store section. pantry: true for basics most kitchens already have — salt,
  pepper, cooking oil, butter, dried spices and herbs, sugar, flour, vinegar, soy sauce, stock cubes, water; false otherwise.
- steps: short imperative steps, in order, without numbers.
- perServing: your best estimate of kcal, protein, carbs and fat for ONE serving, from the ingredients (use the page's nutrition
  facts when given). Be realistic, not generous, on protein.
Ignore ads, stories and comments around the recipe.`;
const RECIPE_SCHEMA = {
  type: 'object', properties: {
    name: { type: 'string' }, servings: { type: 'integer' }, minutes: { type: 'integer' },
    ingredients: { type: 'array', items: { type: 'object', properties: {
      qty: { type: 'number' }, unit: { type: 'string' }, item: { type: 'string' }, note: { type: 'string' },
      section: { type: 'string', enum: SECTIONS }, pantry: { type: 'boolean' } }, required: ['item', 'section', 'pantry'] } },
    steps: { type: 'array', items: { type: 'string' } },
    perServing: { type: 'object', properties: { kcal: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' } }, required: ['kcal', 'protein', 'carbs', 'fat'] },
  }, required: ['name', 'servings', 'ingredients', 'steps', 'perServing'],
};
const IDEA_SYSTEM = `You are Arvy. Invent one realistic, tasty, simple recipe (under 40 minutes, ordinary Canadian grocery-store
ingredients) that hits the protein asked for per serving, for a dad who eats two meals and a couple of shakes a day, all before 2 pm.
Mix it up across chicken, beef, fish, eggs, Greek yogurt, cottage cheese, lentils and tofu, and use South Asian, Caribbean,
Mediterranean or plain grill flavours. Then return it in the structured format: ingredients with real amounts, short steps,
honest per-serving numbers.

` + RECIPE_SYSTEM;

/** Only public web pages: no local or private addresses. */
function publicUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const h = u.hostname.toLowerCase();
    if (!h.includes('.') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/.test(h)) return null;
    return u;
  } catch { return null; }
}
/** A recipe page → the text worth reading: its schema.org Recipe (JSON-LD) when it has one, else the page text. */
async function recipePage(u: URL): Promise<string> {
  const res = await fetch(u.toString(), { headers: { 'user-agent': 'Mozilla/5.0 (compatible; planner-recipes)', accept: 'text/html,application/xhtml+xml' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`That page answered ${res.status} — paste the recipe text instead.`);
  const html = (await res.text()).slice(0, 1_500_000);
  const lds = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const find = (x: unknown): Record<string, unknown> | null => {
    if (!x || typeof x !== 'object') return null;
    if (Array.isArray(x)) { for (const y of x) { const f = find(y); if (f) return f; } return null; }
    const o = x as Record<string, unknown>; const t = o['@type'];
    if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return o;
    return find(o['@graph']) || null;
  };
  for (const s of lds) {
    try {
      const r = find(JSON.parse(s.trim()));
      if (r) return JSON.stringify({ name: r.name, recipeYield: r.recipeYield, totalTime: r.totalTime, recipeIngredient: r.recipeIngredient, recipeInstructions: r.recipeInstructions, nutrition: r.nutrition }).slice(0, 20000);
    } catch { /* next */ }
  }
  return html.replace(/<(script|style|nav|footer|header|aside)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').slice(0, 20000);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let b: Record<string, unknown> = {};
  try {
    b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
    const { data: me, error } = await anon.rpc('planner_me', { p_token: typeof b.token === 'string' ? b.token : '' });
    if (error || !me?.ok) return json({ error: 'signed_out' }, 401);

    if (b.action === 'recipe') {
      const url = typeof b.url === 'string' ? b.url.trim() : '';
      const text = typeof b.text === 'string' ? b.text.trim().slice(0, 20000) : '';
      const img = b.image as { media_type: string; data: string } | undefined;
      let content: unknown; let source: string | undefined;
      if (url) {
        const u = publicUrl(url); if (!u) return json({ error: 'That doesn’t look like a public web link' }, 400);
        source = u.toString();
        content = `Recipe page (${u.hostname}):\n${await recipePage(u)}`;
      } else if (img?.data) {
        content = [{ type: 'image', source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.data } }, { type: 'text', text: `The recipe in this photo.${text ? `\nThe user adds: ${text}` : ''}` }];
      } else if (text) content = `Recipe:\n${text}`;
      else return json({ error: 'Paste a link or the recipe, or add a photo' }, 400);
      const r = await claudeJson<Record<string, unknown>>(RECIPE_SYSTEM, content, RECIPE_SCHEMA, 4000);
      return json({ ...r, source });
    }
    if (b.action === 'recipe_idea') {
      const protein = Math.max(15, Math.min(120, Math.round(Number(b.protein) || 45)));
      const note = typeof b.note === 'string' ? b.note.trim().slice(0, 300) : '';
      const avoid = (Array.isArray(b.avoid) ? b.avoid : []).filter(x => typeof x === 'string').slice(0, 30) as string[];
      const r = await claudeJson<Record<string, unknown>>(IDEA_SYSTEM, `About ${protein} g protein per serving, 2 servings.${note ? `\nWanted: ${note}` : ''}${avoid.length ? `\nAlready in the recipe box (make something different): ${avoid.join('; ')}` : ''}`, RECIPE_SCHEMA, 3000);
      return json(r);
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('planner-recipes:', typeof b?.action === 'string' ? b.action : '?', e instanceof Error ? e.message : String(e));
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
