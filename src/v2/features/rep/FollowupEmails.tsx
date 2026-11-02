// The rep's follow-up emails due today: the campaign's schedule (by default day 1, 4 and 10 after the first visit)
// for businesses with nothing booked yet. Each opens with an email Claude has drafted from the visit, the deck
// answers and the proposal; the rep checks it and sends it from their own address, or skips it.
import React, { useState } from 'react';
import { Mail } from 'lucide-react';
import { db, must } from '../../lib/client';
import { useLoad } from '../../lib/data';
import { Composer, type ComposeInit } from '../mail/Composer';
import { ErrorBox } from '../../ui';
import { useRep } from './repContext';

interface Due {
  business_id: string; campaign_id: string; name: string; address: string | null; day: number; purpose: string; due_at: string;
  contact_name: string | null; contact_email: string; step: number; steps: number; heat: 'hot' | 'warm' | 'cold' | null; campaign: string;
}
const dueList = async (): Promise<Due[]> => (must(await db.rpc('ms_rep_followups_due')) as Due[]) || [];
const done = async (d: Due, thread: string | null, skipped: boolean) => {
  must(await db.rpc('ms_followup_done', { p_business: d.business_id, p_campaign: d.campaign_id, p_day: d.day, p_thread: thread, p_skipped: skipped }));
};

/** What Claude is asked to write for a step. */
export function followupAsk(d: { day: number; step: number; steps: number; purpose: string; contact_name: string | null }): string {
  return `Follow-up email ${d.step} of ${d.steps}, ${d.day} day${d.day === 1 ? '' : 's'} after my first visit${d.contact_name ? `, to ${d.contact_name}` : ''}. `
    + `${d.purpose} Use their deck answers and the proposal they saw when the context has them (the prices are starting prices, confirmed on the onboarding call). `
    + 'Keep it short and personal; mention something specific from my visit notes if there is something.';
}

export const FollowupEmails: React.FC = () => {
  const { toast } = useRep();
  const [tick, setTick] = useState(0);
  const list = useLoad(dueList, [tick]);
  const [open, setOpen] = useState<Due | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (!list.data?.length) return list.error ? <ErrorBox error={list.error} /> : null;
  const skip = async (d: Due) => {
    setError(null);
    try { await done(d, null, true); setTick(t => t + 1); } catch (e) { setError(e); }
  };
  const init = (d: Due): ComposeInit => ({
    key: `fu:${d.business_id}:${d.campaign_id}:${d.day}`, title: `Follow-up ${d.step} of ${d.steps}`, business_id: d.business_id, campaign_id: d.campaign_id,
    to: [d.contact_email], context: `${d.name} · ${d.campaign}`, autoWrite: followupAsk(d),
  });
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="v2-rep-group">Emails ready to send · {list.data.length}</div>
      <ErrorBox error={error} />
      {list.data.map(d => (
        <div key={`${d.business_id}-${d.day}`} className="v2-rep-item" style={{ alignItems: 'flex-start' }}>
          <button type="button" onClick={() => setOpen(d)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 0, padding: 0, color: 'inherit' }}>
            <div className="n" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{d.name}
              {d.heat && <span className={`v2-fu-heat ${d.heat}`}>{d.heat === 'hot' ? 'Hot' : d.heat === 'warm' ? 'Warm' : 'Cold'}</span>}</div>
            <div className="a">To {d.contact_name || d.contact_email} · follow-up {d.step} of {d.steps}</div>
            <div className="a" style={{ color: '#0f766e', fontWeight: 700 }}><Mail size={12} /> Claude drafts it · review and send</div>
          </button>
          <button type="button" className="v2-rep-mini" onClick={() => skip(d)} aria-label={`Skip the follow-up to ${d.name}`}>Skip</button>
        </div>))}
      {open && <Composer init={init(open)} onClose={() => setOpen(null)}
        onSent={async thread => { const d = open; setOpen(null); try { await done(d, thread, false); } catch { /* the email went; the list catches up */ } toast('Follow-up sent.'); setTick(t => t + 1); }} />}
    </div>
  );
};
