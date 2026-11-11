// supabase/functions/benny-assist/index.ts — The Benny, the in-app assistant.
//
//   POST { messages: [{ role, content }], context: { center_id, center_name, today, path, screen, rm_manager, following, user_name, spoken, diag } }
//     → { reply, map?, proposal? }
//   map      = { maps, highlight, pins, title } for the chat's map card
//   proposal = a change for the person to confirm on a card: start_day | give_route | partner | solo | booking | booking_emails | pin | stops.
//              The Benny never makes the change itself: the app does, with the same code as its screens, after the person taps
//              Confirm. booking_emails changes nothing at all: its card opens the Send booking emails screen, where the person sends.
//
// Who: super admins (everything), route managers (their own team on the live map: carts, routes, connected routes),
// floaters on the floater map (the teams of the managers they follow there).
// Runs as the signed-in person: their JWT is passed through, so every lookup (benny_* database functions) is checked by
// the database against their permissions and the centers they can see. The Benny has no database access of its own.
// Bug reports, and requests it couldn't do (no tool for it), are saved in the app's own log (benny_bugs, shown in
// Super Admin › Bug log): no GitHub issue, no email.
// Model: BENNY_MODEL secret, else a Sonnet-class model. The Claude key lives only in ANTHROPIC_API_KEY.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { TOOLS, openMap, system, toolCall, toolsFor, type Ctx, type ProposalKind, type Role, type Vocab } from './tools.ts';

const MODEL = Deno.env.get('BENNY_MODEL') || 'claude-sonnet-5-5';
const WORKSPACE = Deno.env.get('ANTHROPIC_WORKSPACE_ID') || '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Msg = { role: 'user' | 'assistant'; content: unknown };
type Proposal = { kind: ProposalKind; check: Record<string, unknown>; team_mode?: string };

/** A bug, or a request the Benny couldn't do, goes into the app's own log (Super Admin › Bug log), with what the page knew. */
async function logEntry(sb: SupabaseClient, ctx: Ctx, kind: 'bug' | 'request', input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const report = { ...input, user: ctx.user_name || null, center: ctx.center_name || null, path: ctx.path || null, screen: ctx.screen || null,
    rm_manager: ctx.rm_manager || null, spoken: !!ctx.spoken, diag: kind === 'bug' ? ctx.diag || null : null, at: new Date().toISOString() };
  const { data: id, error } = await sb.rpc('benny_log_save', { p_center: ctx.center_id || null, p_path: ctx.path || null, p_kind: kind, p_title: String(input.title || ''), p_report: report });
  if (error) return { error: error.message };
  return { saved: true, id, where: 'the Bug log in Super Admin' };
}

/** The change cards every build of the app can show. Newer kinds are sent only to an app that says it can show them (context.cards). */
const FIRST_CARDS = ['start_day', 'give_route', 'partner', 'solo'];

/** The Benny said it couldn't, without logging it: caught here so no request goes unseen. */
const CANT = /\b(can['’]?t|cannot|not able to|unable to|don['’]t have (a|the) (tool|way)|no (tool|way) (to|for)|isn['’]t (something i can|switched on|available)|not (yet )?(supported|possible|available))\b/i;
const OFF_TOPIC = /only help with the DMS/i;

async function runTool(sb: SupabaseClient, ctx: Ctx, role: Role, name: string, input: Record<string, unknown>): Promise<{ out: unknown; proposal?: Proposal }> {
  if (!TOOLS.some(t => t.name === name && t.roles.includes(role))) return { out: { error: `${name} isn't available to you` } };
  const call = toolCall(name, input, ctx);
  if (!call) return { out: { error: `unknown tool ${name}` } };
  if ('log' in call) return { out: await logEntry(sb, ctx, call.log, input) };
  const { data, error } = await sb.rpc(call.fn, call.args);
  if (error) return { out: { error: error.message } };
  // a change that checks out becomes a card for the person to confirm
  if (call.card && data && (data as { ok?: boolean }).ok === true) {
    return { out: { ...(data as object), card: 'shown: the person confirms it there' }, proposal: { ...call.card, check: data as Record<string, unknown> } };
  }
  return { out: data };
}

async function claude(sys: string, messages: Msg[], tools: unknown[]): Promise<{ content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[]; stop_reason: string }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  let res: Response | null = null; let data: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(WORKSPACE ? { 'anthropic-workspace-id': WORKSPACE } : {}) },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: sys, messages, tools }),
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

    const b = await req.json().catch(() => ({})) as { messages?: Msg[]; context?: Ctx };
    const ctx: Ctx = b.context || {};
    const { data: role, error: roleErr } = await sb.rpc('benny_ok_any', { p_center: ctx.center_id || null });
    if (roleErr || (role !== 'admin' && role !== 'rm')) return json({ error: 'The Benny is for super admins and route managers.' }, 403);
    // a route manager's "my team" is their own map; only admins can open someone else's.
    // The floater map is the floater's own: the database checks it (their id, the permission, the managers followed).
    if (role === 'rm' && ctx.rm_manager && !/^floater_/.test(ctx.rm_manager)) {
      const { data: mine } = await sb.rpc('benny_my_rm_ids', { p_center: ctx.center_id || null });
      if (Array.isArray(mine) && !mine.includes(ctx.rm_manager)) ctx.rm_manager = mine[0];
    }

    const history = (Array.isArray(b.messages) ? b.messages : []).slice(-16)
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) })) as Msg[];
    while (history.length && history[0].role !== 'user') history.shift();
    if (!history.length || history[history.length - 1].role !== 'user') return json({ error: 'No question' }, 400);

    // a spoken message: the real names it may have been trying to say (the phone's speech-to-text doesn't know them)
    let vocab: Vocab | null = null;
    if (ctx.spoken) {
      const { data } = await sb.rpc('benny_vocab', { p_center: ctx.center_id || null, p_date: /^\d{4}-\d{2}-\d{2}$/.test(ctx.today || '') ? ctx.today : null, p_manager: openMap(ctx) });
      vocab = (data as Vocab) || null;
    }
    const sys = system(ctx, role as Role, vocab);
    const tools = toolsFor(role as Role);
    const msgs: Msg[] = [...history];
    let map: unknown = null; let mapTitle = ''; let proposal: Proposal | null = null;
    let usedTools = 0; let logged = false;
    // a change that is about routes always comes with its map, even when the Benny didn't draw one
    const mapOf = (p: Proposal | null): unknown => {
      if (!p) return null;
      if (p.kind === 'start_day') {
        const assign = (p.check.assign || []) as { routes?: { code: string }[] }[];
        return { maps: p.check.maps || [], highlight: assign.flatMap(a => (a.routes || []).map(r => r.code)), pins: [], title: 'The plan’s routes' };
      }
      if (p.kind === 'give_route' && p.check.map) return { maps: [p.check.map], highlight: [p.check.route], pins: [], title: String(p.check.route) };
      // a booking moving to another route: the route, with the house on it
      if (p.kind === 'booking' && p.check.map && p.check.route) return { maps: [p.check.map], highlight: [p.check.route], pins: p.check.pin ? [p.check.pin] : [], title: `${String((p.check.pin as { label?: string } | undefined)?.label || 'Booking')} → ${String(p.check.route)}` };
      // a pin: where it would go. An order: its stops, numbered, from where the manager is
      if (p.kind === 'pin' && p.check.pin && p.check.map) return { maps: [p.check.map], highlight: p.check.route ? [p.check.route] : [], pins: [p.check.pin], title: String(p.check.label || 'Pin') };
      if (p.kind === 'stops' && Array.isArray(p.check.maps) && p.check.maps.length) {
        const stops = (p.check.stops || []) as { lat: number; lng: number; label: string; route?: string; n: number }[];
        return { maps: p.check.maps, highlight: p.check.routes || [], pins: stops.map(s => ({ lat: s.lat, lng: s.lng, label: s.label, route: s.route || null, n: s.n })), start: p.check.start || null,
          title: `${String(p.check.kind).charAt(0).toUpperCase()}${String(p.check.kind).slice(1)} order` };
      }
      // booking emails: the routes whose customers would be written to
      if (p.kind === 'booking_emails') return { maps: p.check.maps || [], highlight: ((p.check.routes || []) as { code: string }[]).map(r => r.code), pins: [], title: 'Routes to email' };
      return null;
    };
    const shows = new Set<string>([...FIRST_CARDS, ...(Array.isArray(ctx.cards) ? ctx.cards.map(String) : [])]);
    const done = (reply: string) => {
      // a tab opened before this kind of card existed can't draw it: say so, rather than send a card it would choke on
      if (proposal && !shows.has(proposal.kind)) return json({ reply: 'I can do that, but this screen is on an older version of the app. Refresh the page, then ask me again.', map: null, proposal: null });
      return json({ reply, map: map ? { ...(map as object), title: mapTitle } : mapOf(proposal), proposal });
    };
    for (let round = 0; round < 8; round++) {
      const r = await claude(sys, msgs, tools);
      const uses = r.content.filter(c => c.type === 'tool_use');
      if (!uses.length || r.stop_reason !== 'tool_use') {
        const reply = r.content.filter(c => c.type === 'text').map(c => c.text || '').join('').trim();
        // it said it couldn't, straight off, and logged nothing: log it for it
        if (!logged && usedTools === 0 && !proposal && CANT.test(reply) && !OFF_TOPIC.test(reply)) {
          const asked = String(history[history.length - 1].content);
          await logEntry(sb, ctx, 'request', { title: asked.slice(0, 120), asked, reply: reply.slice(0, 600), auto: true });
        }
        return done(reply || 'Sorry, I didn’t get an answer for that. Try asking another way.');
      }
      msgs.push({ role: 'assistant', content: r.content });
      const results = [];
      usedTools += uses.length;
      for (const u of uses) {
        if (u.name === 'log_request' || u.name === 'report_bug') logged = true;
        const { out, proposal: p } = await runTool(sb, ctx, role as Role, u.name || '', u.input || {});
        if (p) proposal = p;
        if (u.name === 'show_map' && out && !(out as { error?: string }).error) { map = out; mapTitle = String(u.input?.title || ''); }
        // a map's pins can be many: Claude only needs the counts
        const forClaude = u.name === 'show_map' && out && (out as { pins?: unknown[] }).pins
          ? { maps: (out as { maps: unknown }).maps, highlighted_routes: (out as { highlight: unknown[] }).highlight, pins: (out as { pins: unknown[] }).pins.length, shown: true }
          : out;
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(forClaude).slice(0, 30000) });
      }
      msgs.push({ role: 'user', content: results });
    }
    return done('That took too many steps. Try asking a narrower question.');
  } catch (e) {
    console.error('benny-assist:', e instanceof Error ? e.message : String(e));
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
