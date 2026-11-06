// src/v2/features/rep/HomeMap.tsx — the rep's home: one map of every zone they're assigned and the businesses
// reps have added there. Filter (to visit, campaign) and add a business at the door. Opens from the phone's copy
// with no signal. (Start / end the day, Nearest, Open now and roads walked were taken out: they leaned on the
// preloaded city businesses and the day's location tracking.)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Crosshair, LocateFixed, Plus, X } from 'lucide-react';
import {
  addLead, geocode, hereNow, withUnit, hitForTyped, isOpen, pinMatchesAddress, repMap, reverseGeocode, stagePin,
  type MapBiz, type RepMap,
} from '../../lib/rep';
import { BUSINESS_KINDS, kindLabel } from '../../lib/msCity';
import { knownNear, mapPlaces, nearbyAdded, type KnownBiz, type MapPlace, type NearbyBiz } from '../../lib/msField';
import { cacheGet, cacheSet } from '../../lib/repQueue';
import { Btn, ErrorBox, Field, Loading } from '../../ui';
import { BusinessSheet, type SavedVisit } from './BusinessSheet';
import { LocationBanner } from './LocationBanner';
import { RepMapView, type MapPin, type MapZone, type RepMapHandle } from './RepMapView';
import { useRep } from './repContext';

type Loaded = { data: RepMap; at: number; cached: boolean };
async function loadMap(): Promise<Loaded> {
  try { const data = await repMap(); cacheSet('map', data); return { data, at: Date.now(), cached: false }; }
  catch (e) { const c = await cacheGet<RepMap>('map'); if (c) return { data: c.data, at: c.at, cached: true }; throw e; }
}

export const HomeMap: React.FC = () => {
  const { mapTick } = useRep();
  const [m, setM] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { let live = true; loadMap().then(r => { if (live) { setM(r); setError(null); } }).catch(e => { if (live) setError(e); }); return () => { live = false; }; }, [mapTick]);

  const [sp, setSp] = useSearchParams();
  const openId = sp.get('b');
  const setOpen = (id: string | null) => { const n = new URLSearchParams(sp); if (id) n.set('b', id); else n.delete('b'); setSp(n, { replace: !id }); };
  const [show, setShow] = useState<'open' | 'all'>('open');
  // businesses changed here stay on the map in their new colour (a Lost one doesn't just vanish from To visit)
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [camp, setCamp] = useState<string | null>(null);
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
    (!camp || b.c === camp) && (show === 'all' || isOpen(b.s) || touched.has(`${b.id}|${b.c}`))), [m, camp, show, touched]);
  const pins: MapPin[] = useMemo(() => shown.map(b => ({ id: `${b.id}|${b.c}`, name: b.n, state: stagePin(b.st, b.s), fu: b.s === 'follow_up', lat: b.lat, lng: b.lng, lead: b.lead })), [shown]);
  const left = useMemo(() => (m?.data.businesses || []).filter(b => (!camp || b.c === camp) && isOpen(b.s)).length, [m, camp]);

  const open = useMemo(() => {
    if (!openId || !m) return null;
    const [bid, cid] = openId.split('|');
    const b = m.data.businesses.find(x => x.id === bid && (!cid || x.c === cid)) || null;
    const campaign = cid || b?.c;
    return campaign ? { id: bid, b, campaign } : null;
  }, [openId, m]);

  // no zones and nothing added yet: there's nothing to fit the map to, so start it where the rep is
  const located = useRef(false);
  useEffect(() => {
    if (!m || located.current || m.data.pairs.length || m.data.businesses.length) return;
    located.current = true;
    hereNow().then(p => { if (p) mapRef.current?.flyTo(p, 15); }).catch(() => {});
  }, [m]);

  const onSaved = useCallback((v: SavedVisit) => {
    const cid = open?.campaign;
    // the pin changes as soon as the visit is saved: Not interested is Lost, a booking is Booked, the rest keep their stage
    setTouched(t => new Set(t).add(`${v.business}|${cid}`));
    const st = (cur?: string) => (v.outcome === 'not_interested' ? 'lost' : v.outcome === 'closed' ? 'booked' : cur);
    setM(cur => cur && { ...cur, data: { ...cur.data, businesses: cur.data.businesses.map(b => (b.id === v.business && b.c === cid
      ? { ...b, s: v.state, st: st(b.st), f: v.outcome === 'follow_up' ? b.f || new Date().toISOString() : undefined, at: new Date().toISOString() } : b)) } });
    setOpen(null);
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  const onStage = useCallback((stage: string) => {
    const cid = open?.campaign, bid = open?.id;
    setM(cur => cur && { ...cur, data: { ...cur.data, businesses: cur.data.businesses.map(b => (b.id === bid && b.c === cid ? { ...b, st: stage } : b)) } });
  }, [open]);

  return (
    <>
      <SendQueue />
      <LocationBanner />
      <div className="v2-rep-bar2 v2-rep-filters">
        <div className="v2-rep-seg">
          <button type="button" className={show === 'open' ? 'on' : ''} onClick={() => setShow('open')}>To visit{m ? ` ${left}` : ''}</button>
          <button type="button" className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All</button>
        </div>
        {campaigns.length > 1 && campaigns.map(c => (
          <button key={c.id} type="button" className={`v2-rep-pill${camp === c.id ? ' on' : ''}`} onClick={() => setCamp(camp === c.id ? null : c.id)}>
            <i style={{ background: c.color }} />{c.name}</button>))}
      </div>
      {m?.cached && <div className="v2-rep-note" style={{ margin: 0, borderRadius: 0 }}>No signal: showing your map from {new Date(m.at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}.</div>}
      <ErrorBox error={!m ? error : null} />
      {!m && !error ? <Loading label="Loading your zones…" /> : m && (
        <>
          {m.data.pairs.length === 0 && <div className="v2-rep-note" style={{ margin: 0, borderRadius: 0 }}><b>No zones yet.</b> Your admin assigns your zones; until then you can still add businesses you find.</div>}
            <RepMapView ref={mapRef} zones={zones} pins={pins} fitKey={zones.map(z => z.id).join(',')} showCounts={!adding?.pick}
              onPick={id => setOpen(id)}
              onMapTap={adding?.pick ? p => setAdding({ at: p }) : null}>
              {adding?.pick
                ? <div className="v2-rep-pickbar"><Crosshair size={16} /> Tap where the business is<button type="button" onClick={() => setAdding(null)}>Cancel</button></div>
                : (
                  <div className="v2-rep-fabs">
                    <button type="button" className="v2-rep-fab dark" onClick={() => setAdding({})} aria-label="Add a business"><Plus size={20} />Add</button>
                  </div>)}
            </RepMapView>
        </>)}
      {open && (
        <BusinessSheet key={openId} id={open.id} campaign={open.campaign}
          fallback={open.b ? { id: open.b.id, name: open.b.n, address: open.b.a, kind: open.b.k, lat: open.b.lat, lng: open.b.lng, hours: open.b.h, lead: open.b.lead } : null}
          onClose={() => setOpen(null)} onSaved={onSaved} onStage={onStage}
          onGone={() => { const cid = open.campaign; setM(cur => cur && { ...cur, data: { ...cur.data, businesses: cur.data.businesses.filter(b => !(b.id === open.id && b.c === cid)) } }); setOpen(null); }} />)}
      {adding && !adding.pick && m && (
        <AddLead campaigns={campaigns} at={adding.at || null}
          onOpen={id => { const b = m.data.businesses.find(x => x.id === id); if (!b) return false; setAdding(null); setOpen(`${b.id}|${b.c}`); return true; }}
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

// ───────────── visits still on the phone ─────────────
const SendQueue: React.FC = () => {
  const { queue, flushNow } = useRep();
  const waiting = queue.filter(q => !q.error).length;
  const failed = queue.filter(q => q.error).length;
  if (!waiting && !failed) return null;
  return (
    <button type="button" className="v2-rep-wait" onClick={flushNow}>
      {waiting > 0 && <>{waiting} waiting to send · tap to try now</>}{waiting > 0 && failed > 0 && ' · '}{failed > 0 && <>{failed} couldn’t send: see Me</>}
    </button>
  );
};

// ───────────── add a business: where the rep is standing ─────────────
// Opens on the rep's GPS: the street address, businesses already added within 60 m (open one instead of adding it
// twice), and business names from map data at that spot to tap. Or type the name.
// The pin and the address box are kept honest with each other: the form says where the pin is, and if the rep types
// an address (say, adding a business over the phone) and adds it without picking a Find result, the address is looked
// up and the business goes there, never quietly where the rep is standing.
const AddLead: React.FC<{
  campaigns: { id: string; name: string; color: string }[]; at: { lat: number; lng: number } | null;
  onPick: () => void; onClose: () => void; onAdded: (b: MapBiz, campaign: string) => void; onOpen: (id: string) => boolean;
}> = ({ campaigns, at, onPick, onClose, onAdded, onOpen }) => {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [address, setAddress] = useState('');
  const [unit, setUnit] = useState('');   // unit / suite: kept out of the map lookup, saved in front of the address
  const [phone, setPhone] = useState('');
  const [campaign, setCampaign] = useState(campaigns[0]?.id || '');
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(at);
  // where the pin came from, and the address it's for (so we can tell when the address box no longer matches it)
  const [pinFrom, setPinFrom] = useState<'gps' | 'map' | 'address' | 'place'>(at ? 'map' : 'gps');
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [hits, setHits] = useState<{ lat: number; lng: number; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(!at);
  const [error, setError] = useState<unknown>(null);
  const [added, setAdded] = useState<NearbyBiz[]>([]);
  const [places, setPlaces] = useState<MapPlace[]>([]);
  const [known, setKnown] = useState<KnownBiz[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const near = useRef<{ lat: number; lng: number } | null>(null);

  // what's at a spot (where the rep is, a tap on the map, or a looked-up address): its address, what's already been
  // added, the businesses we already know there, and names from map data
  const lookAround = useCallback(async (p: { lat: number; lng: number }, keepAddress = false) => {
    setPoint(p); setHits([]);
    if (!keepAddress) setPinFor(null);
    const [a, ad, kn, pl] = await Promise.all([keepAddress ? Promise.resolve(null) : reverseGeocode(p), nearbyAdded(p).catch(() => []), knownNear(p).catch(() => []), mapPlaces(p)]);
    if (a) { setAddress(a); setPinFor(a); }
    setAdded(ad.filter(x => x.m <= 60));
    // a name already added here isn't offered again
    const have = new Set(ad.map(x => x.name.toLowerCase()));
    const k = kn.filter(x => !have.has(x.name.toLowerCase()));
    setKnown(k);
    for (const x of k) have.add(x.name.toLowerCase());
    setPlaces(pl.filter(x => !have.has(x.name.toLowerCase())));
  }, []);
  useEffect(() => {
    if (at) { lookAround(at); return; }
    let live = true;
    hereNow(8000).then(p => {
      if (!live) return;
      setLocating(false); near.current = p;
      if (p) { setPinFrom('gps'); lookAround(p); } else setError(new Error('Your location isn’t available. Type the address or tap the map.'));
    });
    return () => { live = false; };
  }, [at, lookAround]);

  const here = async () => {
    setBusy(true); setError(null);
    const p = await hereNow();
    setBusy(false);
    if (!p) { setError(new Error('Your location isn’t available. Type the address or tap the map.')); return; }
    near.current = p; setPinFrom('gps'); lookAround(p);
  };
  const chooseHit = (h: { lat: number; lng: number; label: string }) => {
    setAddress(h.label); setPinFor(h.label); setPinFrom('address'); setPicked(null); lookAround(h, true);
  };
  const addressMoved = !pinMatchesAddress(address, pinFor);
  const look = async () => {
    setError(null);
    try { const h = await geocode(address, near.current || point); setHits(h); if (!h.length) setError(new Error('No match. Try the street number and name, or tap the map.')); }
    catch (e) { setError(e); }
  };
  const pickKnown = (x: KnownBiz) => {
    setPicked(x.id); setName(x.name);
    if (x.kind && BUSINESS_KINDS.some(k => k.key === x.kind)) setKind(x.kind);
    if (x.address) setAddress(x.address);
    if (x.phone) setPhone(x.phone);
    setPoint({ lat: x.lat, lng: x.lng });   // its own spot, so adding it makes this one theirs instead of a copy
    setPinFrom('place'); setPinFor(x.address || address);
  };
  const pickPlace = (x: MapPlace) => {
    setPicked(x.name); setName(x.name);
    if (x.kind) setKind(x.kind);
    // keep a street address that came with the pin; one the rep typed himself still gets looked up when he adds it
    if (!addressMoved) {
      const next = address && /^\d/.test(address) ? address : x.address || address;
      setAddress(next); setPinFor(next);
    }
    setPoint({ lat: x.lat, lng: x.lng }); setPinFrom('place');
  };
  const openAdded = (x: NearbyBiz) => {
    if (onOpen(x.id)) return;
    setNote(`${x.name} is already on the map, but not in your zones. Ask an admin if it should be yours.`);
  };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      let p = point, addr = address;
      if (addressMoved) {   // the rep typed an address that isn't where the pin is: put it at that address
        const h = await geocode(address, near.current || point);
        const pick = hitForTyped(address, h);
        if (!pick) {
          setHits(h);
          setError(new Error(h.length ? 'Which one is it? Pick the address below, then tap Add it.' : 'Couldn’t find that address. Check it, or tap the map where the business is.'));
          return;
        }
        p = { lat: pick.lat, lng: pick.lng }; addr = pick.label;
        setPoint(p); setAddress(addr); setPinFor(addr); setPinFrom('address');
      }
      if (!p) { setError(new Error('Where is it? Use your location, look up the address, or tap the map.')); return; }
      const full = withUnit(unit, addr);
      const r = await addLead({ name: name.trim(), kind, address: full, lat: p.lat, lng: p.lng, phone, campaign });
      onAdded({ id: r.id, n: name.trim(), a: full || undefined, lat: p.lat, lng: p.lng, k: kind, z: r.zone_id || undefined, c: r.campaign_id, lead: true, s: 'new' }, r.campaign_id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const pinLabel = pinFrom === 'gps' ? 'where you are' : pinFrom === 'map' ? 'where you tapped' : pinFrom === 'place' ? (name || 'the business you picked') : 'the address';
  return (
    <div className="v2-rep-sheet-bg" onClick={onClose}>
      <div className="v2-rep-sheet" role="dialog" aria-label="Add a business" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center' }}><h2 style={{ flex: 1 }}>Add a business</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="v2-rep-x"><X size={20} /></button></div>
        <div className="v2-small" style={{ margin: '4px 0 10px', display: 'flex', gap: 6, alignItems: 'center' }}>
          <LocateFixed size={15} style={{ color: '#2563eb', flexShrink: 0 }} />
          {locating ? <span className="v2-mut">Finding where you are…</span>
            : !point ? <span className="v2-mut">No pin yet: type the address, use where you are, or tap the map</span>
            : <span>Pin: <b>{pinFor || (pinFrom === 'gps' ? 'where you are' : 'this spot')}</b>{pinFrom === 'gps' && pinFor ? ' (where you are)' : pinFrom === 'map' && pinFor ? ' (where you tapped)' : ''}</span>}
        </div>
        {point && addressMoved && (
          <div className="v2-add-dup">
            <span style={{ flex: 1 }}><b>The pin is {pinLabel}, not the address you typed.</b> Adding it puts the business at the address. Tap Find to check it first.</span>
          </div>)}
        {added.map(x => (
          <div key={x.id} className="v2-add-dup">
            <span style={{ flex: 1 }}><b>{x.dnk ? 'Do not knock' : 'Already added'} {x.m} m away:</b> {x.name}{x.by ? `, by ${x.by}` : ''}</span>
            {!x.dnk && <button type="button" onClick={() => openAdded(x)}>Open it</button>}
          </div>))}
        {note && <div className="v2-rep-note" style={{ marginTop: 0, marginBottom: 8 }}>{note}</div>}
        {known.length > 0 && <>
          <div className="v2-rep-label">Businesses here</div>
          <div className="v2-add-near">
            {known.map(x => (
              <button key={x.id} type="button" className={`opt${picked === x.id ? ' on' : ''}`} onClick={() => pickKnown(x)}>
                <span className="ic">{x.name.slice(0, 1).toUpperCase()}</span>
                <span className="t"><b>{x.name}</b>{[kindLabel(x.kind), x.address?.split(',')[0], `${x.m} m`].filter(Boolean).join(' · ')}</span>
              </button>))}
          </div>
        </>}
        {places.length > 0 && <>
          <div className="v2-rep-label">{known.length ? 'Or one of these?' : 'Is it one of these?'}</div>
          <div className="v2-add-near">
            {places.map(x => (
              <button key={x.name + x.lat} type="button" className={`opt${picked === x.name ? ' on' : ''}`} onClick={() => pickPlace(x)}>
                <span className="ic">{x.name.slice(0, 1).toUpperCase()}</span>
                <span className="t"><b>{x.name}</b>{[x.kind ? kindLabel(x.kind) : x.category.split(',')[0], x.address, `${x.m} m`].filter(Boolean).join(' · ')}</span>
              </button>))}
            <button type="button" className="opt" onClick={() => { setPicked(null); setName(''); nameRef.current?.focus(); }}>
              <span className="ic">+</span><span className="t"><b>Not listed</b>Type the name below</span></button>
          </div>
        </>}
        <Field label="Business name"><input ref={nameRef} className="v2-input" value={name} onChange={e => { setName(e.target.value); setPicked(null); }} autoComplete="off" /></Field>
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
          <input className="v2-input" placeholder="Unit / suite (optional)" aria-label="Unit or suite" value={unit} onChange={e => setUnit(e.target.value)}
            autoComplete="off" style={{ marginTop: 6, maxWidth: 220 }} />
        </Field>
        {hits.length > 0 && (
          <div className="v2-rep-hits">{hits.map(h => (
            <button key={h.label} type="button" onClick={() => chooseHit(h)}>{h.label}</button>))}</div>)}
        <div className="v2-rep-acts" style={{ margin: '0 0 6px' }}>
          <button type="button" onClick={here} disabled={busy}><LocateFixed size={15} />Use where I am</button>
          <button type="button" onClick={onPick}><Crosshair size={15} />Tap the map</button>
        </div>
        <Field label="Phone (optional)"><input className="v2-input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="off" /></Field>
        {campaigns.length > 1 && (
          <Field label="Campaign">
            <div className="v2-rep-kinds">{campaigns.map(c => <button key={c.id} type="button" className={`v2-rep-pill${campaign === c.id ? ' on' : ''}`} onClick={() => setCampaign(c.id)}><i style={{ background: c.color }} />{c.name}</button>)}</div>
          </Field>)}
        <ErrorBox error={error} />
        <Btn onClick={save} disabled={busy || !name.trim() || !kind || (!point && !address.trim())} style={{ width: '100%', justifyContent: 'center', background: '#0f766e', borderColor: '#0f766e' }}>
          {busy ? 'Adding…' : 'Add it'}</Btn>
        <div className="v2-small v2-mut" style={{ marginTop: 8 }}>It opens next, ready for their cards, the deck or the visit.</div>
      </div>
    </div>
  );
};
