// src/v2/features/worker/WorkerHome.tsx — the worker dashboard (/app/worker).
//
// Workers sign in any time with CN # + PIN (or first name until they make a PIN), against this
// year's contractor list. When a session is running and they're on it, sign-in takes them to the
// map logsheet; the dashboard is a tile on its menu. Here: Online Training (every module
// unlocked), their payslips (the copy the office generated, Generated or Paid), and their
// account (PIN, phones, email). Everything goes through the worker's pass (src/lib/workerPass).
import React, { useCallback, useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Download, FileText, GraduationCap, LogOut, MapPinned, UserCog } from 'lucide-react';
import { getPass, signInProblem, SignedOut, withPass, workerSignIn, workerSignOut, type WorkerProfile } from '../../../lib/workerPass';
import { payslipTotals, type ExtraItem, type HiddenFields, type PayslipDayRow, type PayslipSeason } from '../../../lib/payslipExport';
import { Btn, ErrorBox, Field, Loading, Tag, Tile } from '../../ui';

// ───────────── data ─────────────
export interface WorkerPayslip {
  id: string; cn: string; first_name: string; last_name: string; start_day: string; end_day: string; season: PayslipSeason;
  hidden: HiddenFields; center_name: string; settings: Record<string, unknown>; days: PayslipDayRow[];
  earned: number; final_pay: number; status: 'generated' | 'paid'; generated_at: string; updated_at: string | null; paid_at: string | null;
}
interface Me { worker: WorkerProfile; today: Record<string, unknown> | null }

const money = (v: number) => `$${(Math.round(Number(v) * 100) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pretty = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
const prettyY = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mmmdd = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]}${iso.slice(8, 10)}`;
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00').getTime() - new Date(a + 'T12:00').getTime()) / 86400000) + 1;

/** A saved payslip → the shape the payslip maths and PDF take. */
export function slipData(p: WorkerPayslip) {
  const st = p.settings || {};
  const items = (v: unknown): ExtraItem[] => (Array.isArray(v) ? v : []).map((x: Record<string, unknown>, i) => ({ id: String(x.id ?? i), label: String(x.label ?? ''), amount: Number(x.amount) || 0 }));
  return {
    contractorId: p.cn, firstName: p.first_name, lastName: p.last_name, days: p.days || [],
    is120Program: !!st.is120Program, hotels: Number(st.hotels) || 0, advances: Number(st.advances) || 0, travelPkg: Number(st.travelPkg) || 0,
    crackfillPct: Number(st.crackfillPct) || 0, extraDeductions: items(st.extraDeductions), additions: items(st.additions),
  };
}

function useWorkerData<T>(fn: string, pick: (d: unknown) => T): { data: T | null; error: unknown; signedOut: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    withPass<unknown>(fn).then(d => { if (live) setData(pick(d)); })
      .catch(e => { if (!live) return; if (e instanceof SignedOut) setSignedOut(true); else setError(e); });
    return () => { live = false; };
  }, [fn, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, signedOut, reload: () => setTick(t => t + 1) };
}

// ───────────── shell ─────────────
export const WorkerHome: React.FC = () => {
  const [, setTick] = useState(0);
  const pass = getPass();
  if (!pass) return <Frame><WorkerSignIn onIn={() => setTick(t => t + 1)} /></Frame>;
  return (
    <Routes>
      <Route index element={<Frame worker={pass.worker}><Dashboard onSignedOut={() => setTick(t => t + 1)} /></Frame>} />
      <Route path="payslips" element={<Frame worker={pass.worker} back="/app/worker" title="Payslips"><PayslipList onSignedOut={() => setTick(t => t + 1)} /></Frame>} />
      <Route path="payslips/:id" element={<Frame worker={pass.worker} back="/app/worker/payslips" title="Payslip"><PayslipView onSignedOut={() => setTick(t => t + 1)} /></Frame>} />
      <Route path="account" element={<Frame worker={pass.worker} back="/app/worker" title="My account"><Account onSignedOut={() => setTick(t => t + 1)} /></Frame>} />
      <Route path="*" element={<Frame worker={pass.worker}><Dashboard onSignedOut={() => setTick(t => t + 1)} /></Frame>} />
    </Routes>
  );
};

const Frame: React.FC<{ worker?: WorkerProfile; back?: string; title?: string; children: React.ReactNode }> = ({ worker, back, title, children }) => {
  const nav = useNavigate();
  return (
    <div className="v2" style={{ minHeight: '100vh' }}>
      <div className="v2-main" style={{ maxWidth: 720, padding: '16px 16px 40px' }}>
        <div className="v2-row" style={{ gap: 10, marginBottom: 14, flexWrap: 'nowrap' }}>
          {back ? <Link to={back} className="v2-gbtn" aria-label="Back" style={{ width: 36, height: 36 }}><ChevronLeft size={18} /></Link>
            : <img src="/icon-192.png" alt="" style={{ width: 36, height: 36, borderRadius: 9 }} />}
          <div style={{ minWidth: 0 }}>
            <div className="v2-h1" style={{ fontSize: 20 }}>{title || (worker ? `Hi, ${worker.first_name}` : 'Worker sign-in')}</div>
            {worker && <div className="v2-small v2-mut">{worker.cn} · {worker.center_name}</div>}
          </div>
          <span className="v2-spacer" />
          {worker && !back && <Btn size="sm" kind="o" icon={LogOut} onClick={async () => {
            await workerSignOut();
            try { localStorage.removeItem('current_user'); localStorage.removeItem('training_contractor'); } catch { /* nothing kept */ }
            nav('/app/login', { replace: true });
          }}>Sign out</Btn>}
        </div>
        {children}
      </div>
    </div>
  );
};

export const WorkerSignIn: React.FC<{ onIn: () => void }> = ({ onIn }) => {
  const [cn, setCn] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await workerSignIn(cn, secret);
      if (r.ok) onIn(); else setError(signInProblem(r));
    } finally { setBusy(false); }
  };
  return (
    <form className="v2-card" style={{ padding: 18 }} onSubmit={submit}>
      <p className="v2-small v2-mut" style={{ marginTop: 0 }}>Sign in to see your training, payslips and account.</p>
      <Field label="CN #"><input className="v2-input" autoCapitalize="characters" placeholder="e.g. I1004" value={cn} onChange={e => setCn(e.target.value)} required /></Field>
      <Field label="PIN (or first name if you haven’t made one)"><input className="v2-input" type="password" value={secret} onChange={e => setSecret(e.target.value)} required /></Field>
      {error && <div className="v2-err" style={{ marginBottom: 12 }}>{error}</div>}
      <Btn type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Signing in…' : 'Sign in'}</Btn>
    </form>
  );
};

// ───────────── the dashboard ─────────────
const Dashboard: React.FC<{ onSignedOut: () => void }> = ({ onSignedOut }) => {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const me = useWorkerData<Me>('app_worker_me', d => d as Me);
  const slips = useWorkerData<WorkerPayslip[]>('app_worker_payslips', d => (d as { payslips?: WorkerPayslip[] }).payslips || []);
  const [opening, setOpening] = useState(false);
  const [done, setDone] = useState(params.has('done'));
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (me.signedOut || slips.signedOut) onSignedOut(); }, [me.signedOut, slips.signedOut]); // eslint-disable-line react-hooks/exhaustive-deps

  const worker = me.data?.worker || getPass()?.worker;
  const toPay = (slips.data || []).filter(s => s.status === 'generated');

  const openToday = async () => {
    if (!me.data?.today) return;
    setOpening(true); setError(null);
    try {
      const [{ sessionService }, { setStorageItem }, { trainingService }, { workerLandingPath }] = await Promise.all([
        import('../../../lib/sessionService'), import('../../../lib/localStorage'), import('../../../lib/trainingService'), import('../../../lib/mapLogsheetService')]);
      const w = await sessionService.adoptWorkerRow(me.data.today);
      trainingService.disableTrainingMode();
      setStorageItem('current_user', w);
      await sessionService.startLogsheetSession(w.contractorId);
      nav(await workerLandingPath(w));
    } catch (e) {
      if (e instanceof Error && e.message === 'SESSION_FINALIZED') setDone(true); else setError(e);
    } finally { setOpening(false); }
  };

  const openTraining = async () => {
    if (!worker) return;
    const { contractorService } = await import('../../../lib/contractorService');
    const now = new Date().toISOString();
    contractorService.setCurrentTrainingContractor({
      contractorId: worker.cn, firstName: worker.first_name, lastName: worker.last_name, commandCenterId: worker.center_id,
      region: worker.region || undefined, level2UnlockedAt: now, level3UnlockedAt: now,   // every module unlocked from the dashboard
    });
    nav('/training');
  };

  return (
    <div className="v2-stack" style={{ gap: 14 }}>
      <ErrorBox error={me.error || error} />
      {done && <div className="v2-card" style={{ background: '#ecfdf5', borderColor: '#a7f3d0' }}>
        <b>Your day is complete.</b><div className="v2-small">Your payout has been processed and your logsheet is closed for today. Great work!</div></div>}
      {me.data?.today && !done && (
        <div className="v2-card v2-row" style={{ gap: 10, borderColor: 'var(--blue)' }}>
          <MapPinned size={20} color="var(--blue)" />
          <div style={{ flex: 1, minWidth: 0 }}><b>Today’s session is running</b><div className="v2-small v2-mut">You’re on it. Your map logsheet is one tap away.</div></div>
          <Btn disabled={opening} onClick={openToday}>{opening ? 'Opening…' : 'Back to today’s logsheet'}</Btn>
        </div>
      )}
      <div className="v2-tiles" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        <Tile icon={GraduationCap} label="Online Training" color="violet" sub="Every module unlocked" onClick={openTraining} />
        <Tile icon={FileText} label="Payslips" color="green" onClick={() => nav('/app/worker/payslips')}
          badge={toPay.length || null}
          sub={slips.data ? (slips.data.length ? `${slips.data.length} payslip${slips.data.length === 1 ? '' : 's'}${toPay.length ? ` · ${toPay.length} to be paid` : ''}` : 'None yet') : 'Loading…'} />
        <Tile icon={UserCog} label="My Account" color="amber" onClick={() => nav('/app/worker/account')} sub={worker?.has_pin ? 'PIN, phone, email' : 'Make a PIN'} />
      </div>
      {!me.data && !me.error && <Loading />}
    </div>
  );
};

// ───────────── payslips ─────────────
const STATUS: Record<string, React.ReactNode> = { generated: <Tag tone="a">Not paid yet</Tag>, paid: <Tag tone="g">Paid</Tag> };

const PayslipList: React.FC<{ onSignedOut: () => void }> = ({ onSignedOut }) => {
  const slips = useWorkerData<WorkerPayslip[]>('app_worker_payslips', d => (d as { payslips?: WorkerPayslip[] }).payslips || []);
  useEffect(() => { if (slips.signedOut) onSignedOut(); }, [slips.signedOut]); // eslint-disable-line react-hooks/exhaustive-deps
  if (slips.error) return <ErrorBox error={slips.error} />;
  if (!slips.data) return <Loading />;
  if (!slips.data.length) return <div className="v2-card" style={{ textAlign: 'center', padding: 26 }}>No payslips yet. They show here as soon as the office generates them.</div>;
  return (
    <div className="v2-stack" style={{ gap: 10 }}>
      {slips.data.map(s => (
        <Link key={s.id} to={`/app/worker/payslips/${s.id}`} className="v2-card v2-row" style={{ gap: 10, textDecoration: 'none', color: 'inherit' }}>
          <FileText size={20} color="var(--green)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{pretty(s.start_day)} – {prettyY(s.end_day)}</b>
            <div className="v2-small v2-mut">{s.days.length} day{s.days.length === 1 ? '' : 's'}
              {s.status === 'paid' && s.paid_at ? ` · paid ${pretty(s.paid_at)}` : ''}{s.updated_at && s.status !== 'paid' ? ` · updated ${pretty(s.updated_at)}` : ''}</div>
          </div>
          <div style={{ textAlign: 'right' }}><div className="v2-kpi" style={{ fontSize: 18 }}>{money(s.final_pay)}</div>{STATUS[s.status]}</div>
        </Link>
      ))}
    </div>
  );
};

const PayslipView: React.FC<{ onSignedOut: () => void }> = ({ onSignedOut }) => {
  const { id } = useParams();
  const slips = useWorkerData<WorkerPayslip[]>('app_worker_payslips', d => (d as { payslips?: WorkerPayslip[] }).payslips || []);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (slips.signedOut) onSignedOut(); }, [slips.signedOut]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = (slips.data || []).find(x => x.id === id);
  const download = useCallback(async () => {
    if (!s) return;
    setBusy(true);
    try {
      const { generatePayslipsPDF } = await import('../../../lib/payslipExport');
      await generatePayslipsPDF([slipData(s)], mmmdd(s.start_day), mmmdd(s.end_day), s.center_name, daysBetween(s.start_day, s.end_day), s.hidden, s.season, undefined,
        { signOutList: false, fileName: `Payslip ${s.first_name} ${s.last_name} ${s.start_day} to ${s.end_day}.pdf` });
    } finally { setBusy(false); }
  }, [s]);
  if (slips.error) return <ErrorBox error={slips.error} />;
  if (!slips.data) return <Loading />;
  if (!s) return <div className="v2-card">That payslip isn’t available. <Link className="v2-link" to="/app/worker/payslips">All payslips ›</Link></div>;
  const t = payslipTotals(slipData(s), s.hidden, s.season);
  const w = slipData(s);
  const row = (label: string, v: number, minus = false) => v ? <tr><td>{label}</td><td style={{ textAlign: 'right', color: minus ? 'var(--rose)' : undefined }}>{minus ? '−' : ''}{money(v)}</td></tr> : null;
  return (
    <div className="v2-stack" style={{ gap: 12 }}>
      <div className="v2-card">
        <div className="v2-row" style={{ gap: 8 }}>
          <div><b>{pretty(s.start_day)} – {prettyY(s.end_day)}</b><div className="v2-small v2-mut">{s.center_name} · {s.season}</div></div>
          <span className="v2-spacer" />{STATUS[s.status]}
        </div>
        <div className="v2-small v2-mut" style={{ marginTop: 6 }}>
          {s.status === 'paid' ? `Paid ${prettyY(s.paid_at || s.generated_at)}.` : 'Not paid yet: the office can still change it before it’s paid.'}
          {s.updated_at && s.status !== 'paid' ? ` Updated ${prettyY(s.updated_at)}.` : ''}
        </div>
      </div>
      <div className="v2-card" style={{ padding: 0 }}>
        <div className="v2-table-wrap"><table className="v2-table">
          <thead><tr><th>Day</th><th>Manager</th><th style={{ textAlign: 'right' }}>Steps</th><th style={{ textAlign: 'right' }}>EQ</th><th style={{ textAlign: 'right' }}>Bonus</th><th style={{ textAlign: 'right' }}>Day total</th></tr></thead>
          <tbody>{s.days.map((d, i) => (
            <tr key={i}><td>{d.date}</td><td className="v2-small">{d.manager || '—'}</td><td style={{ textAlign: 'right' }}>{Number(d.steps).toFixed(1)}</td>
              <td style={{ textAlign: 'right' }}>{Number(d.equiv).toFixed(2)}</td><td style={{ textAlign: 'right' }}>{money(d.dailyBonus)}</td><td style={{ textAlign: 'right' }}><b>{money(d.totalPayout)}</b></td></tr>
          ))}</tbody>
        </table></div>
      </div>
      <div className="v2-card">
        <table className="v2-table"><tbody>
          <tr><td>Earned ({t.daysWorked} day{t.daysWorked === 1 ? '' : 's'})</td><td style={{ textAlign: 'right' }}>{money(t.earnedComm)}</td></tr>
          {row('$120-a-day program top-up', t.trainingBump)}
          {row('Hotels', t.hotels, true)}{row('Advances', t.advances, true)}{row('Travel package', t.travelPkg, true)}
          {row(`Crackfill (${w.crackfillPct}%)`, t.crackfillDed, true)}
          {w.extraDeductions.filter(x => x.amount).map(x => <tr key={`d${x.id}`}><td>{x.label || 'Deduction'}</td><td style={{ textAlign: 'right', color: 'var(--rose)' }}>−{money(x.amount)}</td></tr>)}
          {w.additions.filter(x => x.amount).map(x => <tr key={`a${x.id}`}><td>{x.label || 'Addition'}</td><td style={{ textAlign: 'right', color: 'var(--green)' }}>+{money(x.amount)}</td></tr>)}
          <tr><td><b>Final pay</b></td><td style={{ textAlign: 'right' }}><b className="v2-kpi" style={{ fontSize: 20 }}>{money(t.finalPay)}</b></td></tr>
        </tbody></table>
        <Btn icon={Download} disabled={busy} onClick={download} style={{ marginTop: 10 }}>{busy ? 'Making the PDF…' : 'Download PDF'}</Btn>
      </div>
    </div>
  );
};

// ───────────── account ─────────────
interface AccountData { cn: string; name: string; has_pin: boolean; pin_set_at: string | null; cell_phone: string | null; alt_phone: string | null; email: string | null }
const REASON: Record<string, string> = {
  wrong: 'That PIN (or first name) isn’t right.', locked: 'Too many wrong tries. Try again in 15 minutes.', bad_pin: 'A PIN is 4 to 6 digits.',
  bad_phone: 'A phone number has 10 digits.', bad_email: 'That email doesn’t look right.',
};

const Account: React.FC<{ onSignedOut: () => void }> = ({ onSignedOut }) => {
  const acct = useWorkerData<AccountData>('app_worker_pass_account', d => d as AccountData);
  const [f, setF] = useState<{ cell: string; alt: string; email: string } | null>(null);
  const [pin, setPin] = useState({ current: '', next: '', again: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (acct.signedOut) onSignedOut(); }, [acct.signedOut]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (acct.data && !f) setF({ cell: acct.data.cell_phone || '', alt: acct.data.alt_phone || '', email: acct.data.email || '' }); }, [acct.data, f]);
  if (acct.error) return <ErrorBox error={acct.error} />;
  if (!acct.data || !f) return <Loading />;
  const run = async (fn: () => Promise<{ ok: boolean; reason?: string }>, okText: string, after?: () => void) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      if (r.ok) { setMsg({ ok: true, text: okText }); after?.(); acct.reload(); } else setMsg({ ok: false, text: REASON[r.reason || ''] || 'That didn’t work. Try again.' });
    } catch (e) { if (e instanceof SignedOut) onSignedOut(); else setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };
  return (
    <div className="v2-stack" style={{ gap: 12 }}>
      {msg && <div className={msg.ok ? 'v2-card' : 'v2-err'} style={msg.ok ? { background: '#ecfdf5', borderColor: '#a7f3d0' } : undefined}>{msg.text}</div>}
      <form className="v2-card" onSubmit={e => { e.preventDefault(); void run(() => withPass('app_worker_pass_save_account', { p_cell: f.cell, p_alt: f.alt, p_email: f.email }), 'Saved.'); }}>
        <div className="v2-card-h">{acct.data.name} · {acct.data.cn}</div>
        <Field label="Cell phone"><input className="v2-input" inputMode="tel" value={f.cell} onChange={e => setF({ ...f, cell: e.target.value })} /></Field>
        <Field label="Other phone"><input className="v2-input" inputMode="tel" value={f.alt} onChange={e => setF({ ...f, alt: e.target.value })} /></Field>
        <Field label="Email"><input className="v2-input" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        <Btn type="submit" disabled={busy}>Save</Btn>
      </form>
      <form className="v2-card" onSubmit={e => {
        e.preventDefault();
        if (pin.next !== pin.again) { setMsg({ ok: false, text: 'The two new PINs don’t match.' }); return; }
        void run(() => withPass('app_worker_pass_set_pin', { p_current: pin.current, p_new_pin: pin.next }), 'Your PIN is set. Sign in with it from now on.', () => setPin({ current: '', next: '', again: '' }));
      }}>
        <div className="v2-card-h">{acct.data.has_pin ? 'Change your PIN' : 'Make a PIN'}</div>
        <p className="v2-small v2-mut" style={{ marginTop: 0 }}>{acct.data.has_pin ? `Set ${acct.data.pin_set_at ? prettyY(acct.data.pin_set_at) : ''}.` : 'Until you make one, anyone who knows your CN # and first name can sign in as you.'}</p>
        <Field label={acct.data.has_pin ? 'Current PIN' : 'Your first name'}><input className="v2-input" type="password" value={pin.current} onChange={e => setPin({ ...pin, current: e.target.value })} required /></Field>
        <Field label="New PIN (4 to 6 digits)"><input className="v2-input" type="password" inputMode="numeric" value={pin.next} onChange={e => setPin({ ...pin, next: e.target.value })} required /></Field>
        <Field label="New PIN again"><input className="v2-input" type="password" inputMode="numeric" value={pin.again} onChange={e => setPin({ ...pin, again: e.target.value })} required /></Field>
        <Btn type="submit" disabled={busy}>{acct.data.has_pin ? 'Change PIN' : 'Make PIN'}</Btn>
      </form>
    </div>
  );
};
