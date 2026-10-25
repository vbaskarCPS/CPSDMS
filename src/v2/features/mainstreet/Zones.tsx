// src/v2/features/mainstreet/Zones.tsx — MainstreetAI › Zones: the list of knock zones beside the map.
// Draw a zone (click corners, double-click or Finish to close), name it, and the map fills in its
// City/Area. Pick a zone to put campaigns on it and give each campaign a rep.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MbMap, MapMouseEvent } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Archive, ArchiveRestore, Check, Pencil, Plus, Search, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLoad } from '../../lib/data';
import {
  acceptRun, assignRep, closeRing, runToReady, stepLabel, type StepState, deleteZone, discardRun, filterZones, generateZones, listCampaigns, listReps, listRuns, listZones, mergeProposed, placeAt, placeLabel,
  polygonProblem, proposalFeatures, saveZone, setZoneCampaigns, setZoneStatus, zoneColor, zoneFeatures, type Zone, type ZoneFilter, type ZoneRun,
} from '../../lib/mainstreet';
import { listCampaignCategories, listCities, type City } from '../../lib/msCity';
import { Btn, ErrorBox, Field, Loading, Modal, Tag } from '../../ui';
import { coordsOf, createZonesMap, drawFeatures, fit, removeMap, setSource } from './msMap';

type Draft = { id: string | null; name: string; corners: [number, number][]; city: string | null; area: string | null } | null;

export const Zones: React.FC = () => {
  const zones = useLoad(listZones, []);
  const campaigns = useLoad(listCampaigns, []);
  const reps = useLoad(listReps, []);
  const [filter, setFilter] = useState<ZoneFilter>('all');
  const [showRetired, setShowRetired] = useState(false);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // generated zones: the cities, and a proposal under review
  const cities = useLoad(listCities, []);
  const [genOpen, setGenOpen] = useState(false);
  const [review, setReview] = useState<{ city: City; run: ZoneRun; picked: number[] } | null>(null);
  const [progress, setProgress] = useState<StepState | null>(null);

  const all = zones.data || [];
  const shown = useMemo(() => filterZones(all, filter, showRetired, q), [all, filter, showRetired, q]);
  const selected = all.find(z => z.id === picked) || null;
  const activeCampaigns = (campaigns.data || []).filter(c => c.is_active);
  const activeReps = (reps.data || []).filter(r => r.is_active);

  // ── the map ──
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MbMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const draftRef = useRef<Draft>(null); draftRef.current = draft;
  const pickRef = useRef(setPicked); pickRef.current = setPicked;
  const pickPropRef = useRef<(k: number) => void>(() => {});
  pickPropRef.current = (k: number) => setReview(r => r ? { ...r, picked: r.picked.includes(k) ? r.picked.filter(x => x !== k) : [...r.picked, k].slice(-2) } : r);
  useEffect(() => {
    if (!box.current || map.current) return;
    map.current = createZonesMap(box.current, m => {
      m.on('click', (e: MapMouseEvent) => {
        if (draftRef.current) {   // drawing: every click is a corner
          const c: [number, number] = [+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)];
          setDraft(d => d ? { ...d, corners: [...d.corners, c] } : d);
          return;
        }
        const pf = m.queryRenderedFeatures(e.point, { layers: ['ms-prop-fill'] })[0];
        if (pf?.properties?.key != null) { pickPropRef.current(Number(pf.properties.key)); return; }
        const f = m.queryRenderedFeatures(e.point, { layers: ['ms-zone-fill'] })[0];
        pickRef.current(f?.properties?.id ? String(f.properties.id) : null);
      });
      m.on('dblclick', () => { if (draftRef.current && draftRef.current.corners.length >= 3) setNaming(true); });
      m.on('mousemove', 'ms-zone-fill', () => { if (!draftRef.current) m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'ms-zone-fill', () => { if (!draftRef.current) m.getCanvas().style.cursor = ''; });
      setReady(true);
    }, setFailed);
    return () => { removeMap(map.current); map.current = null; setReady(false); };
  }, []);
  // shapes: the zones (the one being redrawn hidden), then fit once
  const fitted = useRef(false);
  useEffect(() => {
    if (!ready) return;
    const list = shown.filter(z => z.id !== draft?.id);
    const f = zoneFeatures(list, picked);
    setSource(map.current, 'ms-zones', f.shapes); setSource(map.current, 'ms-labels', f.labels);
    if (!fitted.current && all.length) { fitted.current = true; fit(map.current, all.flatMap(z => coordsOf(z.polygon)), 13); }
  }, [ready, shown, picked, draft?.id, all]);
  useEffect(() => {
    if (!ready) return;
    const d = drawFeatures(draft?.corners || []);
    setSource(map.current, 'ms-draw', d.shape); setSource(map.current, 'ms-draw-pts', d.points);
    const canvas = map.current?.getCanvas(); if (canvas) canvas.style.cursor = draft ? 'crosshair' : '';
  }, [ready, draft]);
  useEffect(() => { if (selected && ready) fit(map.current, coordsOf(selected.polygon), 15); }, [picked]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready) return;
    const color = review ? ((campaigns.data || []).find(c => c.id === review.run.campaign_id)?.color || '#0d9488') : '#0d9488';
    const f = proposalFeatures(review?.run.proposal || [], color, review?.picked || []);
    setSource(map.current, 'ms-prop', f.shapes); setSource(map.current, 'ms-prop-labels', f.labels);
  }, [ready, review, campaigns.data]);
  const fittedRun = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !review || fittedRun.current === review.run.id) return;
    fittedRun.current = review.run.id;
    fit(map.current, review.run.proposal.flatMap(z => coordsOf(z.polygon)), 13);
  }, [ready, review]);

  // ── drawing ──
  const startDraw = (z: Zone | null) => {
    setError(null); setPicked(null);
    setDraft(z ? { id: z.id, name: z.name, corners: z.polygon.coordinates[0].slice(0, -1) as [number, number][], city: z.city, area: z.area }
              : { id: null, name: '', corners: [], city: null, area: null });
    if (z) fit(map.current, coordsOf(z.polygon), 15);
  };
  const undo = () => setDraft(d => d ? { ...d, corners: d.corners.slice(0, -1) } : d);
  const cancel = () => { setDraft(null); setNaming(false); };
  const finish = () => {
    if (!draft) return;
    const p = polygonProblem(draft.corners);
    if (p) { setError(new Error(p)); return; }
    setNaming(true);
  };
  const save = async (name: string) => {
    if (!draft) return;
    setBusy(true); setError(null);
    try {
      const poly = closeRing(draft.corners);
      // City/Area from the map, at a point inside the shape (the average corner is close enough)
      let { city, area } = draft;
      if (!city) {
        const c = draft.corners;
        const lng = c.reduce((s, p) => s + p[0], 0) / c.length, lat = c.reduce((s, p) => s + p[1], 0) / c.length;
        ({ city, area } = await placeAt(lng, lat).catch(() => ({ city: null, area: null })));
      }
      const id = await saveZone({ id: draft.id, name, polygon: poly, city, area });
      setDraft(null); setNaming(false); zones.reload(); setPicked(id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  // ── a proposal under review ──
  const reload = async (r: { city: City; run: ZoneRun; picked: number[] }) => {
    const runs = await listRuns(r.city.id); const run = runs.find(x => x.id === r.run.id);
    if (run) setReview({ ...r, run, picked: [] });
  };
  const doMerge = async () => {
    if (!review || review.picked.length !== 2) return;
    setBusy(true); setError(null);
    try { await mergeProposed(review.run.id, review.picked[0], review.picked[1]); await reload(review); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const doAccept = async () => {
    if (!review) return;
    setBusy(true); setError(null);
    try { const n = await acceptRun(review.run.id); setReview(null); zones.reload(); cities.reload(); setError(null); setQ(''); setFilter('all'); void n; }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  const doDiscard = async () => {
    if (!review) return;
    setBusy(true); setError(null);
    try { await discardRun(review.run.id); setReview(null); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const regenerate = async (target: number) => {
    if (!review) return;
    setBusy(true); setError(null);
    try {
      await discardRun(review.run.id);
      setProgress(null);
      const id = await generateZones(review.city.id, review.run.campaign_id, target);
      await runToReady(id, setProgress);
      const runs = await listRuns(review.city.id); const run = runs.find(x => x.id === id);
      if (run) setReview({ city: review.city, run, picked: [] });
    } catch (e) { setError(e); } finally { setBusy(false); setProgress(null); }
  };

  // ── the selected zone ──
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); zones.reload(); reps.reload(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const toggleCampaign = (z: Zone, cid: string) => {
    const have = z.campaigns.map(c => c.campaign_id);
    run(() => setZoneCampaigns(z.id, have.includes(cid) ? have.filter(x => x !== cid) : [...have, cid]));
  };

  return (
    <div className="v2-main v2-ms">
      <div className="v2-head">
        <span className="v2-h1">Zones</span>
        <span className="v2-spacer" />
        <span className="v2-mut v2-small">{all.filter(z => z.status === 'active').length} active · {all.filter(z => z.status === 'active' && z.campaigns.every(c => !c.rep_id)).length} without a rep</span>
        {!draft && !review && <Btn kind="o" icon={Plus} onClick={() => startDraw(null)}>Draw a zone</Btn>}
        {!draft && !review && <Btn icon={Sparkles} onClick={() => setGenOpen(true)}>Generate zones</Btn>}
      </div>
      <div className="v2-row" style={{ marginBottom: 12 }}>
        <button className={`v2-chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>All</button>
        <button className={`v2-chip${filter === 'unassigned' ? ' on' : ''}`} onClick={() => setFilter('unassigned')}>Unassigned</button>
        <select className="v2-select-pill" value={filter === 'all' || filter === 'unassigned' ? '' : filter} onChange={e => setFilter(e.target.value || 'all')} aria-label="Campaign">
          <option value="">Any campaign</option>
          {(campaigns.data || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="v2-chip" style={{ cursor: 'pointer' }}><input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} /> Show retired</label>
        <span className="v2-spacer" />
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#6b7280' }} />
          <input className="v2-input" style={{ paddingLeft: 30, width: 220 }} placeholder="Zone, place, campaign or rep" value={q} onChange={e => setQ(e.target.value)} aria-label="Search zones" />
        </div>
      </div>
      <ErrorBox error={error || zones.error || campaigns.error} />

      <div className="v2-split map">
        <div className="v2-card v2-ms-mapcard">
          {draft && (
            <div className="v2-ms-drawbar">
              <b>{draft.id ? `Redrawing ${draft.name}` : 'Drawing a zone'}</b>
              <span className="v2-mut v2-small">Click the map to add corners · {draft.corners.length} so far · double-click or Finish when the shape is closed</span>
              <span className="v2-spacer" />
              <Btn kind="o" size="sm" icon={Undo2} disabled={!draft.corners.length} onClick={undo}>Undo</Btn>
              <Btn kind="o" size="sm" icon={X} onClick={cancel}>Cancel</Btn>
              <Btn size="sm" icon={Check} disabled={draft.corners.length < 3} onClick={finish}>Finish</Btn>
            </div>
          )}
          <div ref={box} className="v2-ms-map" />
          {failed && <div className="v2-err" style={{ margin: 10 }}>{failed}</div>}
        </div>

        <div>
          {review ? (
            <ReviewPanel review={review} busy={busy} progress={busy && progress ? stepLabel(progress) : null} onMerge={doMerge} onAccept={doAccept} onDiscard={doDiscard} onRegenerate={regenerate}
              onPick={k => pickPropRef.current(k)} />
          ) : selected ? (
            <div className="v2-card">
              <div className="v2-row" style={{ marginBottom: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: zoneColor(selected), display: 'inline-block' }} />
                <b style={{ fontSize: 16 }}>{selected.name}</b>
                {selected.status === 'retired' && <Tag tone="a">Retired</Tag>}
                <span className="v2-spacer" />
                <button type="button" className="v2-gbtn" style={{ width: 30, height: 30 }} onClick={() => setPicked(null)} aria-label="Close"><X size={14} /></button>
              </div>
              <div className="v2-mut v2-small" style={{ marginBottom: 12 }}>
                {placeLabel(selected)} · {selected.frozen_at ? 'generated' : 'drawn'} {new Date(selected.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                {selected.business_count != null && <> · <b>{selected.business_count}</b> businesses</>}
                {selected.frozen_at && <> · <Tag tone="b">Frozen</Tag></>}
              </div>

              <div className="v2-label" style={{ marginBottom: 6 }}>Campaigns on this zone</div>
              {!activeCampaigns.length && <div className="v2-note">No campaigns yet. Add one under Campaigns.</div>}
              <div style={{ display: 'grid', gap: 8 }}>
                {activeCampaigns.map(c => {
                  const on = selected.campaigns.find(x => x.campaign_id === c.id);
                  return (
                    <div key={c.id} className="v2-ms-camp" style={{ borderLeftColor: c.color }}>
                      <label className="v2-row" style={{ cursor: 'pointer', gap: 8 }}>
                        <input type="checkbox" checked={!!on} disabled={busy || selected.status === 'retired'} onChange={() => toggleCampaign(selected, c.id)} />
                        <b>{c.name}</b>
                      </label>
                      {on && (
                        <select className="v2-sel" style={{ marginTop: 6 }} value={on.rep_id || ''} disabled={busy || selected.status === 'retired'}
                          onChange={e => run(() => assignRep(selected.id, c.id, e.target.value || null))} aria-label={`Rep for ${c.name}`}>
                          <option value="">No rep yet</option>
                          {activeReps.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
                          {on.rep_id && !activeReps.some(r => r.id === on.rep_id) && <option value={on.rep_id}>{on.rep_name} (inactive)</option>}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="v2-row" style={{ marginTop: 14, gap: 6 }}>
                {selected.status === 'active' ? <>
                  {!selected.frozen_at && <Btn kind="o" size="sm" icon={Pencil} disabled={busy} onClick={() => startDraw(selected)}>Redraw</Btn>}
                  <Btn kind="o" size="sm" icon={Archive} disabled={busy} onClick={() => run(() => setZoneStatus(selected.id, 'retired'))}>Retire</Btn>
                </> : <Btn kind="o" size="sm" icon={ArchiveRestore} disabled={busy} onClick={() => run(() => setZoneStatus(selected.id, 'active'))}>Bring back</Btn>}
                {!selected.campaigns.length && (
                  <Btn kind="r" size="sm" icon={Trash2} disabled={busy} onClick={() => { if (confirm(`Delete “${selected.name}”? This can’t be undone.`)) run(async () => { await deleteZone(selected.id); setPicked(null); }); }}>Delete</Btn>
                )}
              </div>
            </div>
          ) : (
            <div className="v2-card" style={{ padding: 0, overflow: 'hidden' }}>
              {zones.loading ? <Loading /> : !shown.length ? (
                <div className="v2-note" style={{ padding: 16 }}>{all.length ? 'No zones match.' : 'No zones yet. Draw the first one on the map.'}</div>
              ) : (
                <div className="v2-table-wrap"><table className="v2-table">
                  <thead><tr><th>Zone</th><th>City / Area</th><th>Businesses</th><th>Campaigns · rep</th><th>Created</th></tr></thead>
                  <tbody>
                    {shown.map(z => (
                      <tr key={z.id} className="click" onClick={() => setPicked(z.id)}>
                        <td><span className="v2-row" style={{ gap: 7, flexWrap: 'nowrap' }}>
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: zoneColor(z), flexShrink: 0 }} />
                          <b>{z.name}</b>{z.status === 'retired' && <Tag tone="a">Retired</Tag>}</span></td>
                        <td>{placeLabel(z)}</td>
                        <td>{z.business_count ?? <span className="v2-mut">—</span>}</td>
                        <td>{z.campaigns.length ? z.campaigns.map(c => (
                          <div key={c.campaign_id} className="v2-small"><span style={{ color: c.color, fontWeight: 700 }}>{c.name}</span> · {c.rep_name || <span className="v2-mut">no rep</span>}</div>
                        )) : <span className="v2-mut">—</span>}</td>
                        <td className="v2-mut v2-small">{new Date(z.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
          )}
        </div>
      </div>

      {naming && draft && (
        <NameZone initial={draft.name} busy={busy} error={error} onClose={() => setNaming(false)} onSave={save} />
      )}
      {genOpen && (
        <GenerateModal cities={cities.data || []} campaigns={activeCampaigns} onClose={() => setGenOpen(false)}
          onGenerated={(city, run) => { setGenOpen(false); setPicked(null); setReview({ city, run, picked: [] }); }} />
      )}
    </div>
  );
};

const GenerateModal: React.FC<{ cities: City[]; campaigns: { id: string; name: string }[]; onClose: () => void; onGenerated: (city: City, run: ZoneRun) => void }> =
  ({ cities, campaigns, onClose, onGenerated }) => {
    const built = cities.filter(c => c.status === 'built');
    const [cityId, setCityId] = useState(built[0]?.id || '');
    const [campaignId, setCampaignId] = useState(campaigns[0]?.id || '');
    const [target, setTarget] = useState(6);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [step, setStep] = useState<StepState | null>(null);
    const cats = useLoad(listCampaignCategories, []);
    const hasCats = !!(cats.data || []).some(c => c.campaign_id === campaignId);
    const city = built.find(c => c.id === cityId);
    const go = async () => {
      if (!city) return;
      setBusy(true); setError(null);
      try {
        setStep(null);
        const id = await generateZones(city.id, campaignId, target);
        await runToReady(id, setStep);
        const run = (await listRuns(city.id)).find(r => r.id === id);
        if (!run) throw new Error('Generated, but the proposal didn’t come back');
        onGenerated(city, run);
      } catch (e) { setError(e); } finally { setBusy(false); }
    };
    return (
      <Modal title="Generate zones" onClose={onClose} footer={<><Btn kind="o" onClick={onClose}>Cancel</Btn><Btn disabled={busy || !city || !campaignId || !hasCats} onClick={go}>{busy ? 'Working…' : 'Propose zones'}</Btn></>}>
        {!built.length ? <div className="v2-note">No city is built yet. <Link to="/app/mainstreet/cities" style={{ textDecoration: 'underline' }}>Build one first.</Link></div> : <>
          <Field label="City">
            <select className="v2-sel" value={cityId} onChange={e => setCityId(e.target.value)}>{built.map(c => <option key={c.id} value={c.id}>{c.name} · {c.eligible_open} eligible businesses</option>)}</select>
          </Field>
          <Field label="Campaign" hint={campaignId && cats.data && !hasCats ? 'This campaign has no business categories yet: set them under Campaigns › Edit.' : 'Only the campaign’s categories count; chains and closed places never do.'}>
            <select className="v2-sel" value={campaignId} onChange={e => setCampaignId(e.target.value)}>{campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
          <Field label="How many zones" hint="Each zone gets an equal share of the eligible businesses, built from whole blocks between real streets; plazas are never split. You can merge or regenerate before accepting.">
            <input className="v2-input" type="number" min={1} max={60} value={target} onChange={e => setTarget(Math.max(1, Math.min(60, +e.target.value || 1)))} style={{ width: 120 }} />
          </Field>
          {busy && <div className="v2-note">{stepLabel(step)}</div>}
          <ErrorBox error={error} />
        </>}
      </Modal>
    );
  };

const ReviewPanel: React.FC<{ review: { city: City; run: ZoneRun; picked: number[] }; busy: boolean; progress: string | null; onMerge: () => void; onAccept: () => void; onDiscard: () => void;
  onRegenerate: (n: number) => void; onPick: (k: number) => void }> = ({ review, busy, progress, onMerge, onAccept, onDiscard, onRegenerate, onPick }) => {
  const { run, picked } = review;
  const [n, setN] = useState(run.target);
  return (
    <div className="v2-card">
      <div className="v2-row" style={{ marginBottom: 4 }}><b style={{ fontSize: 16 }}>Proposed: {run.proposal.length} zones for {run.campaign_name}</b><span className="v2-spacer" /><Tag tone="a">Review</Tag></div>
      <div className="v2-mut v2-small" style={{ marginBottom: 10 }}>{review.city.name} · {run.stats.eligible} eligible businesses · about {run.stats.share} per zone · {run.stats.free_blocks} free blocks</div>
      <div className="v2-table-wrap" style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 10 }}><table className="v2-table">
        <thead><tr><th /><th>Zone</th><th>Businesses</th><th>Plazas</th></tr></thead>
        <tbody>
          {run.proposal.map(z => (
            <tr key={z.key} className="click" onClick={() => onPick(z.key)} style={picked.includes(z.key) ? { background: 'var(--sel)' } : undefined}>
              <td><input type="checkbox" readOnly checked={picked.includes(z.key)} /></td>
              <td><b>{z.name}</b></td><td>{z.count}</td><td>{z.plazas}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {progress ? <div className="v2-note" style={{ marginBottom: 10 }}>{progress}</div>
        : <div className="v2-note" style={{ marginBottom: 10 }}>Tap two zones that touch, then Merge. Nothing is saved until you accept.</div>}
      <div className="v2-row" style={{ gap: 6 }}>
        <Btn kind="o" size="sm" disabled={busy || picked.length !== 2} onClick={onMerge}>Merge the two picked</Btn>
        <span className="v2-spacer" />
        <input className="v2-input" type="number" min={1} max={60} value={n} onChange={e => setN(Math.max(1, Math.min(60, +e.target.value || 1)))} style={{ width: 64 }} aria-label="Zones" />
        <Btn kind="o" size="sm" disabled={busy} onClick={() => onRegenerate(n)}>Regenerate</Btn>
      </div>
      <div className="v2-row" style={{ gap: 6, marginTop: 12 }}>
        <Btn kind="r" size="sm" disabled={busy} onClick={onDiscard}>Discard</Btn>
        <span className="v2-spacer" />
        <Btn icon={Check} disabled={busy} onClick={onAccept}>{busy ? 'Working…' : `Accept all ${run.proposal.length}`}</Btn>
      </div>
    </div>
  );
};

const NameZone: React.FC<{ initial: string; busy: boolean; error: unknown; onClose: () => void; onSave: (name: string) => void }> = ({ initial, busy, error, onClose, onSave }) => {
  const [name, setName] = useState(initial);
  return (
    <Modal title={initial ? 'Save the new shape' : 'Name this zone'} onClose={onClose}
      footer={<><Btn kind="o" onClick={onClose}>Back to the map</Btn><Btn disabled={busy || !name.trim()} onClick={() => onSave(name.trim())}>{busy ? 'Saving…' : 'Save zone'}</Btn></>}>
      <Field label="Zone name" hint="City and area are filled in from the map.">
        <input className="v2-input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Speers Rd plazas" onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onSave(name.trim()); }} />
      </Field>
      <ErrorBox error={error} />
    </Modal>
  );
};
