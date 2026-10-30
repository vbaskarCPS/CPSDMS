// supabase/functions/clever-worker/index.ts — Resend's delivery events (the bounce webhook; the name is
// the one Resend already points at). For every email the app sends through Resend:
//   email.delivered / email.delivery_delayed / email.bounced / email.complained (marked as spam)
// → mail_delivery: the sent email in the mailbox shows it (and its group's counts), and bounces and spam
//   complaints are written to email_logs as before (the receipt "bounced" badge). Opens and clicks: not used.
//
// The post is checked against the webhook's signing secret (RESEND_EVENTS_WEBHOOK_SECRET, Svix format).
// Until that secret is set it accepts unsigned posts as it always has, and says so in the logs.
// Deployed without JWT verification (Resend isn't signed in); the signature check stands in for it.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { DELIVERY_EVENTS, reasonOf, verify } from '../_shared/svix.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
export async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const raw = await req.text();
  const secret = Deno.env.get('RESEND_EVENTS_WEBHOOK_SECRET') || '';
  if (secret) {
    const ok = await verify(secret, req.headers.get('svix-id') || '', req.headers.get('svix-timestamp') || '', raw, req.headers.get('svix-signature') || '');
    if (!ok) return json({ error: 'Bad signature' }, 401);
  } else {
    console.warn('clever-worker: RESEND_EVENTS_WEBHOOK_SECRET isn’t set — accepting an unsigned event');
  }
  let evt: { type?: string; created_at?: string; data?: Record<string, unknown> & { email_id?: string; created_at?: string } };
  try { evt = JSON.parse(raw); } catch { return json({ error: 'Not JSON' }, 400); }
  if (!evt.type || !DELIVERY_EVENTS.includes(evt.type) || !evt.data?.email_id) return json({ ignored: evt.type || 'unknown' });
  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data, error } = await svc.rpc('mail_delivery', {
    p_resend_id: evt.data.email_id, p_type: evt.type, p_reason: reasonOf(evt.data), p_at: evt.created_at || evt.data.created_at || null,
  });
  if (error) { console.error('clever-worker: mail_delivery', error.message); return json({ error: error.message }, 500); }   // Resend retries
  return json({ received: true, ...(data as object) });
}

if (import.meta.main) Deno.serve(handle);
