// Where a business stands: its stage (New → Pitched → Questionnaire → Onboarding booked → Won, or Lost with a
// reason), how hot it is and why, and everything that's happened there from every rep. Used in the rep app and in
// MainstreetAI › Pipeline.
import React, { useState } from 'react';
import { useLoad } from '../../lib/data';
import { HEAT, STAGES, setLost, timeline, businessState, type BizState, type TimelineItem } from '../../lib/msPipeline';
import { outcomeOf, whenLabel } from '../../lib/rep';
import { Btn, ErrorBox, Loading } from '../../ui';

const FLOW = STAGES.filter(s => s.key !== 'lost');

export const StageCard: React.FC<{ business: string; campaign: string; tick?: number }> = ({ business, campaign, tick = 0 }) => {
  const [mine, setMine] = useState(0);
  const st = useLoad(() => businessState(business, campaign), [business, campaign, tick, mine]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const s = st.data;
  if (!s) return st.error ? null : <div className="v2-stage"><span className="v2-small v2-mut">Loading…</span></div>;
  const at = FLOW.findIndex(f => f.key === s.stage);
  const lose = async (reason: string | null) => {
    setBusy(true); setError(null);
    try { await setLost(business, campaign, reason); setMine(t => t + 1); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <div className="v2-stage">
      <div className="h">
        <span className="v2-rep-label" style={{ margin: 0 }}>Stage</span>
        {s.heat && <span className={`heat ${s.heat}`}>{HEAT[s.heat].label}</span>}
        <b className="now">{s.stage === 'lost' ? 'Lost' : STAGES[at]?.label}</b>
      </div>
      {s.stage === 'lost'
        ? <div className="lost">{s.lost_reason || 'Lost'} <button type="button" className="v2-linkbtn" disabled={busy} onClick={() => lose(null)}>Undo</button></div>
        : <>
          <div className="bar">{FLOW.map((f, i) => <i key={f.key} className={i <= at ? 'on' : ''} />)}</div>
          <div className="labels">{FLOW.map((f, i) => <span key={f.key} className={i === at ? 'on' : ''}>{f.key === 'booked' ? 'Booked' : f.label}</span>)}</div>
        </>}
      {!!s.why?.length && <div className="why">{s.why.map(w => <span key={w}>{w}</span>)}</div>}
      {s.meeting && s.stage === 'booked' && <div className="v2-small">Onboarding call {whenLabel(s.meeting.starts_at)} with {s.meeting.host}</div>}
      {/* lost is logged as Not interested under What happened? (Undo stays here) */}
      <ErrorBox error={error} />
    </div>
  );
};

const DOT: Record<string, string> = { added: '#94a3b8', visit: '#2563eb', send: '#0891b2', person: '#7c3aed', deck: '#0f766e', meeting: '#d97706', outcome: '#16a34a', lost: '#dc2626' };

export const Timeline: React.FC<{ business: string; campaign: string; tick?: number }> = ({ business, campaign, tick = 0 }) => {
  const t = useLoad(() => timeline(business, campaign), [business, campaign, tick]);
  if (t.loading && !t.data) return <Loading />;
  if (t.error) return <ErrorBox error={t.error} />;
  if (!t.data?.length) return <div className="v2-small v2-mut">Nothing yet.</div>;
  return (
    <div className="v2-tl">
      {t.data.map((e: TimelineItem, i) => {
        const o = e.kind === 'visit' ? outcomeOf(e.outcome) : null;
        return (
          <div key={i} className="e">
            <span className="d" style={{ background: o?.color || DOT[e.kind] || '#94a3b8' }} />
            <div className="b">
              <b>{e.kind === 'visit' ? `Visit · ${o?.label || e.outcome}` : e.title}</b>
              <span className="v2-small v2-mut">{[e.by, whenLabel(e.at), e.far ? 'not at the business' : null].filter(Boolean).join(' · ')}</span>
              {e.who && <span className="v2-small">{e.who}</span>}
              {e.text && <span className="v2-small" style={{ whiteSpace: 'pre-wrap' }}>{e.text}</span>}
              {e.follow_up_at && <span className="v2-small">Follow up {whenLabel(e.follow_up_at)}</span>}
            </div>
          </div>);
      })}
    </div>
  );
};

/** For a pipeline card's details. */
export const StateLine: React.FC<{ s: BizState }> = ({ s }) => (
  <span className="v2-small v2-mut">
    {[s.decider ? `${s.decider} decides` : null, s.yearly ? `proposal ~$${Math.round(s.yearly).toLocaleString('en-CA')}/yr` : null,
      s.meeting && s.stage === 'booked' ? `call ${whenLabel(s.meeting.starts_at)}` : null, s.stage === 'lost' ? s.lost_reason : null].filter(Boolean).join(' · ')}
  </span>
);

/** A button that opens the full timeline. */
export const TimelineToggle: React.FC<{ business: string; campaign: string; tick?: number }> = ({ business, campaign, tick }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 14 }}>
      <Btn kind="o" size="sm" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'} everything on this business</Btn>
      {open && <div style={{ marginTop: 10 }}><Timeline business={business} campaign={campaign} tick={tick} /></div>}
    </div>
  );
};
