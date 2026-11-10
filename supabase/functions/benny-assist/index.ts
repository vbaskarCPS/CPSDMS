// supabase/functions/benny-assist/index.ts — The Benny, the in-app assistant.
//
//   POST { messages: [{ role, content }], context: { center_id, center_name, today, path, screen, rm_manager, user_name, diag } }
//     → { reply, map?, proposal? }
//   map      = { maps, highlight, pins, title } for the chat's map card
//   proposal = a change for the person to confirm on a card: start_day | give_route | partner | solo. The Benny never makes
//              the change itself: the app does, with the same code as its screens, after the person taps Confirm.
//
// Who: super admins (everything), route managers (their own team on the live map: carts, routes, connected routes).
// Runs as the signed-in person: their JWT is passed through, so every lookup (benny_* database functions) is checked by
// the database against their permissions and the centers they can see. The Benny has no database access of its own.
// Bug reports: saved in the app, then a GitHub issue (GITHUB_TOKEN, BENNY_GITHUB_REPO) and an email (RESEND_API_KEY,
// BENNY_BUG_EMAIL). Secrets are set by the owner; none are in this file.
// Model: BENNY_MODEL secret, else a Sonnet-class model. The Claude key lives only in ANTHROPIC_API_KEY.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { TOOLS, system, toolCall, toolsFor, type Ctx, type ProposalKind, type Role } from './tools.ts';

const MODEL = Deno.env.get('BENNY_MODEL') || 'claude-sonnet-5-5';
const WORKSPACE = Deno.env.get('ANTHROPIC_WORKSPACE_ID') || '';
const REPO = Deno.env.get('BENNY_GITHUB_REPO') || 'vbaskarCPS/CPSDMS';
const MAIL_FROM = Deno.env.get('BENNY_MAIL_FROM') || 'benny@propertystars.app';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Msg = { role: 'user' | 'assistant'; content: unknown };
type Proposal = { kind: ProposalKind; check: Record<string, unknown>; team_mode?: string };

async function reportBug(sb: SupabaseClient, ctx: Ctx, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const report = { ...input, user: ctx.user_name || null, center: ctx.center_name || null, path: ctx.path || null, screen: ctx.screen || null,
    rm_manager: ctx.rm_manager || null, diag: ctx.diag || null, at: new Date().toISOString() };
  const { data: id, error } = await sb.rpc('benny_bug_save', { p_center: ctx.center_id || null, p_path: ctx.path || null, p_title: String(input.title || ''), p_report: report });
  if (error) return { error: error.message };
  const steps = Array.isArray(input.steps) && input.steps.length ? (input.steps as string[]).map((s, i) => `${i + 1}. ${s}`).join('\n') : '_Not given_';
  const errs = ctx.diag?.errors?.length ? '```\n' + ctx.diag.errors.slice(-8).join('\n').slice(0, 3000) + '\n```' : '_None caught on the page_';
  const body = [
    `**Reported by** ${ctx.user_name || 'someone'} through The Benny${ctx.center_name ? ` · ${ctx.center_name}` : ''} · ${input.severity || 'severity not given'}`,
    '', '### What happened', String(input.what_happened || ''),
    '', '### Expected', String(input.expected || '_Not given_'),
    '', '### Steps', steps,
    '', '### Where', `${input.where || ''}\n\nScreen: \`${ctx.path || '?'}\`${ctx.rm_manager ? ` (RM map for ${ctx.rm_manager})` : ''}`,
    '', '### Browser', `${ctx.diag?.ua || '?'} · ${ctx.diag?.viewport || '?'} · build ${ctx.diag?.build || '?'}`,
    '', '### Recent errors on the page', errs,
    '', `<sub>Benny bug ${id}</sub>`,
  ].join('\n');
  let issueUrl: string | null = null; let emailed = false; const errors: string[] = [];
  const gh = Deno.env.get('GITHUB_TOKEN');
  if (gh) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST', headers: { Authorization: `Bearer ${gh}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'the-benny' },
      body: JSON.stringify({ title: `[Benny] ${String(input.title).slice(0, 180)}`, body, labels: ['bug', 'from-benny'] }),
    }).catch(e => ({ ok: false, status: 0, text: () => Promise.resolve(String(e)) } as unknown as Response));
    if (r.ok) issueUrl = (await r.json() as { html_url?: string }).html_url || null;
    else errors.push(`GitHub ${r.status}: ${(await r.text()).slice(0, 160)}`);
  } else errors.push('GITHUB_TOKEN is not set');
  const resend = Deno.env.get('RESEND_API_KEY'); const to = Deno.env.get('BENNY_BUG_EMAIL');
  if (resend && to) {
    const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `The Benny <${MAIL_FROM}>`, to: [to], subject: `Bug: ${String(input.title).slice(0, 150)}`,
        text: `${issueUrl ? `GitHub issue: ${issueUrl}\n\n` : ''}${body}`,
        html: `${issueUrl ? `<p><a href="${issueUrl}">Open the GitHub issue</a></p>` : ''}<pre style="white-space:pre-wrap;font:14px/1.5 system-ui,sans-serif">${esc(body)}</pre>` }),
    }).catch(e => ({ ok: false, status: 0, text: () => Promise.resolve(String(e)) } as unknown as Response));
    if (r.ok) emailed = true; else errors.push(`Email ${r.status}: ${(await r.text()).slice(0, 160)}`);
  } else errors.push(!resend ? 'RESEND_API_KEY is not set' : 'BENNY_BUG_EMAIL is not set');
  await sb.rpc('benny_bug_sent', { p_id: id, p_issue_url: issueUrl, p_emailed: emailed, p_error: errors.join('; ') || null });
  return { saved: true, issue: issueUrl, emailed, problems: errors };
}

async function runTool(sb: SupabaseClient, ctx: Ctx, role: Role, name: string, input: Record<string, unknown>): Promise<{ out: unknown; proposal?: Proposal }> {
  if (!TOOLS.some(t => t.name === name && t.roles.includes(role))) return { out: { error: `${name} isn't available to you` } };
  const call = toolCall(name, input, ctx);
  if (!call) return { out: { error: `unknown tool ${name}` } };
  if ('bug' in call) return { out: await reportBug(sb, ctx, input) };
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
    // a route manager's "my team" is their own map; only admins can open someone else's
    if (role === 'rm' && ctx.rm_manager) {
      const { data: mine } = await sb.rpc('benny_my_rm_ids', { p_center: ctx.center_id || null });
      if (Array.isArray(mine) && !mine.includes(ctx.rm_manager)) ctx.rm_manager = mine[0];
    }

    const history = (Array.isArray(b.messages) ? b.messages : []).slice(-16)
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) })) as Msg[];
    while (history.length && history[0].role !== 'user') history.shift();
    if (!history.length || history[history.length - 1].role !== 'user') return json({ error: 'No question' }, 400);

    const sys = system(ctx, role as Role);
    const tools = toolsFor(role as Role);
    const msgs: Msg[] = [...history];
    let map: unknown = null; let mapTitle = ''; let proposal: Proposal | null = null;
    // a change that is about routes always comes with its map, even when the Benny didn't draw one
    const mapOf = (p: Proposal | null): unknown => {
      if (!p) return null;
      if (p.kind === 'start_day') {
        const assign = (p.check.assign || []) as { routes?: { code: string }[] }[];
        return { maps: p.check.maps || [], highlight: assign.flatMap(a => (a.routes || []).map(r => r.code)), pins: [], title: 'The plan’s routes' };
      }
      if (p.kind === 'give_route' && p.check.map) return { maps: [p.check.map], highlight: [p.check.route], pins: [], title: String(p.check.route) };
      return null;
    };
    const done = (reply: string) => json({ reply, map: map ? { ...(map as object), title: mapTitle } : mapOf(proposal), proposal });
    for (let round = 0; round < 8; round++) {
      const r = await claude(sys, msgs, tools);
      const uses = r.content.filter(c => c.type === 'tool_use');
      if (!uses.length || r.stop_reason !== 'tool_use') {
        const reply = r.content.filter(c => c.type === 'text').map(c => c.text || '').join('').trim();
        return done(reply || 'Sorry, I didn’t get an answer for that. Try asking another way.');
      }
      msgs.push({ role: 'assistant', content: r.content });
      const results = [];
      for (const u of uses) {
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
