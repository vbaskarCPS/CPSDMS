// supabase/functions/benny-assist/index.ts — The Benny, the in-app assistant.
//
//   POST { messages: [{ role, content }], context: { center_id, center_name, today, path, screen, rm_manager, following, user_name, spoken, diag } }
//     → { reply, map?, proposal? }
//   map      = { maps, highlight, pins, title } for the chat's map card
//   proposal = a change for the person to confirm on a card: start_day | give_route | partner | solo | booking | booking_emails | pin | stops | job | payouts | bonus | texts.
//              The Benny never makes the change itself: the app does, with the same code as its screens, after the person taps
//              Confirm. booking_emails changes nothing at all: its card opens the Send booking emails screen, where the person sends.
//              payouts changes nothing either: its card opens the payout screen, where the person finalizes each payout.
//              texts sends nothing: its card has a link per worker that opens the phone's Messages, where the person presses send.
//
// Who: super admins (everything), route managers (their own team on the live map: carts, routes, connected routes),
// floaters on the floater map (the teams of the managers they follow there).
// Runs as the signed-in person: their JWT is passed through, so every lookup (benny_* database functions) is checked by
// the database against their permissions and the centers they can see. The Benny has no database access of its own.
// Bug reports, and requests it couldn't do (no tool for it), are saved in the app's own log (benny_bugs, shown in
// Super Admin › Bug log): no GitHub issue, no email.
// Model: BENNY_MODEL secret, else a Sonnet-class model. The Claude key lives only in ANTHROPIC_API_KEY.
// Cost: the tools and the rules (the long, unchanging part of every request) are marked for the model's prompt cache, so
// they are billed in full once and at a fraction on every step and question that follows within a few minutes. What is
// true right now (who, the day, the screen) comes after them and is never kept. One line per question goes to the
// function log with the token counts (no names, no text): "benny-assist usage {…}".
// Two models: in fast_first mode (a setting in the database, benny_model_mode) a small model takes plain lookups first,
// and this server redoes the question on the main model whenever its answer isn't safe to show (the rules are in
// tools.ts, at FAST_TOOLS). BENNY_FAST_MODEL names the small one, else a Haiku-class model.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { FAST_TOOLS, TOOLS, arrayLengths, fastAnswerStop, forModel, needsMain, now, openMap, systemBlocks, toolCall, toolsFor, type Ctx, type ProposalKind, type Role, type Vocab } from './tools.ts';

const MODEL = Deno.env.get('BENNY_MODEL') || 'claude-sonnet-5-5';
const FAST = Deno.env.get('BENNY_FAST_MODEL') || 'claude-haiku-5-5';
const WORKSPACE = Deno.env.get('ANTHROPIC_WORKSPACE_ID') || '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Msg = { role: 'user' | 'assistant'; content: unknown };
type Proposal = { kind: ProposalKind; check: Record<string, unknown>; team_mode?: string };
/** What one call to the model was billed for: input in full, input written to the cache, input read from it, and output. */
type Usage = { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number };
/** One go at a question on one model. stop = why the small model's go may not be shown (the main model then does the question). */
type Run = { reply: string; map: unknown; mapTitle: string; proposal: Proposal | null; usedTools: number; logged: boolean; stop?: { why: string; tokens?: string[] } };

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
    return { out: { ...(forModel(call.card.kind, data) as object), card: 'shown: the person confirms it there' }, proposal: { ...call.card, check: data as Record<string, unknown> } };
  }
  return { out: data };
}

async function claude(model: string, sys: unknown[], messages: Msg[], tools: unknown[]): Promise<{ content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[]; stop_reason: string; usage?: Usage }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  let res: Response | null = null; let data: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(WORKSPACE ? { 'anthropic-workspace-id': WORKSPACE } : {}) },
      body: JSON.stringify({ model, max_tokens: 1500, system: sys, messages, tools }),
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
    const [{ data: role, error: roleErr }, { data: mode }] = await Promise.all([sb.rpc('benny_ok_any', { p_center: ctx.center_id || null }), sb.rpc('benny_model_mode')]);
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
    const sys = systemBlocks(ctx, role as Role, vocab);
    const tools = toolsFor(role as Role);
    const question = String(history[history.length - 1].content);
    // which model: the setting in the database; a super admin's own app can ask for one or the other to try it out
    const asked = role === 'admin' && (ctx.model === 'fast' || ctx.model === 'main') ? ctx.model : null;
    const fastOn = (asked ? asked === 'fast' : mode === 'fast_first') && FAST !== MODEL;
    const tally = () => ({ steps: 0, input: 0, cache_write: 0, cache_read: 0, output: 0 });
    const used = { fast: tally(), main: tally() };
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
    const done = (res: Run, route: Record<string, unknown>) => {
      const reply = res.reply || 'Sorry, I didn’t get an answer for that. Try asking another way.';
      let map = res.map; const proposal = res.proposal;
      // a tab opened before this kind of card existed can't draw it: say so, rather than send a card it would choke on
      // (the same for a start-day card that splits the crew between managers: an older tab would start the day without the crews)
      const old = proposal && (!shows.has(proposal.kind) || (proposal.kind === 'start_day' && (proposal.check as { crews?: boolean })?.crews === true && !shows.has('crews')));
      if (old) return json({ reply: 'I can do that, but this screen is on an older version of the app. Refresh the page, then ask me again.', map: null, proposal: null });
      // a plan's map shows the plan's routes, also when the Benny drew the maps and picked no routes out
      const plan = proposal?.kind === 'start_day' ? mapOf(proposal) as { maps: unknown; highlight: unknown[] } : null;
      if (map && plan?.highlight.length && !((map as { highlight?: unknown[] }).highlight || []).length) map = { ...(map as object), maps: plan.maps, highlight: plan.highlight };
      // a super admin trying the models out is also told which one answered, and why
      return json({ reply, map: map ? { ...(map as object), title: res.mapTitle } : mapOf(proposal), proposal, ...(asked ? { route } : {}) });
    };
    /** One go at the question on one model. The small model's go (fast) stops, with why, the moment its answer wouldn't be safe to show. */
    const run = async (model: string, fast: boolean): Promise<Run> => {
      const msgs: Msg[] = [...history]; const t = fast ? used.fast : used.main;
      const out: Run = { reply: '', map: null, mapTitle: '', proposal: null, usedTools: 0, logged: false };
      const lookups: string[] = []; const lengths: number[] = [];
      for (let round = 0; round < 8; round++) {
        const r = await claude(model, sys, msgs, tools);
        t.steps++; t.input += r.usage?.input_tokens || 0; t.cache_write += r.usage?.cache_creation_input_tokens || 0;
        t.cache_read += r.usage?.cache_read_input_tokens || 0; t.output += r.usage?.output_tokens || 0;
        const uses = r.content.filter(c => c.type === 'tool_use');
        if (!uses.length || r.stop_reason !== 'tool_use') {
          out.reply = r.content.filter(c => c.type === 'text').map(c => c.text || '').join('').trim();
          if (!fast) return out;
          const stop = CANT.test(out.reply) ? { why: 'cant' } : fastAnswerStop(out.reply, lookups, [...history.map(m => String(m.content)), now(ctx, role as Role)], lengths);
          return stop ? { ...out, stop } : out;
        }
        if (fast) {
          // anything but a plain lookup is for the main model, and so is a third round of lookups: nothing of this round is run
          const hard = uses.find(u => !FAST_TOOLS.includes(u.name || ''));
          if (hard) return { ...out, stop: { why: `tool:${hard.name}` } };
          if (round >= 2) return { ...out, stop: { why: 'steps' } };
        }
        msgs.push({ role: 'assistant', content: r.content });
        const results = [];
        out.usedTools += uses.length;
        for (const u of uses) {
          if (u.name === 'log_request' || u.name === 'report_bug') out.logged = true;
          const { out: got, proposal: p } = await runTool(sb, ctx, role as Role, u.name || '', u.input || {});
          if (fast && got && (got as { error?: string }).error) return { ...out, stop: { why: 'tool_error' } };
          if (p) out.proposal = p;
          if (u.name === 'show_map' && got && !(got as { error?: string }).error) { out.map = got; out.mapTitle = String(u.input?.title || ''); }
          // a map's pins can be many: Claude only needs the counts
          const forClaude = u.name === 'show_map' && got && (got as { pins?: unknown[] }).pins
            ? { maps: (got as { maps: unknown }).maps, highlighted_routes: (got as { highlight: unknown[] }).highlight, pins: (got as { pins: unknown[] }).pins.length, shown: true }
            : got;
          const text = JSON.stringify(forClaude).slice(0, 30000);
          if (fast) { lookups.push(text); arrayLengths(forClaude, 0, lengths); }
          results.push({ type: 'tool_result', tool_use_id: u.id, content: text });
        }
        msgs.push({ role: 'user', content: results });
      }
      return fast ? { ...out, stop: { why: 'steps' } } : { ...out, reply: 'That took too many steps. Try asking a narrower question.' };
    };

    // the small model first, when that is on and the question is one it may take; the main model whenever its go may not be shown
    const skip = !fastOn ? null : ctx.spoken ? 'spoken' : needsMain(question);
    let res: Run | null = null;
    if (fastOn && !skip) {
      // the small model being unavailable must never cost the person their answer: the main model takes the question
      try { res = await run(FAST, true); } catch (e) {
        console.error('benny-assist fast:', e instanceof Error ? e.message : String(e));
        res = { reply: '', map: null, mapTitle: '', proposal: null, usedTools: 0, logged: false, stop: { why: 'fast_failed' } };
      }
    }
    const why = !fastOn ? null : skip || res?.stop?.why || null;
    const tokens = res?.stop?.tokens;
    if (!res || res.stop) res = await run(MODEL, false);
    // it said it couldn't, straight off, and logged nothing: log it for it
    if (!res.logged && res.usedTools === 0 && !res.proposal && CANT.test(res.reply) && !OFF_TOPIC.test(res.reply)) {
      await logEntry(sb, ctx, 'request', { title: question.slice(0, 120), asked: question, reply: res.reply.slice(0, 600), auto: true });
    }
    const by = fastOn && !why ? 'fast' : 'main';
    console.log('benny-assist usage ' + JSON.stringify({ role, mode: fastOn ? 'fast_first' : 'main', by, why, fast_model: FAST, main_model: MODEL, fast: used.fast, main: used.main }));
    return done(res, { by, why, ...(tokens ? { tokens } : {}) });
  } catch (e) {
    console.error('benny-assist:', e instanceof Error ? e.message : String(e));
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
