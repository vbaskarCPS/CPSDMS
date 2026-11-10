// supabase/functions/benny-assist/index.ts — The Benny, the in-app assistant (step 1: questions and maps).
//
//   POST { messages: [{ role, content }], context: { center_id, center_name, today, path, screen } }
//     → { reply, map? }   map = { maps, highlight, pins } for the chat's map card
//
// Runs as the signed-in person: their JWT is passed through, so every lookup (benny_* database functions) is
// checked by the database against their permissions (super admins only for now) and the centers they can see.
// The Benny has no database access of its own and cannot change anything in this step.
// Model: BENNY_MODEL secret, else a Sonnet-class model. The Claude key lives only in ANTHROPIC_API_KEY.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const MODEL = Deno.env.get('BENNY_MODEL') || 'claude-sonnet-5-5';
const WORKSPACE = Deno.env.get('ANTHROPIC_WORKSPACE_ID') || '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Msg = { role: 'user' | 'assistant'; content: unknown };
interface Ctx { center_id?: string; center_name?: string; today?: string; path?: string; screen?: string }

const TOOLS = [
  { name: 'find_people', description: 'Find workers (by name, CN like I1225, or phone digits) and office staff. Returns phone, email, CN, year, status (active, WDR, quit…), center, shuttle.',
    input_schema: { type: 'object', properties: { q: { type: 'string', description: 'name, part of a name, CN or phone digits' } }, required: ['q'] } },
  { name: 'day', description: 'A workerbook day for the current center: state (planned, live, closed), the roster (who is booked, attendance, next-day answers), the session (each manager with their maps, routes and teams/carts), routes with workers on the live map, prebooks loaded, and the close-out summary.',
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] } },
  { name: 'bookings', description: 'Master Bookings (prebooks) for the current center: total, counts by map, by route and by status, and the first 30 bookings. Filter by a map name, city or street, and/or one route.',
    input_schema: { type: 'object', properties: { where: { type: 'string', description: 'map name, city or street, e.g. "Surrey", "NORTH VANCOUVER #2"' }, route: { type: 'string' }, status: { type: 'string', enum: ['open', 'done', 'cancelled', 'any'], description: 'default open' } } } },
  { name: 'maps', description: "Master maps in the center's region matching a name or city: route range, number of routes, houses built, past clients.",
    input_schema: { type: 'object', properties: { q: { type: 'string', description: 'map name or city; empty = all' } } } },
  { name: 'route', description: 'One route: its map, streets, houses, past clients (by service), open prebooks, and who has it on a date.',
    input_schema: { type: 'object', properties: { route: { type: 'string', description: 'route code, e.g. PCQ64' }, date: { type: 'string', description: 'YYYY-MM-DD, optional' } }, required: ['route'] } },
  { name: 'show_map', description: 'Show a map in the chat: the named master maps (or every map in a city) outlined, the given routes highlighted and the rest grey, and optionally every open prebook in those maps as a pin with its route highlighted. Use whenever the answer is about where things are.',
    input_schema: { type: 'object', properties: { maps: { type: 'array', items: { type: 'string' }, description: 'map names or a city, e.g. ["Surrey"] or ["NORTH VANCOUVER #1","NORTH VANCOUVER #2"]' },
      routes: { type: 'array', items: { type: 'string' }, description: 'route codes to highlight' }, prebooks: { type: 'boolean', description: 'pin the open prebooks and highlight their routes' },
      title: { type: 'string', description: 'a short title for the map, e.g. "Open prebooks in Surrey"' } } } },
];

function system(ctx: Ctx): string {
  return `You are The Benny, the assistant inside the Property Stars DMS app (lawn and property services: aeration, lawn rejuv, sealing).
You help a super admin with the app's own data: workers and staff, workerbook days, Master Bookings (prebooks), master maps and routes, past clients.
Today is ${ctx.today || 'unknown'}. The person is working in the center "${ctx.center_name || 'unknown'}"${ctx.screen ? ` on the ${ctx.screen} screen` : ''}.

Rules:
- Answer from the tools, never from memory or guesses. If the tools can't answer it, say so and name the screen that can.
- Only the app's data and work. Anything else: "I can only help with the DMS."
- You cannot change anything yet (starting days, moving routes, booking are coming soon). If asked to, say it's not switched on yet and which screen does it.
- Be short and specific: the answer first, with the numbers; a list only when it helps; no more than about 8 lines. Phone numbers as written.
- Words people use: "prebooks" = open Master Bookings; "the map"/"master map" = an area like NORTH VANCOUVER #2; a route is a code like PCQ64 (prefix + number; "route 35" means 35 on the map in question). "North Van" = North Vancouver, "PoCo" = Port Coquitlam. WDR = withdrawn.
- When the answer is about where things are (prebooks in a city, a route, which routes touch), call show_map too, then answer in words.
- Never reveal passwords, card numbers or ID numbers; the tools don't return them.`;
}

async function runTool(sb: SupabaseClient, ctx: Ctx, name: string, input: Record<string, unknown>): Promise<unknown> {
  const c = ctx.center_id;
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) return { error: error.message };
    return data;
  };
  switch (name) {
    case 'find_people': return call('benny_find_people', { p_center: c, p_q: String(input.q || '') });
    case 'day': return call('benny_day', { p_center: c, p_date: String(input.date || ctx.today) });
    case 'bookings': return call('benny_bookings', { p_center: c, p_where: input.where ?? null, p_route: input.route ?? null, p_status: input.status ?? 'open' });
    case 'maps': return call('benny_maps', { p_center: c, p_q: input.q ?? null });
    case 'route': return call('benny_route', { p_center: c, p_route: String(input.route || ''), p_date: input.date ?? null });
    case 'show_map': return call('benny_map', { p_center: c, p_maps: input.maps ?? [], p_routes: input.routes ?? null, p_prebooks: !!input.prebooks });
    default: return { error: `unknown tool ${name}` };
  }
}

async function claude(sys: string, messages: Msg[]): Promise<{ content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[]; stop_reason: string }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  let res: Response | null = null; let data: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(WORKSPACE ? { 'anthropic-workspace-id': WORKSPACE } : {}) },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: sys, messages, tools: TOOLS }),
    });
    data = await res.json().catch(() => ({}));
    if (res.ok || !(res.status === 429 || res.status === 529 || res.status >= 500)) break;
    await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
  }
  if (!res || !res.ok) throw new Error((data as { error?: { message?: string } }).error?.message || `Anthropic ${res?.status}`);
  return data as never;
}

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
    const { data: isAdmin } = await sb.rpc('app_is_super_admin');
    if (!isAdmin) return json({ error: 'The Benny is for super admins for now.' }, 403);

    const b = await req.json().catch(() => ({})) as { messages?: Msg[]; context?: Ctx };
    const ctx: Ctx = b.context || {};
    const history = (Array.isArray(b.messages) ? b.messages : []).slice(-16)
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) })) as Msg[];
    if (!history.length || history[history.length - 1].role !== 'user') return json({ error: 'No question' }, 400);

    const sys = system(ctx);
    const msgs: Msg[] = [...history];
    let map: unknown = null; let mapTitle = '';
    for (let round = 0; round < 6; round++) {
      const r = await claude(sys, msgs);
      const uses = r.content.filter(c => c.type === 'tool_use');
      if (!uses.length || r.stop_reason !== 'tool_use') {
        const reply = r.content.filter(c => c.type === 'text').map(c => c.text || '').join('').trim();
        return json({ reply: reply || 'Sorry, I didn’t get an answer for that. Try asking another way.', map: map ? { ...(map as object), title: mapTitle } : null });
      }
      msgs.push({ role: 'assistant', content: r.content });
      const results = [];
      for (const u of uses) {
        const out = await runTool(sb, ctx, u.name || '', u.input || {});
        if (u.name === 'show_map' && out && !(out as { error?: string }).error) { map = out; mapTitle = String(u.input?.title || ''); }
        // a map's pins can be many: Claude only needs the counts
        const forClaude = u.name === 'show_map' && out && (out as { pins?: unknown[] }).pins
          ? { maps: (out as { maps: unknown }).maps, highlighted_routes: (out as { highlight: unknown[] }).highlight, pins: (out as { pins: unknown[] }).pins.length, shown: true }
          : out;
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(forClaude).slice(0, 30000) });
      }
      msgs.push({ role: 'user', content: results });
    }
    return json({ reply: 'That took too many steps. Try asking a narrower question.', map });
  } catch (e) {
    console.error('benny-assist:', e instanceof Error ? e.message : String(e));
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
