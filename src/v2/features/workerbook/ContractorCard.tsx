// src/v2/features/workerbook/ContractorCard.tsx — one contractor, opened by clicking their name
// anywhere in the Workerbook (calendar days, roll call, crew list, payouts, payslips, lists).
//
//   Overview      lifetime days, this season, pay so far, today's rate, recent payout lines
//   Days & Silver the facts behind the rate: first season, days before this app, Silver Hats per
//                 service — and, after fixing them, working out the unpaid days again
//   Details       contact details, shuttle, status, notes, sign-in PIN
//   History       days booked and status changes
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { todayISO, useLoad } from '../../lib/data';
import { db, must } from '../../lib/client';
import {
  getHire, updatePerson, updatePersonFacts, updateHire, statusHistory, bookedDays, STATUS_LISTS, statusLabel, fullName, HAT_CODES,
  type Hire, type HatCode, type StatusCode,
} from '../../lib/workerbook';
import { dayContext } from '../../lib/dayContext';
import { hireLines, rateFor, recalcForHire } from '../../lib/payoutEngine';
import { SERVICE_HAT } from '../../lib/startSession';
import { Btn, ErrorBox, Field, Loading, Modal, Tabs, Tag } from '../../ui';

const money = (v: number) => `$${(Math.round(v * 100) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDay = (iso: string) => new Date(iso + 'T12:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
const HAT_NAMES: Record<HatCode, string> = { SE: 'Sealing', AER: 'Aeration', RJ: 'Lawn rejuv', CL: 'Cleaning' };

// ───────────── open it from anywhere ─────────────
type Opener = (hireId: string, onSaved?: () => void) => void;
const Ctx = createContext<Opener | null>(null);

export const ContractorCardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { can } = useAuth();
  const [open, setOpen] = useState<{ id: string; onSaved?: () => void } | null>(null);
  const opener = useCallback<Opener>((id, onSaved) => setOpen({ id, onSaved }), []);
  return (
    <Ctx.Provider value={can('workerbook') ? opener : null}>
      {children}
      {open && <ContractorCard hireId={open.id} onClose={() => setOpen(null)} onSaved={() => open.onSaved?.()} />}
    </Ctx.Provider>
  );
};

export const useContractorCard = () => useContext(Ctx);

/** A contractor's name that opens their card (plain text where the card isn't available). */
export const ContractorLink: React.FC<{ hireId: string | null | undefined; children: React.ReactNode; onSaved?: () => void; title?: string }> =
  ({ hireId, children, onSaved, title }) => {
    const open = useContractorCard();
    if (!open || !hireId) return <>{children}</>;
    return (
      <button type="button" className="v2-namelink" title={title || 'Open contractor'}
        onClick={e => { e.preventDefault(); e.stopPropagation(); open(hireId, onSaved); }}>{children}</button>
    );
  };

// ───────────── the card ─────────────
type TabKey = 'overview' | 'pay' | 'details' | 'history';

export const ContractorCard: React.FC<{ hireId: string; onClose: () => void; onSaved: () => void }> = ({ hireId, onClose, onSaved }) => {
  const hire = useLoad(() => getHire(hireId), [hireId]);
  const [tab, setTab] = useState<TabKey>('overview');
  const h = hire.data;
  return (
    <Modal wide onClose={onClose}
      title={h ? <>{fullName(h.person)} <span className="v2-mut" style={{ fontWeight: 600 }}>· {h.cn}</span> <Tag tone={h.status === 'active' ? 'g' : 'a'}>{statusLabel(h.status as StatusCode)}</Tag></> : 'Contractor'}>
      {hire.loading && !h ? <Loading /> : !h ? <ErrorBox error={hire.error || new Error('Contractor not found')} /> : (
        <>
          <Tabs<TabKey> value={tab} onChange={setTab} items={[
            { key: 'overview', label: 'Overview' }, { key: 'pay', label: 'Days & Silver' }, { key: 'details', label: 'Details' }, { key: 'history', label: 'History' },
          ]} />
          <CardBody hire={h} tab={tab} setTab={setTab} onClose={onClose} onSaved={() => { hire.reload(); onSaved(); }} />
        </>
      )}
    </Modal>
  );
};

const CardBody: React.FC<{ hire: Hire; tab: TabKey; setTab: (t: TabKey) => void; onClose: () => void; onSaved: () => void }> = ({ hire, tab, setTab, onClose, onSaved }) => {
  const { center, centers } = useAuth();
  const nav = useNavigate();
  const today = todayISO();
  const days = useLoad(() => bookedDays(hire.id), [hire.id]);
  const lines = useLoad(() => hireLines(hire.id), [hire.id]);
  const rateCenter = center && (center.id === hire.center_id || !centers.some(c => c.id === hire.center_id)) ? center : centers.find(c => c.id === hire.center_id) || center;
  const ctx = useLoad(() => rateCenter ? dayContext(rateCenter.id, today, rateCenter.region) : Promise.resolve(null), [rateCenter?.id, today]);
  const regionOf = useCallback((id: string) => centers.find(c => c.id === id)?.region || rateCenter?.region || 'East', [centers, rateCenter]);

  const appShowed = (days.data || []).filter(d => d.attendance === 'showed');
  const appBeforeToday = appShowed.filter(d => d.day < today).length;
  const noShows = (days.data || []).filter(d => d.attendance === 'no_show').length;
  const p = hire.person;
  const paid = (lines.data || []).filter(l => l.payslip_id);
  const unpaid = (lines.data || []).filter(l => !l.payslip_id);
  const sum = (xs: { total_payout: number }[]) => xs.reduce((a, l) => a + Number(l.total_payout || 0), 0);
  const eqDays = (lines.data || []).filter(l => Number(l.equiv) > 0);
  const avgEq = eqDays.length ? eqDays.reduce((a, l) => a + Number(l.equiv), 0) / eqDays.length : 0;
  const facts = { firstYear: p.first_year, lifetimeDays: p.lifetime_days, hats: p.hats };
  const rate = (team: number) => ctx.data ? rateFor(ctx.data.card, ctx.data.service, ctx.data.seasonYear, team, facts, appBeforeToday) : null;
  const solo = rate(1), team = rate(2);

  if (tab === 'overview') return (
    <div className="v2-stack" style={{ gap: 14 }}>
      <div className="v2-kpis" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        <Kpi l="Lifetime days" n={String(p.lifetime_days + appShowed.length)} s={`${p.lifetime_days} before the app · ${appShowed.length} in it`} onClick={() => setTab('pay')} />
        <Kpi l="No-shows" n={String(hire.ns_count + noShows)} s={hire.ns_count ? `${hire.ns_count} before the app` : undefined} />
        <Kpi l="Unpaid" n={money(sum(unpaid))} s={`${new Set(unpaid.map(l => l.day)).size} days not on a payslip`} />
        <Kpi l="On payslips" n={money(sum(paid))} s={`${new Set(paid.map(l => l.day)).size} days`} />
        <Kpi l="Avg EQ / day" n={avgEq ? avgEq.toFixed(1) : '—'} s={eqDays.length ? `${eqDays.length} days with EQ` : undefined} />
        <Kpi l={`Rate today · ${ctx.data ? HAT_NAMES[SERVICE_HAT[ctx.data.service]] : ''}`} n={solo ? `$${solo.total.toFixed(2)}` : '—'}
          s={solo && team ? `team $${team.total.toFixed(2)} · Alumni +${solo.alumni.toFixed(2)} · Silver +${solo.silver.toFixed(2)}` : undefined} onClick={() => setTab('pay')} />
      </div>
      <div className="v2-card" style={{ padding: 0 }}>
        <div className="v2-card-h" style={{ padding: '12px 14px 0' }}>Payout days</div>
        {lines.loading && !lines.data ? <Loading /> : (lines.data || []).length === 0 ? <div className="v2-mut v2-small" style={{ padding: 14 }}>No payout days yet.</div> : (
          <div className="v2-table-wrap" style={{ maxHeight: 300, overflow: 'auto' }}>
            <table className="v2-table">
              <thead><tr><th>Day</th><th>Manager</th><th style={{ textAlign: 'right' }}>Steps</th><th style={{ textAlign: 'right' }}>EQ</th><th style={{ textAlign: 'right' }}>Rate</th>
                <th style={{ textAlign: 'right' }}>Pay</th><th /></tr></thead>
              <tbody>{(lines.data || []).slice(0, 60).map(l => (
                <tr key={l.id} className="click" onClick={() => { onClose(); nav(`/app/workerbook/days/${l.day}`); }}>
                  <td>{shortDay(l.day)}</td><td className="v2-small">{l.manager || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{Number(l.steps).toFixed(1)}</td><td style={{ textAlign: 'right' }}>{Number(l.equiv).toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}>{Number(l.payout_rate).toFixed(2)}</td><td style={{ textAlign: 'right' }}><b>{money(Number(l.total_payout))}</b></td>
                  <td>{l.payslip_id ? <Tag tone="g">Payslip</Tag> : <Tag tone="a">Unpaid</Tag>}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {(lines.error || days.error) ? <ErrorBox error={lines.error || days.error} /> : null}
    </div>
  );
  if (tab === 'pay') return <PayFacts hire={hire} appShowed={appShowed.map(d => d.day)} ctx={ctx.data} unpaidDays={new Set(unpaid.map(l => l.day)).size}
    regionOf={regionOf} onSaved={() => { onSaved(); lines.reload(); }} />;
  if (tab === 'details') return <Details hire={hire} onClose={onClose} onSaved={onSaved} />;
  return <History hire={hire} days={days.data || []} />;
};

const Kpi: React.FC<{ l: string; n: string; s?: string; onClick?: () => void }> = ({ l, n, s, onClick }) => (
  <div className={`v2-kpi-box v2-card${onClick ? ' link' : ''}`} style={{ margin: 0, cursor: onClick ? 'pointer' : undefined }} onClick={onClick}>
    <span className="l">{l}</span><span className="n" style={{ fontSize: 24 }}>{n}</span>{s && <span className="s">{s}</span>}
  </div>
);

// ───────────── Days & Silver ─────────────
const PayFacts: React.FC<{
  hire: Hire; appShowed: string[]; ctx: Awaited<ReturnType<typeof dayContext>> | null; unpaidDays: number;
  regionOf: (centerId: string) => string; onSaved: () => void;
}> = ({ hire, appShowed, ctx, unpaidDays, regionOf, onSaved }) => {
  const p = hire.person;
  const [f, setF] = useState({
    first_year: p.first_year ? String(p.first_year) : '', lifetime_days: String(p.lifetime_days ?? 0),
    hats: Object.fromEntries(HAT_CODES.map(c => [c, String(p.hats?.[c] || 0)])) as Record<HatCode, string>,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const today = todayISO();
  const before = appShowed.filter(d => d < today).length;
  const toInt = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const facts = useMemo(() => ({
    firstYear: f.first_year.trim() ? Number(f.first_year) : null, lifetimeDays: Math.max(0, toInt(f.lifetime_days) || 0),
    hats: Object.fromEntries(HAT_CODES.map(c => [c, Math.max(0, toInt(f.hats[c]) || 0)])) as Record<HatCode, number>,
  }), [f]);
  const changed = facts.firstYear !== (p.first_year ?? null) || facts.lifetimeDays !== p.lifetime_days || HAT_CODES.some(c => facts.hats[c] !== (p.hats?.[c] || 0));
  const now = (team: number, x: typeof facts) => ctx ? rateFor(ctx.card, ctx.service, ctx.seasonYear, team, x, before) : null;
  const was = now(1, { firstYear: p.first_year, lifetimeDays: p.lifetime_days, hats: p.hats }), will = now(1, facts), willTeam = now(2, facts);

  const save = async () => {
    setBusy('save'); setError(null); setNote(null);
    try {
      const fy = f.first_year.trim() ? Number(f.first_year) : null;
      if (fy !== null && (!Number.isInteger(fy) || fy < 1990 || fy > new Date().getFullYear())) throw new Error('First season must be a year like 2024');
      if (!Number.isInteger(toInt(f.lifetime_days))) throw new Error('Days before the app must be a whole number');
      await updatePersonFacts(p.id, { first_year: fy, lifetime_days: facts.lifetimeDays, hats: facts.hats });
      setNote('Saved. New sessions use this from now on.'); onSaved();
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const recalc = async () => {
    setBusy('recalc'); setError(null); setNote(null);
    try {
      const r = await recalcForHire(hire.id, regionOf);
      setNote(`${r.days} unpaid day${r.days === 1 ? '' : 's'} worked out again: ${money(r.before)} → ${money(r.after)} for ${p.first_name}.${r.skipped.length ? ` Skipped (already on a payslip): ${r.skipped.join(', ')}.` : ''}`);
      onSaved();
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const num = (k: 'first_year' | 'lifetime_days', label: string, hint: string) => (
    <Field label={label}><input className="v2-input" inputMode="numeric" value={f[k]} onChange={e => setF(x => ({ ...x, [k]: e.target.value.replace(/[^\d]/g, '') }))} />
      <div className="v2-note" style={{ marginTop: 4 }}>{hint}</div></Field>
  );

  return (
    <div className="v2-grid2" style={{ alignItems: 'start' }}>
      <div>
        {num('lifetime_days', 'Days worked before this app', `Days in the app are added on top automatically (${appShowed.length} so far). Lifetime days now: ${facts.lifetimeDays + appShowed.length}.`)}
        {num('first_year', 'First season', 'Alumni pay starts from their second season.')}
        <div className="v2-label" style={{ marginTop: 6 }}>Silver Hats earned (lifetime, per service)</div>
        <div className="v2-grid2" style={{ gap: 8 }}>
          {HAT_CODES.map(c => (
            <label key={c} className="v2-row" style={{ gap: 8 }}>
              <span style={{ width: 90 }} className="v2-small">{HAT_NAMES[c]}{ctx && SERVICE_HAT[ctx.service] === c && <> <Tag tone="b">this season</Tag></>}</span>
              <input className="v2-input" inputMode="numeric" style={{ width: 80 }} value={f.hats[c]} aria-label={`${HAT_NAMES[c]} Silver Hats`}
                onChange={e => setF(x => ({ ...x, hats: { ...x.hats, [c]: e.target.value.replace(/[^\d]/g, '') } }))} />
            </label>
          ))}
        </div>
        <ErrorBox error={error} />
        {note && <div className="v2-small" style={{ color: '#047857', marginTop: 10 }}>{note}</div>}
        <div className="v2-row" style={{ marginTop: 12 }}>
          <Btn disabled={!changed || !!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save days & Silver'}</Btn>
          {unpaidDays > 0 && (
            <Btn kind="o" icon={RefreshCw} disabled={!!busy || changed} onClick={recalc}
              title={changed ? 'Save first' : 'Work out the unpaid days again with these days and Silver Hats'}>
              {busy === 'recalc' ? 'Working out…' : `Work out ${unpaidDays} unpaid day${unpaidDays === 1 ? '' : 's'} again`}</Btn>
          )}
        </div>
      </div>
      <div className="v2-card">
        <div className="v2-card-h">Rate today{ctx ? ` · ${HAT_NAMES[SERVICE_HAT[ctx.service]]}` : ''}</div>
        {!ctx || !will ? <Loading /> : (
          <div className="v2-small" style={{ lineHeight: 1.9 }}>
            <div>Base: ${will.base.toFixed(2)} solo · ${willTeam!.base.toFixed(2)} team</div>
            <div>Alumni: <b>+{will.alumni.toFixed(2)}</b> <span className="v2-mut">({will.contractorYear < (ctx.card.alumni.fromYear || 2) ? `season ${will.contractorYear}: starts in season ${ctx.card.alumni.fromYear}` : `${will.days} days`}; {ctx.card.alumni.steps.map(s => `${s.at}+ days → +${s.amount.toFixed(2)}`).join(', ')})</span></div>
            <div>Silver: <b>+{will.silver.toFixed(2)}</b> <span className="v2-mut">({will.hats} hats; {ctx.card.silver.steps.map(s => `${s.at}+ → +${s.amount.toFixed(2)}`).join(', ')})</span></div>
            <div style={{ marginTop: 6, fontSize: 15 }}>Rate: <b>${will.total.toFixed(2)}</b> solo · <b>${willTeam!.total.toFixed(2)}</b> team
              {changed && was && Math.abs(was.total - will.total) > 1e-9 && <> <Tag tone="a">was ${was.total.toFixed(2)} solo</Tag></>}</div>
            <div className="v2-note">Each payout day uses the days worked <i>before</i> that day, so a day’s rate can differ from today’s.</div>
          </div>
        )}
      </div>
    </div>
  );
};

// ───────────── Details ─────────────
const Details: React.FC<{ hire: Hire; onClose: () => void; onSaved: () => void }> = ({ hire, onClose, onSaved }) => {
  const { center, centers } = useAuth();
  const p = hire.person;
  const [f, setF] = useState({
    first_name: p.first_name, last_name: p.last_name, cell_phone: p.cell_phone || '', alt_phone: p.alt_phone || '',
    email: p.email || '', address: p.address || '', notes: p.notes || '', shuttle: hire.shuttle || '', status: hire.status as StatusCode,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [pinSetAt, setPinSetAt] = useState(hire.pin_set_at);
  const isHome = !center || center.id === hire.center_id;
  const homeName = centers.find(c => c.id === hire.center_id)?.display_name || 'another center';
  const set = (k: keyof typeof f, v: string) => { setSaved(false); setF(x => ({ ...x, [k]: v })); };
  const resetPin = async () => {
    setBusy(true); setError(null);
    try { must(await db.rpc('app_reset_worker_pin', { p_hire: hire.id })); setPinSetAt(null); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  const save = async (statusOverride?: StatusCode) => {
    setBusy(true); setError(null);
    try {
      if (!f.first_name.trim()) throw new Error('First name is required');
      await updatePerson(p.id, {
        first_name: f.first_name.trim(), last_name: f.last_name.trim(), cell_phone: f.cell_phone.trim() || null,
        alt_phone: f.alt_phone.trim() || null, email: f.email.trim().toLowerCase() || null, address: f.address.trim() || null, notes: f.notes.trim() || null,
      });
      if (isHome) await updateHire(hire.id, { shuttle: f.shuttle.trim() || null, status: statusOverride || f.status });
      setSaved(true); onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="v2-grid2" style={{ gap: 10 }}>
        <Field label="First name"><input className="v2-input" value={f.first_name} onChange={e => set('first_name', e.target.value)} /></Field>
        <Field label="Last name"><input className="v2-input" value={f.last_name} onChange={e => set('last_name', e.target.value)} /></Field>
        <Field label="Cell"><input className="v2-input" inputMode="tel" value={f.cell_phone} onChange={e => set('cell_phone', e.target.value)} /></Field>
        <Field label="Alternate phone"><input className="v2-input" inputMode="tel" value={f.alt_phone} onChange={e => set('alt_phone', e.target.value)} /></Field>
        <Field label="Email"><input className="v2-input" type="email" value={f.email} onChange={e => set('email', e.target.value)} /></Field>
        <Field label="Address"><input className="v2-input" value={f.address} onChange={e => set('address', e.target.value)} /></Field>
        <Field label="Shuttle / home city"><input className="v2-input" value={f.shuttle} disabled={!isHome} onChange={e => set('shuttle', e.target.value)} /></Field>
        <Field label="Status">
          <select className="v2-sel" value={f.status} disabled={!isHome} onChange={e => set('status', e.target.value)}>
            <option value="active">Active</option>
            {STATUS_LISTS.map(s => <option key={s.code} value={s.code}>{s.code} — {s.label}</option>)}
          </select>
        </Field>
      </div>
      {!isHome && <div className="v2-note">Home center is {homeName}; only it can change shuttle and status.</div>}
      <Field label="Notes"><textarea className="v2-input" rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} /></Field>
      <div className="v2-note v2-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span>Sign-in PIN: {pinSetAt ? `set ${new Date(pinSetAt).toLocaleDateString('en-CA')}` : 'not set yet — signs in with first name'}. Workers make their own under My Account. ID numbers are kept in the sheet, not here.</span>
        {pinSetAt && <Btn size="sm" kind="o" disabled={busy} onClick={resetPin}>Reset PIN</Btn>}
      </div>
      <ErrorBox error={error} />
      <div className="v2-row" style={{ marginTop: 12 }}>
        {hire.status !== 'active' && isHome && <Btn kind="o" disabled={busy} onClick={() => save('active')}>Move back to Active</Btn>}
        <span className="v2-spacer" />
        {saved && <span className="v2-small" style={{ color: '#047857' }}>Saved</span>}
        <Btn kind="o" onClick={onClose}>Close</Btn>
        <Btn disabled={busy} onClick={() => save()}>{busy ? 'Saving…' : 'Save details'}</Btn>
      </div>
    </div>
  );
};

// ───────────── History ─────────────
const History: React.FC<{ hire: Hire; days: { day: string; attendance: string | null; center_id: string }[] }> = ({ hire, days }) => {
  const { centers } = useAuth();
  const history = useLoad(() => statusHistory(hire.id), [hire.id]);
  return (
    <div className="v2-grid2" style={{ alignItems: 'start' }}>
      <div className="v2-card">
        <div className="v2-card-h">Days in the app ({days.length})</div>
        {days.length === 0 ? <div className="v2-mut v2-small">Not booked yet in the app.</div> : (
          <div className="v2-stack" style={{ gap: 4, maxHeight: 320, overflow: 'auto' }}>
            {days.map(d => (
              <div key={d.day + d.center_id} className="v2-row v2-small" style={{ justifyContent: 'space-between' }}>
                <span>{shortDay(d.day)} <span className="v2-mut">· {centers.find(c => c.id === d.center_id)?.display_name || ''}</span></span>
                {d.attendance === 'showed' ? <Tag tone="g">Showed</Tag> : d.attendance === 'no_show' ? <Tag tone="r">No-show</Tag> : <Tag>Booked</Tag>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="v2-card">
        <div className="v2-card-h">Status history</div>
        {(history.data || []).map((s, i) => (
          <div key={i} className="v2-row v2-small" style={{ justifyContent: 'space-between', padding: '3px 0' }}>
            <span>{statusLabel(s.status as StatusCode)}</span><span className="v2-mut">since {s.since}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
