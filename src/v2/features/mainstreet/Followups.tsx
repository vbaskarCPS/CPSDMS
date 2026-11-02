// src/v2/features/mainstreet/Followups.tsx — MainstreetAI › Follow-ups: a campaign's follow-up emails after a visit
// with nothing booked (which days, and what each one is for), on or off, how it's going, and what's due now.
// Claude drafts each one from the visit, the deck answers and the proposal; the rep checks it and sends it.
import React, { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { db, must } from '../../lib/client';
import { useLoad } from '../../lib/data';
import { listCampaigns } from '../../lib/mainstreet';
import { whenLabel } from '../../lib/rep';
import { Btn, Card, ErrorBox, Loading, Toggle } from '../../ui';

interface Step { day: number; purpose: string }
interface Admin {
  enabled: boolean; custom: boolean; steps: Step[]; sent: number; businesses: number; replied: number; booked: number;
  due: { name: string; day: number; step: number; steps: number; due_at: string; rep: string | null; to: string | null }[];
}
const load = async (c: string) => must(await db.rpc('ms_followup_admin', { p_campaign: c })) as Admin;
const save = async (c: string, enabled: boolean, steps: Step[] | null) => must(await db.rpc('ms_followup_save', { p_campaign: c, p_enabled: enabled, p_steps: steps })) as Admin;

export const Followups: React.FC = () => {
  const campaigns = useLoad(listCampaigns, []);
  const active = (campaigns.data || []).filter(c => c.is_active);
  const [campaign, setCampaign] = useState('');
  useEffect(() => { if (!campaign && active.length) setCampaign(active[0].id); }, [active, campaign]);
  const [tick, setTick] = useState(0);
  const a = useLoad(() => (campaign ? load(campaign) : Promise.resolve(null)), [campaign, tick]);
  const [steps, setSteps] = useState<Step[]>([]);
  useEffect(() => { if (a.data) setSteps(a.data.steps); }, [a.data]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [saved, setSaved] = useState(false);
  const doSave = async (enabled: boolean, withSteps: boolean) => {
    if (!campaign) return;
    setBusy(true); setError(null); setSaved(false);
    try { await save(campaign, enabled, withSteps ? [...steps].sort((x, y) => x.day - y.day) : null); setSaved(withSteps); setTick(t => t + 1); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  const d = a.data;
  return (
    <div className="v2-main v2-narrow v2-ms">
      <div className="v2-head" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="v2-h1">Follow-ups</span>
        {active.length > 1 && <select className="v2-sel" style={{ width: 'auto' }} value={campaign} onChange={e => setCampaign(e.target.value)}>
          {active.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      </div>
      <ErrorBox error={a.error || error} />
      {a.loading && !d ? <Loading /> : d && <>
        <Card>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Toggle on={d.enabled} onChange={v => doSave(v, false)} label="Follow-up emails on" disabled={busy} />
            <b>{d.enabled ? 'Follow-up emails are on' : 'Follow-up emails are off'}</b>
          </div>
          <div className="v2-small v2-mut" style={{ marginTop: 6 }}>
            After a visit with nothing booked, each step comes due in the rep’s Follow-ups with an email Claude has drafted from the visit, the deck answers
            and the proposal. The rep checks it and sends it from their own address, with an unsubscribe link. Only to people who handed over a card or said
            OK on the deck. They stop when the owner books, replies or unsubscribes, or a rep marks the business lost or do not knock.
          </div>
        </Card>
        <div className="v2-cards-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, margin: '12px 0' }}>
          <div className="v2-card" style={{ padding: 12 }}><b style={{ fontSize: 22, display: 'block' }}>{d.businesses}</b><span className="v2-small v2-mut">businesses emailed ({d.sent} emails)</span></div>
          <div className="v2-card" style={{ padding: 12 }}><b style={{ fontSize: 22, display: 'block' }}>{d.replied}</b><span className="v2-small v2-mut">replied</span></div>
          <div className="v2-card" style={{ padding: 12 }}><b style={{ fontSize: 22, display: 'block' }}>{d.booked}</b><span className="v2-small v2-mut">booked after an email</span></div>
        </div>
        <Card title="The steps" right={<span className="v2-small v2-mut">{d.custom ? 'Your own' : 'The defaults'}</span>}>
          {steps.map((s, i) => (
            <div key={i} className="v2-fu-step">
              <label className="day">Day <input className="v2-input" type="number" min={0} max={60} value={s.day} aria-label={`Step ${i + 1}: days after the first visit`}
                onChange={e => setSteps(ss => ss.map((x, j) => (j === i ? { ...x, day: Math.max(0, Math.min(60, Number(e.target.value) || 0)) } : x)))} /></label>
              <textarea className="v2-input" rows={3} value={s.purpose} aria-label={`Step ${i + 1}: what it's for`}
                onChange={e => setSteps(ss => ss.map((x, j) => (j === i ? { ...x, purpose: e.target.value } : x)))} />
              {steps.length > 1 && <button type="button" className="v2-rep-x" aria-label="Remove this step" onClick={() => setSteps(ss => ss.filter((_, j) => j !== i))}><X size={16} /></button>}
            </div>))}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            {steps.length < 8 && <Btn kind="o" size="sm" icon={Plus} onClick={() => setSteps(ss => [...ss, { day: Math.min(60, (ss[ss.length - 1]?.day || 0) + 7), purpose: '' }])}>Add a step</Btn>}
            <Btn disabled={busy || steps.some(s => !s.purpose.trim())} onClick={() => doSave(d.enabled, true)}>{busy ? 'Saving…' : 'Save steps'}</Btn>
            {saved && <span className="v2-small" style={{ color: '#15803d' }}>Saved.</span>}
          </div>
          <div className="v2-small v2-mut" style={{ marginTop: 6 }}>Days after the first visit. Say what each email is for in plain words: Claude writes it from that.</div>
        </Card>
        <Card title="Due now">
          {!d.due.length ? <div className="v2-small v2-mut">Nothing due.</div> : d.due.map((x, i) => (
            <div key={i} className="v2-small" style={{ display: 'flex', gap: 10, padding: '6px 0', borderTop: i ? '1px solid var(--line)' : 0 }}>
              <span style={{ flex: 1 }}><b>{x.name}</b> · step {x.step} of {x.steps}{x.to ? ` · to ${x.to}` : ''}</span>
              <span className="v2-mut">{x.rep || 'no rep'} · due {whenLabel(x.due_at)}</span>
            </div>))}
        </Card>
      </>}
    </div>
  );
};
