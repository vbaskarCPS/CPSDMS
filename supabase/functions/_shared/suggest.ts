// supabase/functions/_shared/suggest.ts — Claude reads a customer's email to a centre's customer mailbox and
// suggests a reply and what to do with the booking (RUN_71). Nothing is sent or changed here: the suggestion is
// kept (mail_suggest_save) and shown on the conversation for someone to approve.
// Used by ms-mail-inbound (every email that comes in, in the background) and ms-mail-ai ("Suggest again").

export const SUGGEST_MODEL = Deno.env.get('MAIL_MODEL') || Deno.env.get('BENNY_MODEL') || 'claude-sonnet-5-5';

export const SUGGEST_RULES = `You help the office of Canadian Property Stars (lawn aeration, lawn rejuvenation, driveway sealing, window cleaning) answer customers who write back to the centre's customer mailbox, usually after a "day before" reminder, a "next try" email or a receipt.
You get the customer's email, the conversation before it, and the bookings it may be about (JSON). Decide what they want, what to do with the booking, and draft a reply. A person approves everything before it happens.

How the business works (use it, never contradict it):
- We don't schedule days or times. Crews work an area on a day, and we come back to an area only when the whole crew returns there.
- "Second round" means: we skip them on this pass and come back when the crew returns to their area later in the season; we email them the day before.
- A cancellation cancels their whole plan for the season. If they prepaid, the office arranges the refund; never promise an amount or a date for it.
- Never invent prices, dates, times, discounts, guarantees or facts. Only use the context.

Intent (pick one): delay (can't do the visit now: away, busy, bad timing, "come later", "not tomorrow", reschedule), cancel (doesn't want the service / the plan anymore, moved, sold the house), instructions (gate code, dog, where to park, sprinklers, which part of the lawn), thanks (confirming or thanking, nothing else), question (asks something), other.
Action (only when the email clearly asks for it AND a booking is given):
- second_round for delay
- cancel for cancel (only an explicit wish to stop the service; "not tomorrow" is a delay, not a cancel)
- field_notes for instructions the crew needs (note = the instruction, short, e.g. "Gate code 4412; dog in back")
- none otherwise, or when unsure.
note: for second_round or cancel, the customer's reason in a few words (e.g. "Away until Nov 10"); for field_notes, the instruction.
booking_id: the id of the booking it's about. Prefer one marked linked. If several could fit and you can't tell, leave it empty.
summary: "<First name or email> <what they want>", under 60 characters, e.g. "Ann Lee wants to delay", "Bob Ng is cancelling (prepaid)", "Cy sent a gate code", "Dana asked about price".
needs_reply: false only for a plain thanks/confirmation that needs no answer.
reply: write as the centre ("we"), warm, plain, short (30 to 110 words), first name when known. No emoji, no hype, no signature (the app adds it). For a delay: confirm we'll skip this visit and come back when the crew is back in their area, with a day-before email. For a cancel: confirm, thank them; if prepaid, say the office will be in touch about the refund. For instructions: confirm the crew will see it. For a question you can't answer from the context, say the office will follow up, with a placeholder in [square brackets] for anything the person must fill in.
reply_subject: "Re: " + their subject (unless it already starts with Re:).
confidence: high, medium or low.
Output only JSON: {"intent": "...", "action": "...", "booking_id": "...", "note": "...", "summary": "...", "needs_reply": true, "reply_subject": "...", "reply_html": "<p>...</p>", "confidence": "..."}
reply_html uses only <p>, <br>, <strong>, <em>, <ul>, <li>.`;

/** Keep only the tags a reply may use. */
export const tidyHtml = (s: string) => String(s || '')
  .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, '')
  .replace(/<(\/?)(p|br|strong|em|ul|ol|li)(\s[^>]*)?>/gi, '<$1$2>')
  .replace(/<(?!\/?(p|br|strong|em|ul|ol|li)\b)[^>]*>/gi, '')
  .trim();

export function parseSuggestion(text: string): Record<string, unknown> | null {
  const m = /\{[\s\S]*\}/.exec(text || '');
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function claude(apiKey: string, content: string): Promise<string> {
  const ws = (Deno.env.get('ANTHROPIC_WORKSPACE_ID') || '').trim();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(ws ? { 'anthropic-workspace-id': ws } : {}) },
    body: JSON.stringify({ model: SUGGEST_MODEL, max_tokens: 1500, system: SUGGEST_RULES, messages: [{ role: 'user', content }] }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude didn’t answer: ${out?.error?.message || res.status}`);
  return (out.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
}

/** Read one received email and keep a suggestion for it. Returns the suggestion id, or null when the email
 *  isn't a customer's email to a centre's mailbox. Never throws for "not ours"; throws on real failures. */
// deno-lint-ignore no-explicit-any
export async function suggestFor(svc: any, messageId: string): Promise<string | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('AI replies aren’t set up (ANTHROPIC_API_KEY is missing).');
  const { data: ctx, error } = await svc.rpc('mail_suggest_context', { p_message: messageId });
  if (error) throw new Error(error.message);
  if (!ctx) return null;
  const text = await claude(apiKey, `Today: ${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })}\nContext (JSON):\n${JSON.stringify(ctx).slice(0, 30000)}`);
  const p = parseSuggestion(text);
  if (!p) throw new Error('Claude’s answer wasn’t usable');
  const { data: id, error: se } = await svc.rpc('mail_suggest_save', {
    p_message: messageId, p_model: SUGGEST_MODEL,
    p: { ...p, reply_html: tidyHtml(String(p.reply_html || '')) },
  });
  if (se) throw new Error(se.message);
  return id as string;
}
