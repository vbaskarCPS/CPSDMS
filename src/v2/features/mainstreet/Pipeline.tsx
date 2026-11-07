// src/v2/features/mainstreet/Pipeline.tsx — MainstreetAI › Pipeline: every business a rep has worked, by stage
// (New → Talked to → Pitched → Onboarding booked → Won / Lost), with how hot it is. Filter by campaign, rep and
// heat; open one for its stage, the reasons for its score, and everything that's happened there.
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLoad } from '../../lib/data';
import { listCampaigns, listReps } from '../../lib/mainstreet';
import { HEAT, STAGES, byStage, pipeline, type Heat, type PipeRow, type Stage } from '../../lib/msPipeline';
import { Btn, ErrorBox, Loading, Modal, Tabs } from '../../ui';
import { StageCard, StateLine, Timeline } from '../rep/Stage';
import '../rep/rep.css';

export const Pipeline: React.FC = () => {
  const campaigns = useLoad(listCampaigns, []);
  const reps = useLoad(listReps, []);
  const [campaign, setCampaign] = useState('');
  const [rep, setRep] = useState('');
  const [heat, setHeat] = useState<Heat | ''>('');
  const [tick, setTick] = useState(0);
  const rows = useLoad(() => pipeline(campaign || null, rep || null), [campaign, rep, tick]);
  const shown = useMemo(() => (rows.data || []).filter(r => !heat || r.heat === heat), [rows.data, heat]);
  const cols = useMemo(() => byStage(shown), [shown]);
  const [phoneStage, setPhoneStage] = useState<Stage>('pitched');
  const [open, setOpen] = useState<PipeRow | null>(null);
  // opened from a pin on the Zones map: ?open={business}&c={campaign}
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = params.get('open'); if (!id || !rows.data) return;
    const r = rows.data.find(x => x.id === id && (!params.get('c') || x.campaign_id === params.get('c')));
    if (r) setOpen(r);
    setParams({}, { replace: true });
  }, [rows.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const month = useMemo(() => {
    const since = new Date(); since.setDate(1); since.setHours(0, 0, 0, 0);
    const recent = (rows.data || []).filter(r => r.last_at && new Date(r.last_at) >= since);
    return { worked: recent.length, booked: recent.filter(r => r.stage === 'booked').length, won: recent.filter(r => r.stage === 'won').length };
  }, [rows.data]);

  return (
    <div className="v2-main v2-ms">
      <div className="v2-head" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="v2-h1">Pipeline</span>
        <select className="v2-sel" style={{ width: 'auto' }} value={campaign} onChange={e => setCampaign(e.target.value)} aria-label="Campaign">
          <option value="">All campaigns</option>{(campaigns.data || []).filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className="v2-sel" style={{ width: 'auto' }} value={rep} onChange={e => setRep(e.target.value)} aria-label="Rep">
          <option value="">All reps</option>{(reps.data || []).map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}</select>
        <div className="v2-pipe-heat" role="group" aria-label="How hot">
          {(['', 'hot', 'warm', 'cold'] as const).map(h => <button key={h || 'all'} type="button" className={heat === h ? 'on' : ''} onClick={() => setHeat(h)}>{h ? HEAT[h].label : 'All'}</button>)}
        </div>
        <span className="v2-small v2-mut" style={{ marginLeft: 'auto' }}>This month: <b>{month.worked}</b> worked · <b>{month.booked}</b> booked · <b>{month.won}</b> won</span>
      </div>
      <ErrorBox error={rows.error} />
      {rows.loading && !rows.data ? <Loading /> : (
        <>
          <div className="v2-pipe-tabs"><Tabs<Stage> value={phoneStage} onChange={setPhoneStage} items={STAGES.map(s => ({ key: s.key, label: s.label, count: cols[s.key].length }))} /></div>
          <div className="v2-pipe">
            {STAGES.map(s => (
              <div key={s.key} className={`col${phoneStage === s.key ? ' phone-on' : ''}`}>
                <div className="ch"><b>{s.label}</b><span>{cols[s.key].length}</span></div>
                {cols[s.key].slice(0, 80).map(r => (
                  <button key={r.id + r.campaign_id} type="button" className="card" onClick={() => setOpen(r)}>
                    <b>{r.name}</b>
                    <span className="v2-small v2-mut">{[r.rep, r.zone].filter(Boolean).join(' · ') || r.campaign}</span>
                    {r.heat && <span className={`heat ${r.heat}`}>{HEAT[r.heat].label}</span>}
                    <StateLine s={r} />
                  </button>))}
                {cols[s.key].length > 80 && <div className="v2-small v2-mut" style={{ padding: 6 }}>+{cols[s.key].length - 80} more: filter by rep</div>}
                {!cols[s.key].length && <div className="v2-small v2-mut" style={{ padding: 6 }}>None</div>}
              </div>))}
          </div>
        </>)}
      {open && (
        <Modal wide title={open.name} onClose={() => { setOpen(null); setTick(t => t + 1); }} footer={<Btn kind="o" onClick={() => { setOpen(null); setTick(t => t + 1); }}>Close</Btn>}>
          <div className="v2-small v2-mut" style={{ marginBottom: 4 }}>{[open.address, open.campaign, open.rep, open.zone].filter(Boolean).join(' · ')}</div>
          <StageCard business={open.id} campaign={open.campaign_id} />
          <b style={{ display: 'block', margin: '12px 0 8px' }}>Everything on this business</b>
          <Timeline business={open.id} campaign={open.campaign_id} />
        </Modal>)}
    </div>
  );
};
