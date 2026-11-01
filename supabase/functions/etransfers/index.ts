// supabase/functions/etransfers/index.ts — Super Admin › Accounts Reporting: "Check again".
// POST as a signed-in super admin (or someone with sa_reporting):
//   { action: 'recheck' }                 match every receipt still unmatched (a day saved since may now fit)
//   { action: 'read', message_id }        read one email in payments@ again (Claude), then match it
// → { done: n, matched: n, review: n, unmatched: n }
// Reading and matching: _shared/etransfer.ts. Nothing here changes a payout.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { matchReceipt, receiptFor } from '../_shared/etransfer.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false },
    });
    const { data: ok } = await user.rpc('app_etf_allowed');
    if (ok !== true) return json({ error: 'Accounts Reporting is for super admins' }, 403);
    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({})) as { action?: string; message_id?: string };
    const tally = { done: 0, matched: 0, review: 0, unmatched: 0, errors: 0 };
    if (body.action === 'read' && body.message_id) {
      const id = await receiptFor(svc, body.message_id);
      if (!id) return json({ error: 'That email isn’t in payments@' }, 400);
      tally.done = 1;
      return json(tally);
    }
    if (body.action !== 'recheck') return json({ error: 'Unknown action' }, 400);
    const { data: rows, error } = await svc.from('etf_receipts').select('id, message_id, amount')
      .in('status', ['unmatched', 'new', 'error']).order('received_at');
    if (error) throw new Error(error.message);
    for (const r of (rows || []) as { id: string; message_id: string | null; amount: number | null }[]) {
      try {
        if (r.amount == null && r.message_id) { await receiptFor(svc, r.message_id); tally.done++; continue; }   // never read: read it again
        const out = await matchReceipt(svc, r.id) as 'matched' | 'review' | 'unmatched';
        tally.done++; tally[out]++;
      } catch (err) { tally.errors++; console.error('etransfers: recheck', r.id, err instanceof Error ? err.message : err); }
    }
    return json(tally);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Something went wrong' }, 500);
  }
});
