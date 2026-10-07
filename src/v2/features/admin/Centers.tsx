// src/v2/features/admin/Centers.tsx — Super Admin › Centers & seasons.
import React, { useState } from 'react';
import { Plus, Lock, Unlock } from 'lucide-react';
import { useAuth, type Center } from '../../lib/auth';
import { SERVICES, serviceLabel, type Service } from '../../lib/permissions';
import { listCenters, listSeasons, saveCenter, saveSeason, closeSeason, reopenSeason, regionTax, seasonState, useLoad, type Season } from '../../lib/data';
import { Btn, Card, ErrorBox, Field, Loading, Modal, Tag, Toggle } from '../../ui';

const REGIONS = ['East', 'West', 'Central'];
const stateTag = (s: Season) => {
  const st = seasonState(s);
  return st === 'open' ? <Tag tone="g">Open</Tag> : st === 'upcoming' ? <Tag tone="b">Upcoming</Tag> : st === 'ended' ? <Tag tone="a">Ended — not closed</Tag> : <Tag>Closed</Tag>;
};

export const Centers: React.FC = () => {
  const { profile, reload: reloadAuth } = useAuth();
  const centers = useLoad(listCenters, []);
  const seasons = useLoad(() => listSeasons(), []);
  const [sel, setSel] = useState<string | null>(null);
  const [editCenter, setEditCenter] = useState<Center | 'new' | null>(null);
  const [editSeason, setEditSeason] = useState<Season | 'new' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const isSA = !!profile?.is_super_admin;

  const list = centers.data || [];
  const current = list.find(c => c.id === sel) || list[0] || null;
  const centerSeasons = (seasons.data || []).filter(s => s.center_id === current?.id);

  const toggleClose = async (s: Season) => {
    setError(null);
    const closing = !s.closed_at;
    if (closing && !window.confirm(`Close ${serviceLabel(s.service)} ${s.year}? It becomes read-only. Only the Super Admin can reopen it.`)) return;
    try { closing ? await closeSeason(s.id, profile!.id) : await reopenSeason(s.id); seasons.reload(); }
    catch (e) { setError(e); }
  };

  return (
    <div className="v2-main">
      <div className="v2-head"><span className="v2-h1">Centers &amp; seasons</span><span className="v2-spacer" />
        {isSA && <Btn icon={Plus} onClick={() => setEditCenter('new')}>New command center</Btn>}</div>
      <ErrorBox error={centers.error || seasons.error || error} />
      {centers.loading ? <Loading /> : (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div className="v2-card" style={{ width: 280, padding: 6, flexShrink: 0 }}>
            {list.map(c => (
              <button key={c.id} type="button" className={`v2-menu-item${current?.id === c.id ? ' on' : ''}`} onClick={() => setSel(c.id)}>
                <span style={{ flex: 1 }}>{c.display_name}</span>{!c.is_active && <Tag>Off</Tag>}
              </button>
            ))}
            {list.length === 0 && <div className="v2-mut" style={{ padding: 10 }}>No centers yet.</div>}
          </div>
          {current && (
            <div style={{ flex: 1, minWidth: 300 }} className="v2-stack">
              <Card title={current.display_name} right={isSA && <Btn size="sm" kind="o" onClick={() => setEditCenter(current)}>Edit</Btn>}>
                <div className="v2-grid2" style={{ gap: 8 }}>
                  <Info k="Region" v={current.region} />
                  <Info k="Services offered" v={current.services.length ? current.services.map(serviceLabel).join(' · ') : '— none set —'} />
                  <Info k="CN # prefix" v={current.cn_prefix || '—'} />
                  <Info k="Tax" v={current.tax_name ? `${current.tax_name} ${current.tax_rate}%` : `${regionTax(current.region).name} ${regionTax(current.region).rate}% (region default)`} />
                  <Info k="Local number" v={current.local_number || '—'} />
                  <Info k="Review link" v={current.review_link || '—'} />
                </div>
              </Card>
              <Card title="Seasons" right={<Btn size="sm" icon={Plus} onClick={() => setEditSeason('new')} disabled={!current.services.length}>New season</Btn>}>
                {!current.services.length && <div className="v2-note" style={{ marginTop: 0 }}>Set the services this center offers first.</div>}
                <div className="v2-table-wrap"><table className="v2-table">
                  <thead><tr><th>Season</th><th>Dates</th><th>State</th><th></th></tr></thead>
                  <tbody>
                    {centerSeasons.map(s => (
                      <tr key={s.id}>
                        <td><b>{serviceLabel(s.service)} {s.year}</b></td>
                        <td>{s.starts_on} → {s.ends_on}</td>
                        <td>{stateTag(s)}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {!s.closed_at && <Btn size="sm" kind="o" onClick={() => setEditSeason(s)}>Edit dates</Btn>}{' '}
                          {(!s.closed_at || isSA) && <Btn size="sm" kind={s.closed_at ? 'o' : 'r'} icon={s.closed_at ? Unlock : Lock} onClick={() => toggleClose(s)}>{s.closed_at ? 'Reopen' : 'Close season'}</Btn>}
                        </td>
                      </tr>
                    ))}
                    {centerSeasons.length === 0 && <tr><td colSpan={4} className="v2-mut">No seasons yet.</td></tr>}
                  </tbody>
                </table></div>
                <div className="v2-note">Seasons can’t overlap. The end date stops new Start sessions; Close season locks it read-only (crews and collections can finish before you close).</div>
              </Card>
            </div>
          )}
        </div>
      )}
      {editCenter && <CenterEditor center={editCenter === 'new' ? null : editCenter} onClose={() => setEditCenter(null)}
        onSaved={id => { setEditCenter(null); setSel(id); centers.reload(); reloadAuth(); }} />}
      {editSeason && current && <SeasonEditor center={current} season={editSeason === 'new' ? null : editSeason}
        onClose={() => setEditSeason(null)} onSaved={() => { setEditSeason(null); seasons.reload(); }} />}
    </div>
  );
};

const Info: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div><div className="v2-label" style={{ marginBottom: 2 }}>{k}</div><div style={{ wordBreak: 'break-word' }}>{v}</div></div>
);

const CenterEditor: React.FC<{ center: Center | null; onClose: () => void; onSaved: (id: string) => void }> = ({ center, onClose, onSaved }) => {
  const [f, setF] = useState(() => center ? { ...center } : {
    display_name: '', region: 'East', services: [] as string[], cn_prefix: '', local_number: '', review_link: '',
    tax_name: 'HST', tax_rate: 13, is_active: true,
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF(x => ({ ...x, [k]: v }));
  const save = async () => {
    setError(null);
    if (!f.display_name.trim()) { setError('Name the center'); return; }
    setBusy(true);
    try {
      const id = await saveCenter({
        id: center?.id || null, display_name: f.display_name, region: f.region, services: f.services,
        cn_prefix: f.cn_prefix || null, local_number: f.local_number || null, review_link: f.review_link || null,
        tax_name: f.tax_name || null, tax_rate: f.tax_rate === null || (f.tax_rate as unknown) === '' ? null : Number(f.tax_rate), is_active: f.is_active,
      });
      onSaved(id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={center ? `Edit ${center.display_name}` : 'New command center'} onClose={onClose}
      footer={<><Btn kind="o" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
      <div className="v2-grid2">
        <div>
          <Field label="Name"><input className="v2-input" value={f.display_name} onChange={e => set('display_name', e.target.value)} /></Field>
          <Field label="Region" hint="Pre-fills the tax rate.">
            <select className="v2-sel" value={f.region} onChange={e => { const r = e.target.value; const t = regionTax(r); setF(x => ({ ...x, region: r, tax_name: t.name, tax_rate: t.rate })); }}>
              {REGIONS.map(r => <option key={r}>{r}</option>)}
            </select></Field>
          <div className="v2-grid2" style={{ gap: 10 }}>
            <Field label="Tax name"><input className="v2-input" value={f.tax_name || ''} onChange={e => set('tax_name', e.target.value)} /></Field>
            <Field label="Tax %"><input className="v2-input" type="number" step="0.01" value={f.tax_rate ?? ''} onChange={e => set('tax_rate', e.target.value === '' ? null : Number(e.target.value))} /></Field>
          </div>
          <Field label="CN # prefix" hint="Contractor numbers for this center start with this (e.g. ONT1001)."><input className="v2-input" value={f.cn_prefix || ''} onChange={e => set('cn_prefix', e.target.value.toUpperCase())} maxLength={6} /></Field>
        </div>
        <div>
          <div className="v2-label">Services offered</div>
          {SERVICES.map(s => (
            <label key={s.key} className="v2-check"><input type="checkbox" checked={f.services.includes(s.key)}
              onChange={() => set('services', f.services.includes(s.key) ? f.services.filter(x => x !== s.key) : [...f.services, s.key])} />{s.label}</label>
          ))}
          <Field label="Local phone number" hint="For texting and calling (phase 6)."><input className="v2-input" value={f.local_number || ''} onChange={e => set('local_number', e.target.value)} /></Field>
          <Field label="Google review link"><input className="v2-input" value={f.review_link || ''} onChange={e => set('review_link', e.target.value)} /></Field>
          <div className="v2-check" style={{ border: 0 }}><Toggle on={f.is_active} onChange={v => set('is_active', v)} label="Active" /><span>{f.is_active ? 'Active' : 'Inactive'}</span></div>
        </div>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
};

const SeasonEditor: React.FC<{ center: Center; season: Season | null; onClose: () => void; onSaved: () => void }> = ({ center, season, onClose, onSaved }) => {
  const y = new Date().getFullYear();
  const [f, setF] = useState({
    service: (season?.service || center.services[0]) as Service, year: season?.year || y,
    starts_on: season?.starts_on || '', ends_on: season?.ends_on || '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setError(null);
    if (!f.starts_on || !f.ends_on) { setError('Pick both dates'); return; }
    if (f.ends_on < f.starts_on) { setError('The end date is before the start date'); return; }
    setBusy(true);
    try { await saveSeason({ id: season?.id, center_id: center.id, ...f }); onSaved(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={season ? `${serviceLabel(season.service)} ${season.year}` : `New season · ${center.display_name}`} onClose={onClose}
      footer={<><Btn kind="o" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
      <div className="v2-grid2">
        <Field label="Service"><select className="v2-sel" value={f.service} disabled={!!season} onChange={e => setF(x => ({ ...x, service: e.target.value as Service }))}>
          {center.services.map(s => <option key={s} value={s}>{serviceLabel(s)}</option>)}</select></Field>
        <Field label="Year"><input className="v2-input" type="number" value={f.year} disabled={!!season} onChange={e => setF(x => ({ ...x, year: Number(e.target.value) }))} /></Field>
        <Field label="Starts"><input className="v2-input" type="date" value={f.starts_on} onChange={e => setF(x => ({ ...x, starts_on: e.target.value }))} /></Field>
        <Field label="Ends"><input className="v2-input" type="date" value={f.ends_on} onChange={e => setF(x => ({ ...x, ends_on: e.target.value }))} /></Field>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
};
