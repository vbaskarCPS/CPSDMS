// supabase/functions/ms-calendar/index.ts — MainstreetAI › Meetings: read hosts' own calendars so booking skips
// the times they're busy.
//
// POST as any signed-in user (the rep about to book, the host, an admin):
//   { action: 'refresh', campaign?: uuid, host?: uuid, force?: boolean }
//     → reads the private calendar link of each host on that campaign (or that one host), unless it was read in the
//       last minute (force: always), and stores just the busy times (ms_calendar_store). → { hosts: [{ host, ok, busy, error? }] }
// The links live in Vault (ms_host_set_calendar); only this function reads them (ms_calendar_links, service role).
// Nothing of the calendar is kept but start and end times: no titles, places or people.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { busyFrom, feedUrl } from './busy.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const DAYS_AHEAD = 45;            // a little past the furthest a call can be booked
const FRESH_MS = 60_000;          // read again only if older than a minute
const MAX_BYTES = 8_000_000;

async function readFeed(url: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'text/calendar, */*' }, redirect: 'follow' });
    if (res.status === 404 || res.status === 401 || res.status === 403) throw new Error('The calendar link doesn’t open any more (it may have been reset). Paste the new one.');
    if (!res.ok) throw new Error(`The calendar didn’t answer (${res.status})`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error('That calendar is too big to read');
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('That calendar is too big to read');
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That link isn’t a calendar (copy the iCal / ICS address)');
    return text;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('The calendar took too long to answer');
    throw e;
  } finally { clearTimeout(t); }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false },
    });
    const { data: who } = await user.auth.getUser();
    if (!who?.user) return json({ error: 'Not signed in' }, 401);
    const b = await req.json().catch(() => ({})) as { action?: string; campaign?: string; host?: string; force?: boolean };
    if (b.action !== 'refresh') return json({ error: 'Unknown action' }, 400);
    if (!b.campaign && !b.host) return json({ error: 'Which campaign or host?' }, 400);

    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: links, error } = await svc.rpc('ms_calendar_links', { p_campaign: b.campaign || null, p_host: b.host || null });
    if (error) throw new Error(error.message);
    const now = Date.now(), from = new Date(now - 3600_000), to = new Date(now + DAYS_AHEAD * 86400_000);
    const out = await Promise.all(((links || []) as { host_id: string; url: string; timezone: string; fetched_at: string | null }[]).map(async l => {
      if (!b.force && l.fetched_at && now - new Date(l.fetched_at).getTime() < FRESH_MS) return { host: l.host_id, ok: true, cached: true };
      try {
        const url = feedUrl(l.url);
        if (!url) throw new Error('That calendar link isn’t an https:// or webcal:// address');
        const busy = busyFrom(await readFeed(url), from, to, l.timezone || 'America/Toronto');
        const { error: se } = await svc.rpc('ms_calendar_store', { p_host: l.host_id, p_busy: busy, p_error: null });
        if (se) throw new Error(se.message);
        return { host: l.host_id, ok: true, busy: busy.length };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await svc.rpc('ms_calendar_store', { p_host: l.host_id, p_busy: null, p_error: msg });
        return { host: l.host_id, ok: false, error: msg };
      }
    }));
    return json({ hosts: out });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});
