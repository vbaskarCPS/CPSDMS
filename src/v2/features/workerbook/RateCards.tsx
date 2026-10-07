// src/v2/features/workerbook/RateCards.tsx — one rate card per center per season, saved as dated versions.
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, History } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { serviceLabel } from '../../lib/permissions';
import { listSeasons, listRateCards, saveRateCard, regionTax, seasonState, todayISO, useLoad, type RateCardRow } from '../../lib/data';
import { defaultRateCard, validateRateCard, cardFor, type RateCardData, type Step } from '../../lib/rateCard';
import { Btn, Card, ErrorBox, Field, Loading, Modal, Tag, Toggle } from '../../ui';

const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

export const RateCards: React.FC = () => {
  const { center } = useAuth();
  const seasons = useLoad(() => center ? listSeasons(center.id) : Promise.resolve([]), [center?.id]);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  useEffect(() => {
    const list = seasons.data || [];
    if (!list.find(s => s.id === seasonId)) {
      const pick = list.find(s => seasonState(s) === 'open') || list.find(s => seasonState(s) === 'upcoming') || list[0];
      setSeasonId(pick?.id || null);
    }
  }, [seasons.data, seasonId]);
  const season = (seasons.data || []).find(s => s.id === seasonId) || null;
  const cards = useLoad(() => seasonId ? listRateCards(seasonId) : Promise.resolve([] as RateCardRow[]), [seasonId]);
  const today = todayISO();
  const active = useMemo(() => cardFor(cards.data || [], today), [cards.data, today]);
  const latest = (cards.data || [])[0] || null;

  const [draft, setDraft] = useState<RateCardData | null>(null);
  const [from, setFrom] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!season || !center || cards.loading) return;
    const base = latest?.data || defaultRateCard(season.service, center.tax_name ? { name: center.tax_name, rate: Number(center.tax_rate) } : regionTax(center.region));
    setDraft(JSON.parse(JSON.stringify(base)));
    setFrom(latest ? (addDays(today, 1) < season.starts_on ? season.starts_on : addDays(today, 1)) : season.starts_on);
    setSaved(null); setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season?.id, cards.data, cards.loading]);

  if (!center) return <div className="v2-main"><div className="v2-card">Pick a command center first.</div></div>;
  const closed = !!season?.closed_at;
  const errs = draft ? validateRateCard(draft) : [];
  const dirty = !!draft && (!latest || JSON.stringify(draft) !== JSON.stringify(latest.data));
  const minFrom = latest ? today : (season?.starts_on || today);

  const save = async () => {
    if (!draft || !season) return;
    setError(null); setSaved(null);
    if (errs.length) { setError(errs.join(' · ')); return; }
    if (from < minFrom) { setError(`A new version can start ${minFrom} at the earliest — days already paid keep the version they used.`); return; }
    setBusy(true);
    try { const r = await saveRateCard(season.id, from, draft); setSaved(`Saved version ${r.version} — applies from ${r.effective_from}.`); cards.reload(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };

  const set = <K extends keyof RateCardData>(k: K, v: RateCardData[K]) => setDraft(d => d ? { ...d, [k]: v } : d);

  return (
    <div className="v2-main">
      <div className="v2-head">
        <span className="v2-h1">Rate card</span>
        {(seasons.data || []).length > 0 && (
          <select className="v2-select-pill" value={seasonId || ''} onChange={e => setSeasonId(e.target.value)} aria-label="Season">
            {(seasons.data || []).map(s => <option key={s.id} value={s.id}>{serviceLabel(s.service)} {s.year}</option>)}
          </select>
        )}
        {active ? <Tag tone="g">v{active.version} active since {active.effective_from}</Tag> : latest ? <Tag tone="b">v{latest.version} starts {latest.effective_from}</Tag> : season ? <Tag tone="a">No rate card yet</Tag> : null}
        {closed && <Tag>Season closed — read-only</Tag>}
        <span className="v2-spacer" />
        {(cards.data || []).length > 0 && <Btn kind="o" icon={History} onClick={() => setShowHistory(true)}>History ({cards.data!.length})</Btn>}
      </div>
      <ErrorBox error={seasons.error || cards.error} />
      {seasons.loading || cards.loading ? <Loading /> : !season ? (
        <div className="v2-card">This center has no seasons yet. Create one in Super Admin › Centers &amp; seasons.</div>
      ) : draft && (
        <fieldset disabled={closed} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="v2-grid3">
            <Card title="Production">
              <Num label="$ per EQ — solo" v={draft.perEqSolo} on={v => set('perEqSolo', v)} />
              <Num label="$ per EQ — team" v={draft.perEqTeam} on={v => set('perEqTeam', v)} />
              <Num label="EQ divisor ($ per EQ)" v={draft.eqDivisor} on={v => set('eqDivisor', v)} />
              <Num label="Product cost %" v={draft.productCostPercent} on={v => set('productCostPercent', v)} />
              <div className="v2-label">Office flats</div>
              <PairList items={draft.officeFlats.map(f => ({ a: f.code, b: f.value }))} aLabel="Code" bLabel="Value $" textA
                onChange={l => set('officeFlats', l.map(x => ({ code: String(x.a).toUpperCase(), value: Number(x.b) })))} />
            </Card>
            <Card title="Payments & tax">
              <Num label="Prepaid weight (0–1)" v={draft.prepaidWeight} step={0.05} on={v => set('prepaidWeight', v)} />
              <Num label="Billed weight (0–1)" v={draft.billedWeight} step={0.05} on={v => set('billedWeight', v)} />
              <div className="v2-grid2" style={{ gap: 10 }}>
                <Field label="Tax name"><input className="v2-input" value={draft.taxName} onChange={e => set('taxName', e.target.value)} /></Field>
                <Num label="Tax %" v={draft.taxRate} on={v => set('taxRate', v)} />
              </div>
              <div className="v2-check"><Toggle on={draft.noTaxOnCashDefault} onChange={v => set('noTaxOnCashDefault', v)} label="No tax on cash" /><span>No tax on cash — default at Start session</span></div>
              <Num label="Upgrade: % to upsell" v={Math.round(draft.upgradeSplit.upsell * 100)} on={v => set('upgradeSplit', { upsell: v / 100, production: 1 - v / 100 })} hint={`${Math.round(draft.upgradeSplit.production * 100)}% to production`} />
              {draft.asphaltSplit && <>
                <Num label="Asphalt: % to cart" v={Math.round(draft.asphaltSplit.asphaltCart * 100)} hint={`${Math.round(draft.asphaltSplit.asphaltRc * 100)}% to Ramp Crew; upsold 100% Ramp Crew`}
                  on={v => set('asphaltSplit', { asphaltCart: v / 100, asphaltRc: 1 - v / 100, upsoldRc: 1 })} />
              </>}
              <Num label="Driver — flat $ per driving day" v={draft.driverFlat} on={v => set('driverFlat', v)} />
            </Card>
            <Card title="Alumni (2nd year on)">
              <Num label="Starts in contractor year" v={draft.alumni.fromYear} on={v => set('alumni', { ...draft.alumni, fromYear: v })} />
              <StepList steps={draft.alumni.steps} atLabel="Lifetime days ≥" onChange={s => set('alumni', { ...draft.alumni, steps: s })} />
            </Card>
            <Card title={`Silver (lifetime ${serviceLabel(season.service)} Silver Hats)`}>
              <StepList steps={draft.silver.steps} atLabel="Hats ≥" onChange={s => set('silver', { steps: s })} />
              <div className="v2-note">Hats are counted per service, as in the Workerbook’s AER / RJ / SE / CL columns.</div>
            </Card>
            <Card title="Hats (one day's EQ)">
              <HatRow label="Individual" h={draft.hats.individual} on={h => set('hats', { ...draft.hats, individual: h })} />
              <HatRow label="Team of 1" h={draft.hats.teamOf1} on={h => set('hats', { ...draft.hats, teamOf1: h })} />
              <HatRow label="Team of 2" h={draft.hats.teamOf2} on={h => set('hats', { ...draft.hats, teamOf2: h })} />
              <HatRow label="Team of 3+" h={{ green: draft.hats.teamOf3Plus.green, gold: draft.hats.teamOf3Plus.gold, silver: draft.hats.teamOf3Plus.silverPerMember }}
                silverLabel="Silver / member" on={h => set('hats', { ...draft.hats, teamOf3Plus: { green: h.green, gold: h.gold, silverPerMember: h.silver } })} />
            </Card>
            <Card title="Bonus rules (automatic at close)" right={<Btn size="sm" kind="o" icon={Plus} onClick={() => set('bonusRules', [...draft.bonusRules, { label: '', kind: 'day_gross_at_least', threshold: 1000, amount: 0 }])}>Rule</Btn>}>
              {draft.bonusRules.length === 0 && <div className="v2-mut v2-small">No automatic bonuses. Manual bonuses are added on the payout day.</div>}
              {draft.bonusRules.map((b, i) => (
                <div key={i} className="v2-card" style={{ padding: 10, marginBottom: 8 }}>
                  <div className="v2-row" style={{ gap: 6 }}>
                    <input className="v2-input" style={{ flex: 1 }} placeholder="Name" value={b.label} onChange={e => set('bonusRules', draft.bonusRules.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                    <button className="v2-gbtn" style={{ width: 34, height: 34 }} aria-label="Remove rule" onClick={() => set('bonusRules', draft.bonusRules.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                  </div>
                  <div className="v2-row" style={{ gap: 6, marginTop: 6 }}>
                    <select className="v2-sel" style={{ flex: 1 }} value={b.kind} onChange={e => set('bonusRules', draft.bonusRules.map((x, j) => j === i ? { ...x, kind: e.target.value as typeof b.kind, threshold: e.target.value === 'day_gross_at_least' ? (x.threshold || 1000) : null } : x))}>
                      <option value="day_gross_at_least">Day gross at least</option><option value="top_seller">Top seller of the day</option><option value="team_battle_win">Team Battle win (each)</option>
                    </select>
                    {b.kind === 'day_gross_at_least' && <input className="v2-input" style={{ width: 90 }} type="number" aria-label="Gross $" value={b.threshold ?? ''} onChange={e => set('bonusRules', draft.bonusRules.map((x, j) => j === i ? { ...x, threshold: Number(e.target.value) } : x))} />}
                    <input className="v2-input" style={{ width: 80 }} type="number" aria-label="Bonus $" value={b.amount} onChange={e => set('bonusRules', draft.bonusRules.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x))} />
                  </div>
                </div>
              ))}
            </Card>
          </div>
          {!closed && (
            <div className="v2-card" style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label="Applies from"><input className="v2-input" type="date" value={from} min={minFrom} max={season.ends_on} onChange={e => setFrom(e.target.value)} /></Field>
              <div style={{ flex: 1, minWidth: 200 }} className="v2-small v2-mut">
                {latest ? 'Saving creates a new version. Days already closed keep the version they used.' : 'This is the first version for this season.'}
                {season.service === 'sealing' && !latest && <><br />Sealing product cost starts at 0% (what the road trip runs today). Change it here if that changes.</>}
              </div>
              <Btn onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : latest ? 'Save new version' : 'Save rate card'}</Btn>
            </div>
          )}
          {errs.length > 0 && <div className="v2-err" style={{ marginTop: 10 }}>{errs.join(' · ')}</div>}
          {error ? <div style={{ marginTop: 10 }}><ErrorBox error={error} /></div> : null}
          {saved && <div className="v2-ok" style={{ marginTop: 10 }}>{saved}</div>}
        </fieldset>
      )}
      {showHistory && <Modal title="Rate card history" onClose={() => setShowHistory(false)}>
        <table className="v2-table"><thead><tr><th>Version</th><th>Applies from</th><th>Saved</th><th>$/EQ solo · team</th><th>Product cost</th></tr></thead>
          <tbody>{(cards.data || []).map(c => <tr key={c.id}><td>v{c.version}</td><td>{c.effective_from}</td><td>{new Date(c.created_at).toLocaleString('en-CA')}</td>
            <td>${c.data.perEqSolo} · ${c.data.perEqTeam}</td><td>{c.data.productCostPercent}%</td></tr>)}</tbody></table>
      </Modal>}
    </div>
  );
};

const Num: React.FC<{ label: string; v: number; on: (v: number) => void; step?: number; hint?: string }> = ({ label, v, on, step, hint }) => (
  <Field label={label} hint={hint}>
    <input className="v2-input" type="number" step={step ?? 'any'} value={Number.isFinite(v) ? v : ''} onChange={e => on(e.target.value === '' ? NaN : Number(e.target.value))} />
  </Field>
);

const StepList: React.FC<{ steps: Step[]; atLabel: string; onChange: (s: Step[]) => void }> = ({ steps, atLabel, onChange }) => (
  <PairList items={steps.map(s => ({ a: s.at, b: s.amount }))} aLabel={atLabel} bLabel="+$ / EQ"
    onChange={l => onChange(l.map(x => ({ at: Number(x.a), amount: Number(x.b) })))} />
);

const PairList: React.FC<{ items: { a: string | number; b: number }[]; aLabel: string; bLabel: string; textA?: boolean; onChange: (l: { a: string | number; b: number }[]) => void }> =
  ({ items, aLabel, bLabel, textA, onChange }) => (
    <div>
      <div className="v2-row v2-small v2-mut" style={{ gap: 6, marginBottom: 4 }}><span style={{ flex: 1 }}>{aLabel}</span><span style={{ flex: 1 }}>{bLabel}</span><span style={{ width: 34 }} /></div>
      {items.map((it, i) => (
        <div key={i} className="v2-row" style={{ gap: 6, marginBottom: 6, flexWrap: 'nowrap' }}>
          <input className="v2-input" style={{ flex: 1 }} type={textA ? 'text' : 'number'} value={it.a} aria-label={aLabel} onChange={e => onChange(items.map((x, j) => j === i ? { ...x, a: textA ? e.target.value : Number(e.target.value) } : x))} />
          <input className="v2-input" style={{ flex: 1 }} type="number" step="any" value={it.b} aria-label={bLabel} onChange={e => onChange(items.map((x, j) => j === i ? { ...x, b: Number(e.target.value) } : x))} />
          <button className="v2-gbtn" style={{ width: 34, height: 34 }} aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
        </div>
      ))}
      <button className="v2-link v2-small" onClick={() => onChange([...items, { a: textA ? '' : 0, b: 0 }])}>+ Add</button>
    </div>
  );

const HatRow: React.FC<{ label: string; h: { green: number; gold: number; silver: number }; on: (h: { green: number; gold: number; silver: number }) => void; silverLabel?: string }> = ({ label, h, on, silverLabel }) => (
  <div style={{ marginBottom: 8 }}>
    <div className="v2-label">{label}</div>
    <div className="v2-row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      {([['green', 'Green'], ['gold', 'Gold'], ['silver', silverLabel || 'Silver']] as const).map(([k, l]) => (
        <input key={k} className="v2-input" type="number" aria-label={`${label} ${l}`} title={l} value={h[k]} onChange={e => on({ ...h, [k]: Number(e.target.value) })} />
      ))}
    </div>
  </div>
);
