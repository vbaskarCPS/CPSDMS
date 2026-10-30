// supabase/functions/ms-mail-ai/index.ts — MainstreetAI mail: Claude writes or rewrites an email.
//
// POST as the signed-in rep or admin:
//   { mode: 'write',   thread_id? | business_id + campaign_id, instruction }       a new email or a reply
//   { mode: 'rewrite', thread_id? | business_id + campaign_id, subject, html, how } shorter, friendlier, …
//   add staff: true for a manager's own mailbox (mail_context: their name, the conversation, and the customer's
//   bookings when the address matches one — so a reply can say what's booked, done or why it was missed)
// → { subject, html }
//   { mode: 'template', center_id, type, instruction?, subject?, html? }   a centre's email template, with
//       {{variables}} the app fills in (TEMPLATE_VARS); saved by the office and fixed after that → { subject, html }
//   { mode: 'booking_note', kind: 'day_before' | 'next_try', date, ids: [booking ids, ≤ 25], instruction? }
//       one short personal paragraph per booking for the booking emails, from what we know of that customer
//       (app_mb_booking, as the person asking) → { notes: { [id]: html } }
//   { mode: 'suggest', message_id }   ask Claude again about a customer's email to a centre's mailbox: a reply
//       and what to do with the booking, kept for someone to approve (RUN_71; see _shared/suggest.ts) → { id }
// What Claude knows comes from ms_mail_context, run as the person asking (so a rep only ever gets their
// own businesses): the rep, the business, the campaign's pitch and objections, the rep's last visits
// there, and the conversation so far. The key lives only in the ANTHROPIC_API_KEY secret.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { suggestFor } from '../_shared/suggest.ts';

const MODEL = Deno.env.get('MAIL_MODEL') || Deno.env.get('BENNY_MODEL') || 'claude-sonnet-5-5';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const RULES = `You write short, warm, plain-spoken business emails for a door-to-door sales rep working for MainstreetAI, who represents a client company (the campaign) to small, often old-school brick-and-mortar businesses in Canada.
Rules:
- Write as the rep, first person, to the business owner or the contact named. Use their first name when known.
- Short: 60 to 140 words unless asked otherwise. One clear next step (usually booking a short call, or the campaign's link).
- Plain language, no hype, no exclamation-mark spam, no emoji, no "I hope this email finds you well".
- Never invent facts, prices, discounts, statistics, guarantees or deadlines. Only use what's in the context. If the campaign's pitch or objections say what may and may not be promised, follow them. Never quote a firm price.
- Never give tax, legal or financial advice.
- Don't add a signature or sign-off name; the app adds the rep's signature. End with the last sentence of the body.
- Don't add an unsubscribe line; the app adds it.
- Output only JSON: {"subject": "...", "html": "..."} where html uses only <p>, <br>, <strong>, <em>, <ul>, <ol>, <li> and <a href="...">. Links only to URLs that appear in the context.`;

const STAFF_RULES = `You write clear, friendly, professional emails for a manager at Canadian Property Stars, a Canadian home-services company (lawn aeration, lawn rejuvenation, driveway sealing, window cleaning). Recipients are customers, crew members or other managers.
Rules:
- Write as the manager, first person. Use the recipient's first name when known.
- Short and plain: usually 40 to 150 words unless asked otherwise. Get to the point; one clear next step if one is needed.
- No hype, no emoji, no "I hope this email finds you well".
- Never invent facts, prices, dates, times, addresses or promises. Only use what's in the context or the request; if something needed is missing, leave a short placeholder in square brackets, e.g. [date].
- Don't add a signature or sign-off name; the app adds the manager's signature. End with the last sentence of the body.
- If the context says who you're writing for (me.writing_for, e.g. "Property Stars · BC Fall RJ"), you're answering the centre's shared customer mailbox: write as that team ("we"), still warm and personal.
- When the context has the customer's bookings, use them to answer: what's booked (list, services by job code letters A aeration, D dethatch, F fertilizer, S seed, L lime), whether it's done (done_on), and if a visit was missed, the reason the crew gave (tries). Never promise an exact day or time unless the conversation or bookings already say it; say the office will confirm instead.
- Output only JSON: {"subject": "...", "html": "..."} where html uses only <p>, <br>, <strong>, <em>, <ul>, <ol>, <li> and <a href="...">. Links only to URLs that appear in the context or the request.`;

/** The {{variables}} each kind of template may use (the app fills them in when it sends). */
export const TEMPLATE_VARS: Record<string, string[]> = {
  day_before: ['firstName', 'address', 'dateFriendly', 'services', 'companyName', 'note'],
  next_try: ['firstName', 'address', 'dateFriendly', 'services', 'reason', 'companyName', 'note'],
  receipt: ['firstName', 'lastName', 'fullName', 'address', 'displayPrice', 'paymentMethod', 'date', 'serviceName', 'workerName', 'companyName', 'ETRANSFER_INSTRUCTIONS_SECTION'],
};
export const varsFor = (type: string) => TEMPLATE_VARS[type] || TEMPLATE_VARS.receipt;
const BOOKING_TYPES = new Set(['day_before', 'next_try']);

const TEMPLATE_RULES = `You write reusable customer email templates for Canadian Property Stars, a Canadian home-services company (lawn aeration, lawn rejuvenation, driveway sealing, window cleaning). The office saves the template once and the app fills in the {{variables}} for every customer.
Rules:
- Use only the {{variables}} you're given, spelled exactly, in double curly braces. Never invent other variables, facts, prices, phone numbers, links, discounts or guarantees.
- Plain, warm, short. No hype, no emoji, no exclamation-mark spam.
- day_before: information only, no reply needed. Tell the customer we're coming on {{dateFriendly}} to {{address}} for {{services}}; ask them to unlock gates, keep pets in, move cars/toys off the lawn, and mark sprinkler heads if they can. Put {{note}} on its own paragraph where a personal line fits (it may be empty).
- next_try: we came but couldn't do the job ({{reason}}); we'll try again on {{dateFriendly}}. Ask them to fix what stopped us if they can. Put {{note}} on its own paragraph.
- Booking templates (day_before, next_try) are only the body: no greeting card layout, no signature (the app adds the sender's signature). html uses only <p>, <br>, <strong>, <em>, <ul>, <ol>, <li>.
- Receipt templates are a complete, simple, email-safe HTML document (inline styles, a 600px table layout, no images) that thanks the customer and lists service, address, date, technician, amount and payment; include {{ETRANSFER_INSTRUCTIONS_SECTION}} on its own line after the payment details.
- Output only JSON: {"subject": "...", "html": "..."}.`;

const NOTE_RULES = `You write one short personal paragraph for each customer's booking email from Canadian Property Stars (lawn care). The paragraph goes inside a fixed template the office wrote, so don't repeat the date, address, services or the prep list — add only what's personal.
Rules:
- 1 or 2 sentences, plain and warm, written as "we". Use what's in each booking: how many years they've been with us (history), what they had done before, their plan, notes the office or crew left that the customer should know (e.g. a gate code reminder, a dog), and for a next try, the reason it was missed.
- Never invent facts, prices, promises, times or discounts. Never mention phone numbers, emails, payment or anything private from office notes. If there's nothing personal to say, return an empty string for that booking.
- Output only JSON: {"notes": {"<booking id>": "<p>...</p>", ...}} with every id you were given. html uses only <p>, <strong>, <em>.`;

async function claude(apiKey: string, system: string, content: string, maxTokens: number): Promise<{ text: string } | { error: string }> {
  const WORKSPACE = (Deno.env.get('ANTHROPIC_WORKSPACE_ID') || '').trim();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(WORKSPACE ? { 'anthropic-workspace-id': WORKSPACE } : {}) },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return { error: `Claude didn’t answer: ${out?.error?.message || res.status}` };
  return { text: (out.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('') };
}

// deno-lint-ignore no-explicit-any
async function writeTemplate(b: Record<string, string | undefined>, asUser: any, apiKey: string): Promise<Response> {
  const type = String(b.type || '');
  if (!/^[a-z_]{2,60}$/.test(type)) return json({ error: 'Unknown template' }, 400);
  // only someone who may edit this centre's templates (and it shows the others, to match their tone)
  const { data: existing, error } = await asUser.rpc('app_email_templates', { p_center: b.center_id || null });
  if (error) return json({ error: error.message }, /not allowed/i.test(error.message) ? 403 : 400);
  const vars = varsFor(type);
  const others = ((existing || []) as { type: string; subject: string; html: string }[]).filter(t => t.type !== type && t.html)
    .slice(0, 2).map(t => `${t.type}: ${t.subject}\n${String(t.html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 600)}`);
  const ask = `Template: ${type}${BOOKING_TYPES.has(type) ? ' (booking email body)' : ' (receipt, full HTML document)'}
Variables you may use: ${vars.map(v => `{{${v}}}`).join(', ')}
${b.html ? `Rework this current version: subject "${String(b.subject || '').slice(0, 200)}"\n${String(b.html).slice(0, 8000)}\n` : ''}What the office wants: ${String(b.instruction || 'a clear, friendly version').slice(0, 1000)}
${others.length ? `Other templates of theirs, for tone only:\n${others.join('\n---\n')}` : ''}`;
  const r = await claude(apiKey, TEMPLATE_RULES, ask, BOOKING_TYPES.has(type) ? 1500 : 4000);
  if ('error' in r) return json({ error: r.error }, 502);
  const parsed = extractJson(r.text);
  if (!parsed?.html) return json({ error: 'Claude’s answer wasn’t usable. Try again.' }, 502);
  const html = BOOKING_TYPES.has(type) ? tidy(parsed.html) : parsed.html.replace(/<(script|iframe|object|embed)[\s\S]*?<\/\1>/gi, '');
  return json({ subject: (parsed.subject || '').slice(0, 200), html, vars, model: MODEL });
}

// deno-lint-ignore no-explicit-any
async function bookingNotes(b: Record<string, unknown>, asUser: any, apiKey: string): Promise<Response> {
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter(x => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 25);
  if (!ids.length) return json({ notes: {} });
  const kind = b.kind === 'next_try' ? 'next_try' : 'day_before';
  const people: Record<string, unknown>[] = [];
  for (const id of ids) {
    const { data: bk, error } = await asUser.rpc('app_mb_booking', { p_id: id });
    if (error) return json({ error: error.message }, /not allowed/i.test(error.message) ? 403 : 400);
    // only what a personal line may use: no phones, emails or prices
    people.push({
      id, first_name: bk.people?.[0]?.first || null, job: bk.job_code, plan: bk.plan?.kind || null, prepaid: bk.prepaid,
      status: bk.status, tries: (bk.attempts || []).map((a: Record<string, unknown>) => ({ day: a.day, reason: a.reason, note: a.note })),
      crew_notes: bk.field_notes || null, list: bk.list?.name || null,
      history: (bk.history || []).slice(0, 8).map((h: Record<string, unknown>) => ({ year: h.year, service: h.service })),
    });
  }
  const ask = `Email: ${kind === 'next_try' ? 'next try (we came but couldn’t do it; trying again)' : 'day before (we’re coming)'} on ${String(b.date || '').slice(0, 40)}.
${b.instruction ? `The office adds: ${String(b.instruction).slice(0, 500)}\n` : ''}Bookings (JSON):\n${JSON.stringify(people).slice(0, 40000)}`;
  const r = await claude(apiKey, NOTE_RULES, ask, 4000);
  if ('error' in r) return json({ error: r.error }, 502);
  const m = /\{[\s\S]*\}/.exec(r.text);
  let notes: Record<string, string> = {};
  try { notes = (JSON.parse(m?.[0] || '{}') as { notes?: Record<string, string> }).notes || {}; } catch { /* below */ }
  const out: Record<string, string> = {};
  for (const id of ids) out[id] = notes[id] ? tidy(String(notes[id])) : '';
  return json({ notes: out, model: MODEL });
}

function extractJson(s: string): { subject?: string; html?: string } | null {
  const m = /\{[\s\S]*\}/.exec(s);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
/** Only the tags the composer understands; no attributes but href on links. */
export function tidy(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(\/?)(p|br|strong|b|em|i|ul|ol|li)(\s[^>]*)?>/gi, '<$1$2>')
    .replace(/<a\s[^>]*href="(https?:\/\/[^"]+)"[^>]*>/gi, '<a href="$1">')
    .replace(/<(?!\/?(p|br|strong|b|em|i|ul|ol|li|a)\b)[^>]*>/gi, '');
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'AI writing isn’t set up (ANTHROPIC_API_KEY is missing).' }, 500);
    const b = await req.json().catch(() => ({})) as Record<string, string | undefined>;
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false },
    });
    if (b.mode === 'template') return await writeTemplate(b, asUser, apiKey);
    if (b.mode === 'booking_note') return await bookingNotes(b as unknown as Record<string, unknown>, asUser, apiKey);
    if (b.mode === 'suggest') {
      const { data: ok, error: ce } = await asUser.rpc('mail_suggest_can', { p_message: b.message_id || null });
      if (ce) return json({ error: ce.message }, 400);
      if (!ok) return json({ error: 'Not allowed' }, 403);
      const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
      return json({ id: await suggestFor(svc, String(b.message_id)) });
    }
    const mode = b.mode === 'rewrite' ? 'rewrite' : 'write';
    const staff = !!(b as Record<string, unknown>).staff;
    const { data: ctx, error } = staff
      ? await asUser.rpc('mail_context', { p_thread: b.thread_id || null })
      : await asUser.rpc('ms_mail_context', { p_thread: b.thread_id || null, p_business: b.business_id || null, p_campaign: b.campaign_id || null });
    if (error) return json({ error: error.message }, /not allowed/i.test(error.message) ? 403 : 400);

    const ask = mode === 'rewrite'
      ? `Rewrite this draft: ${String(b.how || 'make it clearer').slice(0, 300)}.\nKeep its meaning and any links. Subject: ${String(b.subject || '').slice(0, 300)}\nDraft HTML:\n${String(b.html || '').slice(0, 8000)}`
      : `${(ctx as { thread?: unknown[] }).thread?.length ? 'Write the reply to the latest message in this conversation.' : 'Write a new email.'}\nWhat ${staff ? 'the manager' : 'the rep'} wants: ${String(b.instruction || (staff ? 'a short, friendly note' : 'a friendly follow-up after my visit')).slice(0, 1000)}`;

    const r = await claude(apiKey, staff ? STAFF_RULES : RULES, `Context (JSON):\n${JSON.stringify(ctx).slice(0, 30000)}\n\n${ask}`, 1500);
    if ('error' in r) return json({ error: r.error }, 502);
    const parsed = extractJson(r.text);
    if (!parsed?.html) return json({ error: 'Claude’s answer wasn’t usable. Try again.' }, 502);
    return json({ subject: (parsed.subject || b.subject || '').slice(0, 200), html: tidy(parsed.html), model: MODEL });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});
