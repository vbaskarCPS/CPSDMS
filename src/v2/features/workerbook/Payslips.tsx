// src/v2/features/workerbook/Payslips.tsx — Workerbook › Payslips.
//
// Workers are paid on a payslip for a pay period, not on the day. Pick a date range, the unpaid
// day lines are grouped per worker, add the extras the old payslips had (hotels, advances,
// travel package, crackfill %, $120 program, extra deductions / additions, batches) and
// Generate: the payslips are saved as Generated and the PDFs download. Signing a payslip off
// marks it Paid. A Generated payslip can be voided, which frees its days for a new one.
import { Link } from 'react-router-dom';
import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Download, FileText, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { todayISO, useLoad } from '../../lib/data';
import {
  daysBetween, defaultSettings, downloadRunPdf, generatePayslips, lineGaps, lineToDay, linesFromSavedDay, listLines, listRuns,
  markPaid, mmmdd, saveLines, toWorkerData, voidPayslip, type PayoutLine, type Payslip, type PayslipRun, type SlipSettings,
} from '../../lib/payslips';
import { payslipTotals, type HiddenFields, type PayslipSeason } from '../../../lib/payslipExport';
import { Btn, ErrorBox, Field, Loading, Modal, Tag } from '../../ui';

const money = (v: number) => `$${(Math.round(v * 100) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pretty = (iso: string) => new Date(iso + 'T12:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
const shift = (iso: string, d: number) => { const x = new Date(iso + 'T12:00'); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };

export const Payslips: React.FC = () => {
  const { center, can } = useAuth();
  const [generating, setGenerating] = useState(false);
  const runs = useLoad(() => center ? listRuns(center.id) : Promise.resolve([]), [center?.id]);
  const gaps = useLoad(() => center ? lineGaps(center.id) : Promise.resolve([]), [center?.id]);
  const [building, setBuilding] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  if (!center) return <div className="v2-main v2-narrow"><div className="v2-card">Pick a command center first.</div></div>;
  if (!can('workerbook')) return <div className="v2-main v2-narrow"><div className="v2-err">You don’t have access to payslips.</div></div>;

  const build = async (day: string) => {
    setBuilding(day); setError(null);
    try { await saveLines(center.id, day, await linesFromSavedDay(center.id, day)); gaps.reload(); }
    catch (e) { setError(e); } finally { setBuilding(null); }
  };

  if (generating) return <Generator centerId={center.id} centerName={center.display_name} services={center.services}
    onCancel={() => setGenerating(false)} onDone={() => { setGenerating(false); runs.reload(); }} />;

  return (
    <div className="v2-main">
      <div className="v2-head">
        <Link to="/app/workerbook/days" className="v2-link">‹ Calendar</Link>
        <span className="v2-h1">Payslips</span>
        <span className="v2-spacer" />
        <Btn icon={FileText} onClick={() => setGenerating(true)}>Generate payslips</Btn>
      </div>
      <ErrorBox error={runs.error || gaps.error || error} />
      {(gaps.data || []).length > 0 && (
        <div className="v2-card" style={{ marginBottom: 14 }}>
          <div className="v2-card-h">Closed days not ready for payslips yet</div>
          <div className="v2-small v2-mut" style={{ marginBottom: 8 }}>These days were closed before payslips were in the app. Build their day lines from the saved copy (same maths as the old Payout Stats sheet).</div>
          <div className="v2-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {(gaps.data || []).map(g => (
              <Btn key={g.day} size="sm" kind="o" icon={RefreshCw} disabled={!!building} onClick={() => build(g.day)}>
                {building === g.day ? 'Building…' : `${pretty(g.day)} · ${g.carts} carts`}
              </Btn>
            ))}
          </div>
        </div>
      )}
      {runs.loading && !runs.data ? <Loading /> : (runs.data || []).length === 0 ? (
        <div className="v2-card" style={{ textAlign: 'center', padding: 30 }}>
          No payslips yet.<div style={{ marginTop: 12 }}><Btn icon={FileText} onClick={() => setGenerating(true)}>Generate payslips</Btn></div>
        </div>
      ) : (
        <div className="v2-stack" style={{ gap: 12 }}>
          {(runs.data || []).map(r => <RunCard key={r.id} run={r} centerName={center.display_name} onChanged={runs.reload} />)}
        </div>
      )}
    </div>
  );
};

// ───────────── a generated run ─────────────
const RunCard: React.FC<{ run: PayslipRun; centerName: string; onChanged: () => void }> = ({ run, centerName, onChanged }) => {
  const live = run.payslips.filter(p => p.status !== 'void');
  const paid = live.filter(p => p.status === 'paid');
  const [open, setOpen] = useState(live.length !== paid.length);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Payslip[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sorted = [...run.payslips].sort((a, b) => (a.batch || '').localeCompare(b.batch || '') || a.last_name.localeCompare(b.last_name));
  const total = live.reduce((s, p) => s + Number(p.final_pay), 0);
  const toggle = (id: string) => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const signOff = async (slips: Payslip[]) => {
    setBusy(true); setError(null);
    try { await markPaid(slips.map(s => s.id)); setConfirm(null); setPicked(new Set()); onChanged(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const doVoid = async (p: Payslip) => {
    setBusy(true); setError(null);
    try { await voidPayslip(p.id); onChanged(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const unpaidPicked = sorted.filter(p => picked.has(p.id) && p.status === 'generated');

  return (
    <section className="v2-card" style={{ padding: 0 }}>
      <div className="v2-row" style={{ padding: '12px 14px', gap: 10, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <b>{pretty(run.start_day)} – {pretty(run.end_day)}</b>
        <span className="v2-mut v2-small">{run.season} · {live.length} payslip{live.length === 1 ? '' : 's'} · {money(total)}</span>
        <span className="v2-spacer" />
        {paid.length === live.length && live.length > 0 ? <Tag tone="g">All paid</Tag> : <Tag tone="a">{live.length - paid.length} to pay</Tag>}
        <span onClick={e => e.stopPropagation()}><Btn size="sm" kind="o" icon={Download} onClick={() => downloadRunPdf(run, centerName)}>PDF</Btn></span>
      </div>
      {open && (
        <>
          <div className="v2-table-wrap">
            <table className="v2-table">
              <thead><tr><th style={{ width: 30 }} /><th>CN #</th><th>Name</th><th>Batch</th><th style={{ textAlign: 'right' }}>Days</th>
                <th style={{ textAlign: 'right' }}>Earned</th><th style={{ textAlign: 'right' }}>Final pay</th><th>Status</th><th /></tr></thead>
              <tbody>
                {sorted.map(p => (
                  <tr key={p.id} style={{ opacity: p.status === 'void' ? 0.5 : 1 }}>
                    <td>{p.status === 'generated' && <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.first_name} ${p.last_name}`} />}</td>
                    <td><b>{p.cn}</b></td><td><b>{p.first_name} {p.last_name}</b></td><td className="v2-small">{p.batch || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{p.days.length}</td>
                    <td style={{ textAlign: 'right' }}>{money(Number(p.earned))}</td>
                    <td style={{ textAlign: 'right' }}><b>{money(Number(p.final_pay))}</b></td>
                    <td>{p.status === 'paid' ? <Tag tone="g">Paid {p.paid_at ? pretty(p.paid_at.slice(0, 10)) : ''}</Tag> : p.status === 'void' ? <Tag>Void</Tag> : <Tag tone="a">Generated</Tag>}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {p.status === 'generated' && <>
                        <Btn size="sm" icon={CheckCircle2} disabled={busy} onClick={() => setConfirm([p])}>Sign off</Btn>{' '}
                        <Btn size="sm" kind="o" disabled={busy} onClick={() => doVoid(p)}>Void</Btn>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="v2-row" style={{ padding: 12, gap: 8 }}>
            <ErrorBox error={error} />
            <span className="v2-spacer" />
            <Btn size="sm" kind="o" disabled={busy} onClick={() => setPicked(new Set(sorted.filter(p => p.status === 'generated').map(p => p.id)))}>Select all unpaid</Btn>
            <Btn size="sm" icon={CheckCircle2} disabled={busy || unpaidPicked.length === 0} onClick={() => setConfirm(unpaidPicked)}>Sign off {unpaidPicked.length || ''} as paid</Btn>
          </div>
        </>
      )}
      {confirm && (
        <Modal title={`Sign off ${confirm.length} payslip${confirm.length === 1 ? '' : 's'} as paid?`} onClose={() => setConfirm(null)}
          footer={<><Btn kind="o" onClick={() => setConfirm(null)}>Cancel</Btn><Btn icon={CheckCircle2} disabled={busy} onClick={() => signOff(confirm)}>{busy ? 'Saving…' : 'Mark paid'}</Btn></>}>
          <p style={{ marginTop: 0 }}>{confirm.length === 1 ? `${confirm[0].first_name} ${confirm[0].last_name}` : `${confirm.length} workers`} · <b>{money(confirm.reduce((s, p) => s + Number(p.final_pay), 0))}</b> for {pretty(run.start_day)} – {pretty(run.end_day)}.</p>
          <p className="v2-small v2-mut">Your name and the time are recorded. A paid payslip can’t be voided.</p>
          <ErrorBox error={error} />
        </Modal>
      )}
    </section>
  );
};

// ───────────── generate ─────────────
interface Group { cn: string; first: string; last: string; lines: PayoutLine[] }

const Generator: React.FC<{ centerId: string; centerName: string; services: string[]; onCancel: () => void; onDone: () => void }> =
  ({ centerId, centerName, services, onCancel, onDone }) => {
    const today = todayISO();
    const [start, setStart] = useState(shift(today, -6));
    const [end, setEnd] = useState(today);
    const [season, setSeason] = useState<PayslipSeason>(services.includes('sealing') ? 'sealing' : services.includes('cleaning') && !services.includes('aeration') ? 'cleaning' : 'aeration');
    const [hidden, setHidden] = useState<HiddenFields>({ hotels: false, advances: false, travelPkg: false });
    const [batches, setBatches] = useState<string[]>(['Batch 1']);
    const [settings, setSettings] = useState<Map<string, SlipSettings & { batch: string }>>(new Map());
    const [open, setOpen] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const lines = useLoad(() => (start && end && end >= start ? listLines(centerId, start, end) : Promise.resolve([])), [centerId, start, end]);

    const groups = useMemo<Group[]>(() => {
      const m = new Map<string, Group>();
      for (const l of lines.data || []) {
        if (l.payslip_id) continue;
        if (!m.has(l.cn)) m.set(l.cn, { cn: l.cn, first: l.first_name, last: l.last_name, lines: [] });
        m.get(l.cn)!.lines.push(l);
      }
      return [...m.values()].sort((a, b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
    }, [lines.data]);
    const already = (lines.data || []).filter(l => l.payslip_id).length;
    const daysWithLines = [...new Set((lines.data || []).map(l => l.day))].sort();

    const get = (cn: string) => settings.get(cn) || { ...defaultSettings(), batch: batches[0] };
    const set = (cn: string, patch: Partial<SlipSettings & { batch: string }>) => setSettings(m => new Map(m).set(cn, { ...get(cn), ...patch }));
    const totalsFor = (g: Group) => payslipTotals(toWorkerData(g.cn, g.first, g.last, g.lines.map(lineToDay), get(g.cn)), hidden, season);
    const grand = groups.reduce((s, g) => s + totalsFor(g).finalPay, 0);
    const numIn = (v: string) => { const x = parseFloat(v); return isFinite(x) ? x : 0; };

    const generate = async () => {
      setBusy(true); setError(null);
      try {
        const slips = groups.map(g => {
          const s = get(g.cn); const { batch, ...st } = s;
          const days = g.lines.map(lineToDay);
          const t = payslipTotals(toWorkerData(g.cn, g.first, g.last, days, st), hidden, season);
          return { cn: g.cn, first_name: g.first, last_name: g.last, batch, settings: st, days, line_ids: g.lines.map(l => l.id), earned: t.earnedComm, final_pay: t.finalPay };
        });
        await generatePayslips({ centerId, start, end, season, hidden, slips });
        // Same PDFs the old generator made: one per batch, sign-out list first.
        const run = { id: '', start_day: start, end_day: end, season, hidden, created_at: '',
          payslips: slips.map(s => ({ ...s, id: '', run_id: '', status: 'generated' as const, generated_at: '', paid_at: null })) } as PayslipRun;
        await downloadRunPdf(run, centerName);
        onDone();
      } catch (e) { setError(e); } finally { setBusy(false); }
    };

    return (
      <div className="v2-main">
        <div className="v2-head">
          <button className="v2-link" onClick={onCancel}>‹ Payslips</button>
          <span className="v2-h1">Generate payslips</span>
          <span className="v2-spacer" />
          <span className="v2-mut v2-small">{groups.length} worker{groups.length === 1 ? '' : 's'} · {money(grand)}</span>
          <Btn icon={FileText} disabled={busy || groups.length === 0} onClick={generate}>{busy ? 'Generating…' : 'Generate & download'}</Btn>
        </div>
        <div className="v2-card" style={{ marginBottom: 14 }}>
          <div className="v2-grid4" style={{ alignItems: 'end' }}>
            <Field label="From"><input className="v2-input" type="date" value={start} max={end} onChange={e => setStart(e.target.value)} /></Field>
            <Field label="To"><input className="v2-input" type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} /></Field>
            <Field label="Payslip type">
              <select className="v2-sel" value={season} onChange={e => setSeason(e.target.value as PayslipSeason)}>
                <option value="sealing">Sealing</option><option value="aeration">Aeration</option><option value="cleaning">Window cleaning</option>
              </select>
            </Field>
            <div className="v2-small v2-mut" style={{ paddingBottom: 10 }}>
              {daysWithLines.length ? `Days with payouts: ${daysWithLines.map(pretty).join(', ')}` : 'No finalized days in this range.'}
              {already > 0 && <div>{already} day line{already === 1 ? ' is' : 's are'} already on a payslip and left out.</div>}
            </div>
          </div>
          <div className="v2-row" style={{ gap: 14, flexWrap: 'wrap', marginTop: 6 }}>
            <span className="v2-label" style={{ margin: 0 }}>Show on payslips:</span>
            {(['hotels', 'advances', 'travelPkg'] as const).map(k => (
              <label key={k} className="v2-check" style={{ border: 0, padding: 0 }}>
                <input type="checkbox" checked={!hidden[k]} onChange={() => setHidden(h => ({ ...h, [k]: !h[k] }))} />
                {k === 'travelPkg' ? 'Travel package' : k === 'hotels' ? 'Hotels' : 'Advances'}
              </label>
            ))}
            <span className="v2-spacer" />
            <span className="v2-label" style={{ margin: 0 }}>Batches:</span>
            {batches.map((b, i) => (
              <span key={i} className="v2-row" style={{ gap: 4 }}>
                <input className="v2-input" style={{ width: 110, height: 32 }} value={b} aria-label={`Batch ${i + 1} name`}
                  onChange={e => { const v = e.target.value; setBatches(bs => bs.map((x, j) => (j === i ? v : x)));
                    setSettings(m => { const n = new Map(m); n.forEach((s, k) => { if (s.batch === b) n.set(k, { ...s, batch: v }); }); return n; }); }} />
                {batches.length > 1 && <button className="v2-gbtn" style={{ width: 28, height: 28 }} aria-label="Remove batch"
                  onClick={() => { setBatches(bs => bs.filter((_, j) => j !== i)); setSettings(m => { const n = new Map(m); n.forEach((s, k) => { if (s.batch === b) n.set(k, { ...s, batch: batches[0] === b ? batches[1] : batches[0] }); }); return n; }); }}><Trash2 size={13} /></button>}
              </span>
            ))}
            <Btn size="sm" kind="o" icon={Plus} onClick={() => setBatches(bs => [...bs, `Batch ${bs.length + 1}`])}>Batch</Btn>
          </div>
        </div>
        <ErrorBox error={lines.error || error} />
        {lines.loading && !lines.data ? <Loading /> : groups.length === 0 ? (
          <div className="v2-card" style={{ textAlign: 'center', padding: 30 }}>Nobody has unpaid finalized days between {pretty(start)} and {pretty(end)}.</div>
        ) : (
          <div className="v2-card" style={{ padding: 0 }}>
            <div className="v2-table-wrap">
              <table className="v2-table" style={{ minWidth: 1080 }}>
                <thead><tr>
                  <th /><th>Worker</th><th style={{ textAlign: 'right' }}>Days</th><th style={{ textAlign: 'right' }}>Earned</th>
                  <th>$120</th>{!hidden.hotels && <th>Hotels</th>}{!hidden.advances && <th>Advances</th>}{!hidden.travelPkg && <th>Travel</th>}
                  {season === 'sealing' && <th>Crackfill %</th>}<th>Batch</th><th style={{ textAlign: 'right' }}>Final pay</th>
                </tr></thead>
                <tbody>
                  {groups.map(g => {
                    const s = get(g.cn); const t = totalsFor(g); const isOpen = open.has(g.cn);
                    const num = (k: 'hotels' | 'advances' | 'travelPkg' | 'crackfillPct') => (
                      <td><input className="v2-input" style={{ width: 80, height: 32 }} inputMode="decimal" value={s[k] || ''} placeholder="0"
                        aria-label={`${k} for ${g.first} ${g.last}`} onChange={e => set(g.cn, { [k]: numIn(e.target.value) })} /></td>);
                    return (
                      <React.Fragment key={g.cn}>
                        <tr>
                          <td><button className="v2-gbtn" style={{ width: 28, height: 28 }} aria-label="Show days" onClick={() => setOpen(o => { const n = new Set(o); if (n.has(g.cn)) n.delete(g.cn); else n.add(g.cn); return n; })}>
                            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td>
                          <td><b>{g.first} {g.last}</b> <span className="v2-mut v2-small">{g.cn}</span></td>
                          <td style={{ textAlign: 'right' }}>{g.lines.length}</td>
                          <td style={{ textAlign: 'right' }}>{money(t.earnedComm)}</td>
                          <td><input type="checkbox" checked={s.is120Program} onChange={e => set(g.cn, { is120Program: e.target.checked })} aria-label={`$120 program for ${g.first} ${g.last}`} /></td>
                          {!hidden.hotels && num('hotels')}{!hidden.advances && num('advances')}{!hidden.travelPkg && num('travelPkg')}
                          {season === 'sealing' && num('crackfillPct')}
                          <td><select className="v2-sel" style={{ height: 34, padding: "4px 28px 4px 8px", minWidth: 110 }} value={s.batch} onChange={e => set(g.cn, { batch: e.target.value })} aria-label={`Batch for ${g.first} ${g.last}`}>
                            {batches.map(b => <option key={b}>{b}</option>)}</select></td>
                          <td style={{ textAlign: 'right' }}><b>{money(t.finalPay)}</b></td>
                        </tr>
                        {isOpen && (
                          <tr><td /><td colSpan={10} style={{ background: 'var(--soft)' }}>
                            <div className="v2-small" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, auto)', gap: '2px 14px', justifyContent: 'start', marginBottom: 8 }}>
                              <b>Date</b><b>Manager</b><b>Steps</b><b>EQ</b><b>Rate</b><b>Bonus</b><b>Day total</b>
                              {g.lines.map(l => <React.Fragment key={l.id}><span>{mmmdd(l.day)}</span><span>{l.manager || '—'}</span><span>{Number(l.steps).toFixed(1)}</span>
                                <span>{Number(l.equiv).toFixed(2)}</span><span>{Number(l.payout_rate)}</span><span>{money(Number(l.daily_bonus))}</span><span>{money(Number(l.total_payout))}</span></React.Fragment>)}
                            </div>
                            <Extras label="Extra deductions" items={s.extraDeductions} onChange={v => set(g.cn, { extraDeductions: v })} />
                            <Extras label="Additions" items={s.additions} onChange={v => set(g.cn, { additions: v })} />
                          </td></tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="v2-note" style={{ marginTop: 10 }}>
          Generating saves these payslips as <b>Generated</b> and downloads the PDFs ({daysBetween(start, end)}-day layout, one PDF per batch, sign-out list first). They’re marked <b>Paid</b> when signed off on the Payslips page.
        </div>
      </div>
    );
  };

const Extras: React.FC<{ label: string; items: SlipSettings['additions']; onChange: (v: SlipSettings['additions']) => void }> = ({ label, items, onChange }) => (
  <div className="v2-row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
    <span className="v2-small v2-mut" style={{ width: 110 }}>{label}</span>
    {items.map(it => (
      <span key={it.id} className="v2-row" style={{ gap: 4 }}>
        <input className="v2-input" style={{ width: 140, height: 30 }} placeholder="What for" value={it.label} onChange={e => onChange(items.map(x => x.id === it.id ? { ...x, label: e.target.value } : x))} />
        <input className="v2-input" style={{ width: 80, height: 30 }} inputMode="decimal" placeholder="0" value={it.amount || ''}
          onChange={e => { const v = parseFloat(e.target.value); onChange(items.map(x => x.id === it.id ? { ...x, amount: isFinite(v) ? v : 0 } : x)); }} />
        <button className="v2-gbtn" style={{ width: 26, height: 26 }} aria-label="Remove" onClick={() => onChange(items.filter(x => x.id !== it.id))}><Trash2 size={12} /></button>
      </span>
    ))}
    <Btn size="sm" kind="o" icon={Plus} onClick={() => onChange([...items, { id: `${Date.now()}`, label: '', amount: 0 }])}>Add</Btn>
  </div>
);
