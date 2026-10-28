// src/v2/features/rep/HomeMap.tsx — the rep's home: one map of every zone they're assigned, every
// business on it. Start / end the day, filter (to visit, open now, campaign), jump to the nearest
// business, and add a business that isn't on the map. Opens from the phone's copy with no signal.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Crosshair, LocateFixed, Navigation, Play, Plus, Square, X } from 'lucide-react';
import {
  addLead, dayEnd, dayStart, geocode, hereNow, hoursLabel, isOpen, repMap, reverseGeocode,
  type MapBiz, type RepMap, type RepToday,
} from '../../lib/rep';
import { distLabel, nearest, openAt } from '../../lib/repField';
import { BUSINESS_KINDS } from '../../lib/msCity';
import { cacheGet, cacheSet } from '../../lib/repQueue';
import { Btn, ErrorBox, Field, Loading } from '../../ui';
import { BusinessSheet, type SavedVisit } from './BusinessSheet';
import { RepMapView, type MapPin, type MapZone, type RepMapHandle } from './RepMapView';
import { useRep } from './repContext';

type Loaded = { data: RepMap; at: number; cached: boolean };
async function loadMap(): Promise<Loaded> {
  try { const data = await repMap(); cacheSet('map', data); return { data, at: Date.now(), cached: false }; }
  catch (e) { const c = await cacheGet<RepMap>('map'); if (c) return { data: c.data, at: c.at, cached: true }; throw e; }
}

export const HomeMap: React.FC = () => {
  const { mapTick, toast } = useRep();
  const [m, setM] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { let live = true; loadMap().then(r => { if (live) { setM(r); setError(null); } }).catch(e => { if (live) setError(e); }); return () => { live = false; }; }, [mapTick]);

  const [sp, setSp] = useSearchParams();
  const openId = sp.get('b');
  const setOpen = (id: string | null) => { const n = new URLSearchParams(sp); if (id) n.set('b', id); else n.delete('b'); setSp(n, { replace: !id }); };
  const [show, setShow] = useState<'open' | 'all'>('open');
  const [openNow, setOpenNow] = useState(false);
  const [camp, setCamp] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 5 * 60000); return () => clearInterval(t); }, []);
  const [adding, setAdding] = useState<null | { pick?: boolean; at?: { lat: number; lng: number } }>(null);
  const mapRef = useRef<RepMapHandle>(null);

  const campaigns = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string }>();
    for (const p of m?.data.pairs || []) seen.set(p.campaign_id, { id: p.campaign_id, name: p.campaign_name, color: p.color });
    return [...seen.values()];
  }, [m]);
  const zones: MapZone[] = useMemo(() => {
    const seen = new Map<string, MapZone>();
    for (const p of m?.data.pairs || []) if (!camp || p.campaign_id === camp) if (!seen.has(p.zone_id)) seen.set(p.zone_id, { id: p.zone_id, name: p.zone_name, color: p.color, polygon: p.polygon });
    return [...seen.values()];
  }, [m, camp]);
  const shown = useMemo(() => (m?.data.businesses || []).filter(b =>
    (!camp || b.c === camp) && (show === 'all' || isOpen(b.s)) && (!openNow || openAt(b.h, clock) !== false)), [m, camp, show, openNow, clock]);
  const pins: MapPin[] = useMemo(() => shown.map(b => ({ id: `${b.id}|${b.c}`, name: b.n, state: b.s, lat: b.lat, lng: b.lng, lead: b.lead,
    dim: openAt(b.h, clock) === false })), [shown, clock]);
  const left = useMemo(() => (m?.data.businesses || []).filter(b => (!camp || b.c === camp) && isOpen(b.s)).length, [m, camp]);

  const open = useMemo(() => {
    if (!openId || !m) return null;
    const [bid, cid] = openId.split('|');
    const b = m.data.businesses.find(x => x.id === bid && (!cid || x.c === cid)) || null;
    const campaign = cid || b?.c;
    return campaign ? { id: bid, b, campaign } : null;
  }, [openId, m]);

  // nearest one still to visit (open now first, when hours are known)
  const goNearest = useCallback(async (from?: { lat: number; lng: number } | null, skip: string[] = []) => {
    const here = from || await hereNow();
    if (!here) { toast('Your location isn’t available. Allow location for MainstreetAI.'); return; }
    const todo = (m?.data.businesses || []).filter(b => (!camp || b.c === camp) && isOpen(b.s));
    const pool = todo.filter(b => openAt(b.h) !== false);
    const n = nearest(here, (pool.length ? pool : todo).map(b => ({ ...b, id: `${b.id}|${b.c}` })), skip);
    if (!n) { toast('Nothing left to visit. Nice work.'); return; }
    mapRef.current?.flyTo(n.item);
    return n;
  }, [m, camp, toast]);

  const onSaved = useCallback((v: SavedVisit) => {
    const cid = open?.campaign;
    setM(cur => cur && { ...cur, data: { ...cur.data, businesses: cur.data.businesses.map(b => (b.id === v.business && b.c === cid ? { ...b, s: v.state, at: new Date().toISOString() } : b)) } });
    setOpen(null);
    // the next one, from where they're standing
    if (v.here) {
      setTimeout(async () => {
        const n = await goNearest(v.here, [`${v.business}|${cid}`]);
        if (n) toast({ msg: `Next: ${n.item.n} · ${distLabel(n.m)}`, actions: [{ label: 'Open', onClick: () => setOpen(n.item.id) }] });
      }, 1200);
    }
  }, [open, goNearest, toast]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <DayBar />
      <div className="v2-rep-bar2 v2-rep-filters">
        <div className="v2-rep-seg">
          <button type="button" className={show === 'open' ? 'on' : ''} onClick={() => setShow('open')}>To visit{m ? ` ${left}` : ''}</button>
          <button type="button" className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All</button>
        </div>
        <button type="button" className={`v2-rep-pill${openNow ? ' on' : ''}`} onClick={() => setOpenNow(v => !v)} aria-pressed={openNow}>Open now</button>
        {campaigns.length > 1 && campaigns.map(c => (
          <button key={c.id} type="button" className={`v2-rep-pill${camp === c.id ? ' on' : ''}`} onClick={() => setCamp(camp === c.id ? null : c.id)}>
            <i style={{ background: c.color }} />{c.name}</button>))}
      </div>
      {m?.cached && <div className="v2-rep-note" style={{ margin: 0, borderRadius: 0 }}>No signal: showing your map from {new Date(m.at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}.</div>}
      <ErrorBox error={!m ? error : null} />
      {!m && !error ? <Loading label="Loading your zones…" /> : m && (
        m.data.pairs.length === 0 && m.data.businesses.length === 0
          ? <div className="v2-rep-body"><div className="v2-rep-zone"><b>No zones yet.</b><div className="v2-mut v2-small">Your admin assigns your zones. They’ll show here.</div></div></div>
          : (
            <RepMapView ref={mapRef} zones={zones} pins={pins} fitKey={zones.map(z => z.id).join(',')} showCounts={!adding?.pick}
              onPick={id => setOpen(id)}
              onMapTap={adding?.pick ? p => setAdding({ at: p }) : null}>
              {adding?.pick
                ? <div className="v2-rep-pickbar"><Crosshair size={16} /> Tap where the business is<button type="button" onClick={() => setAdding(null)}>Cancel</button></div>
                : (
                  <div className="v2-rep-fabs">
                    <button type="button" className="v2-rep-fab" onClick={async () => { const n = await goNearest(); if (n) setOpen(n.item.id); }}>
                      <Navigation size={18} />Nearest</button>
                    <button type="button" className="v2-rep-fab dark" onClick={() => setAdding({})} aria-label="Add a business"><Plus size={20} />Add</button>
                  </div>)}
            </RepMapView>))}
      {open && (
        <BusinessSheet key={openId} id={open.id} campaign={open.campaign}
          fallback={open.b ? { id: open.b.id, name: open.b.n, address: open.b.a, kind: open.b.k, lat: open.b.lat, lng: open.b.lng, hours: open.b.h, lead: open.b.lead } : null}
          onClose={() => setOpen(null)} onSaved={onSaved} />)}
      {adding && !adding.pick && m && (
        <AddLead campaigns={campaigns} at={adding.at || null}
          onPick={() => setAdding({ pick: true })} onClose={() => setAdding(null)}
          onAdded={(biz, campaign) => {
            setAdding(null);
            setM(cur => cur && { ...cur, data: { ...cur.data, businesses: [...cur.data.businesses, biz] } });
            mapRef.current?.flyTo(biz);
            setOpen(`${biz.id}|${campaign}`);
          }} />)}
    </>
  );
};

// ───────────── start / end the day ─────────────
const DayBar: React.FC = () => {
  const { today, setToday, queue, flushNow, toast } = useRep();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<RepToday | null>(null);
  const waiting = queue.filter(q => !q.error).length;
  const failed = queue.filter(q => q.error).length;
  const on = !!today?.started_at && !today.ended_at;
  const act = async (start: boolean) => {
    setBusy(true);
    try {
      const here = await hereNow(6000);
      if (start) { setToday(await dayStart(here)); toast('Day started. Good luck out there.'); }
      else { const t = await dayEnd(here); setToday(t); setSummary(t); }
    } catch (e) { toast(e instanceof Error ? e.message : 'That didn’t go through. Check your signal.'); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div className="v2-rep-day">
        {!today ? <span className="v2-mut">…</span> : on ? (
          <>
            <span className="live" />
            <div className="t"><b>{hoursLabel(today.minutes)}</b> · {today.visits}/{today.goal_visits} visits{today.deals ? ` · ${today.deals} deal${today.deals === 1 ? '' : 's'}` : ''}{today.distance_m >= 100 ? ` · ${distLabel(today.distance_m)}` : ''}</div>
            <button type="button" className="end" disabled={busy} onClick={() => act(false)}><Square size={13} />End day</button>
          </>
        ) : today.ended_at ? (
          <>
            <div className="t">Day done: <b>{hoursLabel(today.minutes)}</b> · {today.visits} visits</div>
            <button type="button" className="start" disabled={busy} onClick={() => act(true)}><Play size={13} />Back on</button>
          </>
        ) : (
          <>
            <div className="t">{today.visits ? `${today.visits} visits today` : 'Ready when you are'}</div>
            <button type="button" className="start" disabled={busy} onClick={() => act(true)}><Play size={13} />Start day</button>
          </>)}
      </div>
      {(waiting > 0 || failed > 0) && (
        <button type="button" className="v2-rep-wait" onClick={flushNow}>
          {waiting > 0 && <>{waiting} waiting to send · tap to try now</>}{waiting > 0 && failed > 0 && ' · '}{failed > 0 && <>{failed} couldn’t send: see Me</>}
        </button>)}
      {summary && (
        <div className="v2-rep-sheet-bg" onClick={() => setSummary(null)}>
          <div className="v2-rep-sheet" role="dialog" aria-label="Your day" onClick={e => e.stopPropagation()}>
            <h2>Your day</h2>
            <div className="v2-rep-stat" style={{ marginTop: 12 }}>
              <div><b>{hoursLabel(summary.minutes)}</b><span>Out</span></div>
              <div><b>{summary.visits}</b><span>Visits (goal {summary.goal_visits})</span></div>
              <div><b>{summary.deals}</b><span>Deals (goal {summary.goal_deals})</span></div>
              <div><b>{summary.followups}</b><span>Follow-ups set</span></div>
              <div><b>{distLabel(summary.distance_m)}</b><span>Walked</span></div>
              <div><b>{summary.minutes ? (summary.visits / (summary.minutes / 60)).toFixed(1) : '0'}</b><span>Visits an hour</span></div>
            </div>
            <div className="v2-small v2-mut" style={{ marginBottom: 12 }}>{summary.visits >= summary.goal_visits ? 'You hit your visit goal today.' : `${summary.goal_visits - summary.visits} short of the visit goal.`}</div>
            <Btn onClick={() => setSummary(null)} style={{ width: '100%', justifyContent: 'center' }}>Done</Btn>
          </div>
        </div>)}
    </>
  );
};

// ───────────── a business that isn't on the map ─────────────
const AddLead: React.FC<{
  campaigns: { id: string; name: string; color: string }[]; at: { lat: number; lng: number } | null;
  onPick: () => void; onClose: () => void; onAdded: (b: MapBiz, campaign: string) => void;
}> = ({ campaigns, at, onPick, onClose, onAdded }) => {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [campaign, setCampaign] = useState(campaigns[0]?.id || '');
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(at);
  const [hits, setHits] = useState<{ lat: number; lng: number; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const near = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => { hereNow(5000).then(p => { near.current = p; }); }, []);
  useEffect(() => { if (at) { setPoint(at); reverseGeocode(at).then(a => { if (a) setAddress(a); }); } }, [at]);

  const here = async () => {
    setBusy(true); setError(null);
    const p = await hereNow();
    setBusy(false);
    if (!p) { setError(new Error('Your location isn’t available. Type the address or tap the map.')); return; }
    setPoint(p); setHits([]);
    const a = await reverseGeocode(p); if (a) setAddress(a);
  };
  const look = async () => {
    setError(null);
    try { const h = await geocode(address, near.current); setHits(h); if (!h.length) setError(new Error('No match. Try the street number and name, or tap the map.')); }
    catch (e) { setError(e); }
  };
  const save = async () => {
    if (!point) { setError(new Error('Where is it? Use your location, look up the address, or tap the map.')); return; }
    setBusy(true); setError(null);
    try {
      const r = await addLead({ name: name.trim(), kind, address, lat: point.lat, lng: point.lng, phone, campaign });
      onAdded({ id: r.id, n: name.trim(), a: address || undefined, lat: point.lat, lng: point.lng, k: kind, z: r.zone_id || undefined, c: r.campaign_id, lead: true, s: 'new' }, r.campaign_id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <div className="v2-rep-sheet-bg" onClick={onClose}>
      <div className="v2-rep-sheet" role="dialog" aria-label="Add a business" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center' }}><h2 style={{ flex: 1 }}>Add a business</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="v2-rep-x"><X size={20} /></button></div>
        <div className="v2-small v2-mut" style={{ marginBottom: 10 }}>For one that isn’t on the map. It counts for you right away; an admin only checks it isn’t a duplicate.</div>
        <Field label="Business name"><input className="v2-input" autoFocus value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></Field>
        <Field label="What kind">
          <div className="v2-rep-kinds">
            {BUSINESS_KINDS.map(k => <button key={k.key} type="button" className={`v2-rep-pill${kind === k.key ? ' on' : ''}`} onClick={() => setKind(k.key)}>{k.label}</button>)}
          </div>
        </Field>
        <Field label="Where">
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="v2-input" placeholder="Street address" value={address} onChange={e => { setAddress(e.target.value); setHits([]); }}
              onKeyDown={e => { if (e.key === 'Enter') look(); }} autoComplete="off" />
            <Btn kind="o" onClick={look} disabled={!address.trim()}>Find</Btn>
          </div>
        </Field>
        {hits.length > 0 && (
          <div className="v2-rep-hits">{hits.map(h => (
            <button key={h.label} type="button" onClick={() => { setPoint(h); setAddress(h.label); setHits([]); }}>{h.label}</button>))}</div>)}
        <div className="v2-rep-acts" style={{ margin: '0 0 6px' }}>
          <button type="button" onClick={here} disabled={busy}><LocateFixed size={15} />I’m here</button>
          <button type="button" onClick={onPick}><Crosshair size={15} />Tap the map</button>
        </div>
        {point && <div className="v2-small" style={{ color: '#15803d', marginBottom: 6 }}>Pin set{address ? `: ${address}` : ''}</div>}
        <Field label="Phone (optional)"><input className="v2-input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="off" /></Field>
        {campaigns.length > 1 && (
          <Field label="Campaign">
            <div className="v2-rep-kinds">{campaigns.map(c => <button key={c.id} type="button" className={`v2-rep-pill${campaign === c.id ? ' on' : ''}`} onClick={() => setCampaign(c.id)}><i style={{ background: c.color }} />{c.name}</button>)}</div>
          </Field>)}
        <ErrorBox error={error} />
        <Btn onClick={save} disabled={busy || !name.trim() || !kind} style={{ width: '100%', justifyContent: 'center', background: '#0f766e', borderColor: '#0f766e' }}>
          {busy ? 'Adding…' : 'Add it and log a visit'}</Btn>
      </div>
    </div>
  );
};
