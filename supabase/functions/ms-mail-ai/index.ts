// supabase/functions/ms-mail-ai/index.ts — MainstreetAI mail: Claude writes or rewrites an email.
//
// POST as the signed-in rep or admin:
//   { mode: 'write',   thread_id? | business_id + campaign_id, instruction }       a new email or a reply
//   { mode: 'rewrite', thread_id? | business_id + campaign_id, subject, html, how } shorter, friendlier, …
//   add staff: true for a manager's own mailbox (mail_context: their name and the conversation)
// → { subject, html }
// What Claude knows comes from ms_mail_context, run as the person asking (so a rep only ever gets their
// own businesses): the rep, the business, the campaign's pitch and objections, the rep's last visits
// there, and the conversation so far. The key lives only in the ANTHROPIC_API_KEY secret.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

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
- Output only JSON: {"subject": "...", "html": "..."} where html uses only <p>, <br>, <strong>, <em>, <ul>, <ol>, <li> and <a href="...">. Links only to URLs that appear in the context or the request.`;

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
    const mode = b.mode === 'rewrite' ? 'rewrite' : 'write';
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false },
    });
    const staff = !!(b as Record<string, unknown>).staff;
    const { data: ctx, error } = staff
      ? await asUser.rpc('mail_context', { p_thread: b.thread_id || null })
      : await asUser.rpc('ms_mail_context', { p_thread: b.thread_id || null, p_business: b.business_id || null, p_campaign: b.campaign_id || null });
    if (error) return json({ error: error.message }, /not allowed/i.test(error.message) ? 403 : 400);

    const ask = mode === 'rewrite'
      ? `Rewrite this draft: ${String(b.how || 'make it clearer').slice(0, 300)}.\nKeep its meaning and any links. Subject: ${String(b.subject || '').slice(0, 300)}\nDraft HTML:\n${String(b.html || '').slice(0, 8000)}`
      : `${(ctx as { thread?: unknown[] }).thread?.length ? 'Write the reply to the latest message in this conversation.' : 'Write a new email.'}\nWhat ${staff ? 'the manager' : 'the rep'} wants: ${String(b.instruction || (staff ? 'a short, friendly note' : 'a friendly follow-up after my visit')).slice(0, 1000)}`;

    const WORKSPACE = (Deno.env.get('ANTHROPIC_WORKSPACE_ID') || '').trim();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(WORKSPACE ? { 'anthropic-workspace-id': WORKSPACE } : {}) },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1500, system: staff ? STAFF_RULES : RULES,
        messages: [{ role: 'user', content: `Context (JSON):\n${JSON.stringify(ctx).slice(0, 30000)}\n\n${ask}` }],
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: `Claude didn’t answer: ${out?.error?.message || res.status}` }, 502);
    const text = (out.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
    const parsed = extractJson(text);
    if (!parsed?.html) return json({ error: 'Claude’s answer wasn’t usable. Try again.' }, 502);
    return json({ subject: (parsed.subject || b.subject || '').slice(0, 200), html: tidy(parsed.html), model: MODEL });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});
