// supabase/functions/ms-report/index.ts — the MainstreetAI daily report email (ms_report_* in
// 20261253700000_ms_daily_report.sql). Header x-cron-key = planner_secrets.cron_key; deployed without JWT checks.
//   POST { action: 'tick' }                     send the day ms_report_due() says is ready, once
//                                               (the database calls this every 5 minutes; due from 9:30 PM Toronto)
//   POST { action: 'test', day: 'YYYY-MM-DD' }  the report for that day, to the settings' test_recipients only;
//                                               nothing is recorded, so it never stops or replaces the real one
// Sent with Resend (RESEND_API_KEY) from the settings' from address, report@propertystars.app; replies go to reply_to.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { renderMsReport, type MsData } from './report.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Settings { enabled: boolean; recipients: string[]; test_recipients: string[]; from_name: string; from_email: string; reply_to: string | null }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: k } = await svc.from('planner_secrets').select('value').eq('name', 'cron_key').maybeSingle();
    if (!k?.value || (req.headers.get('x-cron-key') || '') !== k.value) return json({ error: 'Not allowed' }, 403);
    const body = await req.json().catch(() => ({})) as { action?: string; day?: string };
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) return json({ error: 'RESEND_API_KEY is missing' }, 500);

    const { data: st, error: se } = await svc.from('ms_report_settings')
      .select('enabled, recipients, test_recipients, from_name, from_email, reply_to').eq('id', 1).single();
    if (se) throw new Error(se.message);
    const settings = st as Settings;

    const build = async (day: string) => {
      const { data, error } = await svc.rpc('ms_report_data', { p_day: day });
      if (error) throw new Error(error.message);
      return renderMsReport(data as MsData);
    };
    const send = async (to: string[], mail: { subject: string; html: string; text: string }) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `${settings.from_name} <${settings.from_email}>`, to, subject: mail.subject, html: mail.html, text: mail.text,
          ...(settings.reply_to ? { reply_to: settings.reply_to } : {}) }),
      });
      const out = await res.json().catch(() => ({})) as { id?: string; message?: string };
      if (!res.ok) throw new Error(`${res.status} ${out.message || ''}`.trim());
      return out.id || null;
    };

    if (body.action === 'test') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.day || '')) return json({ error: 'day must be YYYY-MM-DD' }, 400);
      if (!settings.test_recipients?.length) return json({ error: 'No test recipients' }, 400);
      const mail = await build(body.day!);
      const id = await send(settings.test_recipients, { ...mail, subject: `[Test] ${mail.subject}` });
      return json({ sent: 1, id, to: settings.test_recipients });
    }
    if (body.action !== 'tick') return json({ error: 'Unknown action' }, 400);
    if (!settings.enabled || !settings.recipients?.length) return json({ sent: 0, skipped: 'off' });

    const { data: due, error: de } = await svc.rpc('ms_report_due');
    if (de) throw new Error(de.message);
    let sent = 0, failed = 0;
    for (const d of (due || []) as { day: string }[]) {
      const { data: mine } = await svc.rpc('ms_report_claim', { p_day: d.day });
      if (mine !== true) continue;   // another call has it
      let id: string | null = null, err: string | null = null;
      try {
        id = await send(settings.recipients, await build(d.day));
      } catch (e) { err = e instanceof Error ? e.message : String(e); }
      await svc.rpc('ms_report_mark', { p_day: d.day, p_ok: !err, p_resend_id: id, p_error: err, p_recipients: settings.recipients });
      if (err) { failed++; console.error('ms-report', d.day, err); } else sent++;
    }
    return json({ sent, failed });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Something went wrong' }, 500);
  }
});
