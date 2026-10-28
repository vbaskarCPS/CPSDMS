// src/v2/features/mainstreet/Deals.tsx — MainstreetAI › Deals: the admins' pipeline. A rep's closed
// deal waits here until an admin approves it (only then does it count) or rejects it with a reason
// the rep sees. "Can't sell here" flags are sorted here too: take the business off every list, or
// put it back on the rep's list. Businesses reps added themselves are checked here for duplicates.
import React, { useState } from 'react';
import { Check, GitMerge, MapPin, Trash2, X } from 'lucide-react';
import { useLoad } from '../../lib/data';
import { dealPhotos, decideDeal, dealsList, flagsList, kindLabel, leadsList, photoUrls, resolveFlag, resolveLead, whenLabel, type Flag, type Lead, type PipelineDeal } from '../../lib/rep';
import { Btn, ErrorBox, Loading, Tabs, Tag } from '../../ui';

type View = 'pending' | 'approved' | 'rejected' | 'flags' | 'leads';

export const Deals: React.FC = () => {
  const [view, setView] = useState<View>('pending');
  const [tick, setTick] = useState(0);
  const deals = useLoad(() => (view === 'flags' || view === 'leads' ? Promise.resolve([] as PipelineDeal[]) : dealsList(view)), [view, tick]);
  const leads = useLoad(() => leadsList(), [tick]);
  const flags = useLoad(() => flagsList(), [tick]);
  const pending = useLoad(() => dealsList('pending').then(d => d.length), [tick]);
  const refresh = () => setTick(t => t + 1);
  return (
    <div className="v2-main v2-narrow v2-ms">
      <div className="v2-head"><span className="v2-h1">Deals</span></div>
      <Tabs<View> value={view} onChange={setView} items={[
        { key: 'pending', label: 'Waiting for approval', count: pending.data ?? undefined },
        { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Rejected' },
        { key: 'flags', label: 'Can’t sell here', count: flags.data?.length },
        { key: 'leads', label: 'Added by reps', count: leads.data?.length },
      ]} />
      <ErrorBox error={view === 'flags' ? flags.error : view === 'leads' ? leads.error : deals.error} />
      {view === 'leads' ? (leads.loading && !leads.data ? <Loading /> : <LeadList list={leads.data || []} onDone={refresh} />)
        : view === 'flags'
        ? (flags.loading && !flags.data ? <Loading /> : <FlagList list={flags.data || []} onDone={refresh} />)
        : (deals.loading && !deals.data ? <Loading /> : <DealList list={deals.data || []} view={view} onDone={refresh} />)}
    </div>
  );
};

const inline: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' };
const Where: React.FC<{ far: boolean; distance_m?: number }> = ({ far, distance_m }) => far
  ? <Tag tone="a"><span style={inline}><MapPin size={11} />{distance_m != null ? `Logged ${distance_m} m away` : 'No location'}</span></Tag>
  : <Tag tone="g"><span style={inline}><MapPin size={11} />At the business</span></Tag>;

const DealList: React.FC<{ list: PipelineDeal[]; view: View; onDone: () => void }> = ({ list, view, onDone }) => {
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const act = async (id: string, approve: boolean) => {
    setBusy(id); setError(null);
    try { await decideDeal(id, approve, approve ? undefined : reason); setRejecting(null); setReason(''); onDone(); }
    catch (e) { setError(e); } finally { setBusy(null); }
  };
  if (!list.length) return <div className="v2-card" style={{ padding: 30, textAlign: 'center' }}><div className="v2-note">
    {view === 'pending' ? 'No deals waiting. When a rep logs a closed deal it lands here.' : 'None yet.'}</div></div>;
  return (
    <>
      <ErrorBox error={error} />
      {list.map(d => (
        <div key={d.id} className="v2-card" style={{ padding: 14, marginBottom: 10 }}>
          <div className="v2-row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 15.5 }}>{d.business.name}</div>
              <div className="v2-small v2-mut">{kindLabel(d.business.kind)}{d.business.address ? ` · ${d.business.address}` : ''}</div>
            </div>
            <Tag tone="b"><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: d.color, marginRight: 4 }} />{d.campaign}</Tag>
          </div>
          <div className="v2-small" style={{ margin: '8px 0 4px' }}><b>{d.rep}</b> · {whenLabel(d.at)}{d.zone ? ` · ${d.zone}` : ''}</div>
          <div className="v2-row v2-small" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Where far={d.far} distance_m={d.distance_m} />
            {(d.contact_name || d.contact_phone || d.contact_email) && <span>{[d.contact_name, d.contact_phone, d.contact_email].filter(Boolean).join(' · ')}</span>}
          </div>
          {d.notes && <div className="v2-small" style={{ marginTop: 6 }}>“{d.notes}”</div>}
          <DealPhotos id={d.id} />
          {d.status !== 'pending' && <div className="v2-small v2-mut" style={{ marginTop: 6 }}>
            {d.status === 'approved' ? 'Approved' : 'Rejected'}{d.decided_by ? ` by ${d.decided_by}` : ''}{d.decided_at ? ` · ${whenLabel(d.decided_at)}` : ''}{d.decision_note ? ` · ${d.decision_note}` : ''}</div>}
          {d.status === 'pending' && (rejecting === d.id ? (
            <div style={{ marginTop: 10 }}>
              <input className="v2-input" placeholder="Why it’s rejected (the rep sees this)" value={reason} onChange={e => setReason(e.target.value)} autoFocus />
              <div className="v2-row" style={{ gap: 8, marginTop: 8 }}>
                <Btn kind="r" onClick={() => act(d.id, false)} disabled={busy === d.id || !reason.trim()}>Reject</Btn>
                <Btn kind="o" onClick={() => { setRejecting(null); setReason(''); }}>Cancel</Btn>
              </div>
            </div>
          ) : (
            <div className="v2-row" style={{ gap: 8, marginTop: 10 }}>
              <Btn kind="g" icon={Check} onClick={() => act(d.id, true)} disabled={busy === d.id}>Approve</Btn>
              <Btn kind="o" icon={X} onClick={() => { setRejecting(d.id); setReason(''); }} disabled={busy === d.id}>Reject…</Btn>
            </div>))}
        </div>))}
    </>
  );
};

const FlagList: React.FC<{ list: Flag[]; onDone: () => void }> = ({ list, onDone }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const act = async (id: string, remove: boolean) => {
    setBusy(id); setError(null);
    try { await resolveFlag(id, remove); onDone(); } catch (e) { setError(e); } finally { setBusy(null); }
  };
  if (!list.length) return <div className="v2-card" style={{ padding: 30, textAlign: 'center' }}><div className="v2-note">Nothing flagged. When a rep marks a business “Can’t sell here” it lands here.</div></div>;
  return (
    <>
      <ErrorBox error={error} />
      {list.map(f => (
        <div key={f.id} className="v2-card" style={{ padding: 14, marginBottom: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 15.5 }}>{f.business.name}</div>
          <div className="v2-small v2-mut">{kindLabel(f.business.kind)}{f.business.address ? ` · ${f.business.address}` : ''}</div>
          <div className="v2-small" style={{ margin: '8px 0 4px' }}><b>{f.rep}</b> · {whenLabel(f.at)} · {f.campaign}{f.zone ? ` · ${f.zone}` : ''}</div>
          <Where far={f.far} distance_m={f.distance_m} />
          <div className="v2-small" style={{ marginTop: 6 }}>“{f.notes}”</div>
          <div className="v2-row" style={{ gap: 8, marginTop: 10 }}>
            <Btn kind="r" onClick={() => act(f.id, true)} disabled={busy === f.id}>Take it off every list</Btn>
            <Btn kind="o" onClick={() => act(f.id, false)} disabled={busy === f.id}>Put it back on the rep’s list</Btn>
          </div>
        </div>))}
    </>
  );
};

const DealPhotos: React.FC<{ id: string }> = ({ id }) => {
  const p = useLoad(async () => { const paths = await dealPhotos(id); return paths.length ? { paths, urls: await photoUrls(paths) } : null; }, [id]);
  if (!p.data) return null;
  return (
    <div className="v2-row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
      {p.data.paths.map(x => p.data!.urls[x] && (
        <a key={x} href={p.data!.urls[x]} target="_blank" rel="noreferrer"><img src={p.data!.urls[x]} alt="Visit photo" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, display: 'block' }} /></a>))}
    </div>
  );
};

const LeadList: React.FC<{ list: Lead[]; onDone: () => void }> = ({ list, onDone }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const act = async (id: string, action: 'keep' | 'remove' | 'merge', target?: string) => {
    setBusy(id); setError(null);
    try { await resolveLead(id, action, target); onDone(); } catch (e) { setError(e); } finally { setBusy(null); }
  };
  if (!list.length) return <div className="v2-card" style={{ padding: 30, textAlign: 'center' }}><div className="v2-note">Nothing to check. When a rep adds a business that wasn’t on the map it lands here.</div></div>;
  return (
    <>
      <ErrorBox error={error} />
      <div className="v2-note" style={{ marginBottom: 10 }}>These already count for the rep. Only check they aren’t a business that’s on the map under another name.</div>
      {list.map(l => (
        <div key={l.id} className="v2-card" style={{ padding: 14, marginBottom: 10 }}>
          <div className="v2-row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 15.5 }}>{l.name}</div>
              <div className="v2-small v2-mut">{kindLabel(l.kind)}{l.address ? ` · ${l.address}` : ''}{l.phone ? ` · ${l.phone}` : ''}</div>
            </div>
            <a className="v2-small" href={`https://www.google.com/maps?q=${l.lat},${l.lng}`} target="_blank" rel="noreferrer">Map</a>
          </div>
          <div className="v2-small" style={{ margin: '8px 0 4px' }}><b>{l.rep}</b> · {whenLabel(l.at)}{l.campaign ? ` · ${l.campaign}` : ''} · {l.zone || <span style={{ color: 'var(--rose)' }}>outside every zone</span>}</div>
          {l.nearby.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="v2-small v2-mut">Close by on the map:</div>
              {l.nearby.map(n => (
                <div key={n.id} className="v2-row v2-small" style={{ gap: 8, padding: '4px 0' }}>
                  <span style={{ flex: 1 }}><b>{n.name}</b>{n.address ? ` · ${n.address}` : ''} · {n.m} m</span>
                  <Btn kind="o" size="sm" icon={GitMerge} disabled={busy === l.id} onClick={() => act(l.id, 'merge', n.id)}>Same business</Btn>
                </div>))}
            </div>)}
          <div className="v2-row" style={{ gap: 8, marginTop: 10 }}>
            <Btn kind="g" icon={Check} onClick={() => act(l.id, 'keep')} disabled={busy === l.id}>It’s new: keep it</Btn>
            <Btn kind="o" icon={Trash2} onClick={() => act(l.id, 'remove')} disabled={busy === l.id}>Not a business: remove</Btn>
          </div>
        </div>))}
    </>
  );
};
