// Editing an earlier day's payouts, sale by sale, until a payslip is generated for it. Every cart
// shows who was on it (splits, machine rental, deductions), its sales, the EQ, crackfiller and
// bonuses; each change re-works the pay with the payout engine, and Save replaces the day's carts,
// sales and payout lines together. A cart that wasn't paid out before its day was handed off is
// finished here: tick Paid out and its members get their payout lines.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { useLoad } from '../../../lib/data';
import { listHires, fullName, type Hire } from '../../../lib/workerbook';
import {
  cartContext, cartLines, cartProblems, cartStats, isFinalized, saveDay, PAYMENT_TYPES, SALE_TYPES,
  type CartContext, type CartMember, type CartSale, type PayoutCart,
} from '../../../lib/payoutCarts';
import type { NewLine, PayoutLine } from '../../../lib/payslips';
import { Btn, ErrorBox, Loading, Tag } from '../../../ui';
import { ContractorLink } from '../ContractorCard';

const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v * 100) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const blankSale = (route = ''): CartSale => ({ route_code: route || null, address: null, client_name: null, price: 0, payment_type: 'Cash', payments: null, type: 'Sale', service: 'SS', notes: null, meta: {} });

export const PayoutEditor: React.FC<{
  centerId: string; region: string; date: string; initial: PayoutCart[]; saved: PayoutLine[]; onCancel: () => void; onSaved: () => void;
  /** open this worker's cart */
  openCn?: string | null;
}> = ({ centerId, region, date, initial, saved, onCancel, onSaved, openCn }) => {
  const [carts, setCarts] = useState<PayoutCart[]>(() => JSON.parse(JSON.stringify(initial)));
  const [open, setOpen] = useState<number | null>(() => {
    const i = openCn ? initial.findIndex(c => c.members.some(m => m.cn.toUpperCase() === openCn.toUpperCase())) : -1;
    return i >= 0 ? i : null;
  });
  useEffect(() => {
    if (open == null || !openCn) return;
    const t = setTimeout(() => document.getElementById(`v2-cart-${open}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
    return () => clearTimeout(t);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const hires = useLoad(() => listHires(Number(date.slice(0, 4))), [date]);
  const crew = useMemo(() => (hires.data || []).filter(h => h.center_id === centerId), [hires.data, centerId]);

  // the context (rate card, each member's days and Silver Hats) follows who's on the carts
  const memberKey = carts.flatMap(c => c.members.map(m => m.hire_id || '')).sort().join(',');
  const ctx = useLoad(() => cartContext(centerId, region, date, carts), [centerId, region, date, memberKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  // pay, worked out again after each change
  const [calc, setCalc] = useState<{ lines: NewLine[][]; eq: number[] } | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!ctx.data) return;
    const my = ++seq.current; const c = ctx.data as CartContext;
    const t = setTimeout(async () => {
      try {
        const [lines, stats] = await Promise.all([Promise.all(carts.map(x => cartLines(x, c))), Promise.all(carts.map(x => cartStats(x, c.service, c.settings)))]);
        if (my === seq.current) setCalc({ lines, eq: stats.map(s => s.totalEQ || 0) });
      } catch (e) { if (my === seq.current) setError(e); }
    }, 150);
    return () => clearTimeout(t);
  }, [carts, ctx.data]);

  const change = (i: number, f: (c: PayoutCart) => PayoutCart) => { setDirty(true); setCarts(cs => cs.map((c, j) => (j === i ? f(c) : c))); };
  const setSale = (i: number, k: number, patch: Partial<CartSale>) => change(i, c => ({ ...c, sales: c.sales.map((s, j) => (j === k ? { ...s, ...patch } : s)) }));
  const setMember = (i: number, k: number, patch: Partial<CartMember>) => change(i, c => ({ ...c, members: c.members.map((m, j) => (j === k ? { ...m, ...patch } : m)) }));
  const evenSplit = (i: number) => change(i, c => { const e = Math.round((100 / Math.max(1, c.members.length)) * 10000) / 10000; return { ...c, members: c.members.map(m => ({ ...m, equiv_split: e, upsell_split: e })) }; });
  const addMember = (i: number, h: Hire) => change(i, c => {
    const members = [...c.members, { hire_id: h.id, cn: h.cn, first_name: h.person.first_name, last_name: h.person.last_name, equiv_split: 0, upsell_split: 0, machine_rental: 10, deductions: 0 }];
    const e = Math.round((100 / members.length) * 10000) / 10000;
    return { ...c, members: members.map(m => ({ ...m, equiv_split: e, upsell_split: e })) };
  });
  const removeMember = (i: number, k: number) => change(i, c => {
    const members = c.members.filter((_, j) => j !== k); const e = members.length ? Math.round((100 / members.length) * 10000) / 10000 : 0;
    return { ...c, members: members.map(m => ({ ...m, equiv_split: e, upsell_split: e })) };
  });
  const addCart = () => { setDirty(true); setCarts(cs => [...cs, { label: `Cart ${cs.length + 1}`, manager: cs[0]?.manager || null, members: [], eq_override: null, crackfill_lbs: 0, bonuses: [], settings: cs[0]?.settings || {}, notes: null, source: 'edited', finalized: true, sales: [] }]); setOpen(carts.length); };

  const problems = cartProblems(carts);
  const onCart = new Set(carts.flatMap(c => c.members.map(m => m.cn)));
  const before = saved.reduce((a, l) => a + n(l.total_payout), 0);
  // the day's pay: paid-out carts only (a cart not paid out yet has no lines)
  const after = calc ? calc.lines.filter((_, i) => isFinalized(carts[i] || {})).flat().reduce((a, l) => a + l.total_payout, 0) : before;
  const pending = carts.filter(c => !isFinalized(c) && c.sales.length).length;

  const save = async () => {
    if (!ctx.data || problems.length) return;
    setBusy(true); setError(null);
    try {
      const lines = (await Promise.all(carts.filter(isFinalized).map(c => cartLines(c, ctx.data as CartContext)))).flat();
      await saveDay(centerId, date, carts.map(c => ({ ...c, source: c.source === 'close_day' || c.source === 'payout_stats_sheet' ? `${c.source}+edited` : c.source || 'edited' })), lines);
      onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  if (ctx.loading && !ctx.data) return <Loading />;
  return (
    <div className="v2-stack" style={{ gap: 12 }}>
      <div className="v2-card v2-row" style={{ position: 'sticky', top: 66, zIndex: 5, gap: 10, flexWrap: 'wrap' }}>
        <b>Editing payouts</b>
        <span className="v2-small">Day pay {money(before)} → <b>{money(after)}</b>{Math.abs(after - before) > 0.005 && <> <Tag tone={after > before ? 'g' : 'r'}>{after > before ? '+' : ''}{money(after - before)}</Tag></>}</span>
        <span className="v2-spacer" />
        <Btn kind="o" onClick={addCart} icon={Plus}>Add cart</Btn>
        <Btn kind="o" onClick={onCancel}>Cancel</Btn>
        <Btn kind="g" disabled={!dirty || busy || problems.length > 0 || !calc} onClick={save}>{busy ? 'Saving…' : 'Save payouts'}</Btn>
        {pending > 0 && <div className="v2-small v2-mut" style={{ width: '100%' }}>{pending} cart{pending === 1 ? '' : 's'} not paid out yet: open it, check it, tick <b>Paid out</b>, then save.</div>}
        {problems.length > 0 && <div className="v2-err" style={{ width: '100%', margin: 0 }}>{problems.map(p => <div key={p}>{p}</div>)}</div>}
        <ErrorBox error={error || ctx.error || hires.error} />
      </div>

      {carts.map((c, i) => {
        const lines = calc?.lines[i] || []; const isOpen = open === i;
        const gross = c.sales.reduce((a, s) => a + n(s.price), 0);
        const salesEQ = calc?.eq[i] ?? 0; const eq = c.eq_override ?? salesEQ;
        const pay = lines.reduce((a, l) => a + l.total_payout, 0);
        return (
          <section key={i} id={`v2-cart-${i}`} className="v2-card" style={{ padding: 0, scrollMarginTop: 200 }}>
            <button type="button" className="v2-row v2-cart-head" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen}>
              {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <b>{c.label || `Cart ${i + 1}`}</b>{!isFinalized(c) && <Tag tone="a">Pending</Tag>}
              <span className="v2-small v2-mut">{c.members.map(m => `${m.first_name} ${m.last_name}`.trim()).join(' · ') || 'nobody on it'}</span>
              <span className="v2-spacer" />
              <span className="v2-small">{c.sales.length} sale{c.sales.length === 1 ? "" : "s"} · {money(gross)} · {eq.toFixed(2)} EQ{c.eq_override != null && ' (set)'} · pay <b>{money(pay)}</b>{!isFinalized(c) && ' when paid out'}</span>
            </button>
            {isOpen && (
              <div style={{ padding: '0 14px 14px' }}>
                <div className="v2-row" style={{ gap: 8, marginBottom: 10 }}>
                  <label className="v2-small">Name <input className="v2-input" style={{ width: 200, padding: '5px 8px' }} value={c.label} onChange={e => change(i, x => ({ ...x, label: e.target.value }))} /></label>
                  <label className="v2-small">Manager <input className="v2-input" style={{ width: 180, padding: '5px 8px' }} value={c.manager || ''} onChange={e => change(i, x => ({ ...x, manager: e.target.value || null }))} /></label>
                  <label className="v2-row v2-small" style={{ gap: 6 }} title="Paid out: its members get their payout lines, and the day can be closed">
                    <input type="checkbox" checked={isFinalized(c)} onChange={e => change(i, x => ({ ...x, finalized: e.target.checked }))} aria-label={`${c.label || `Cart ${i + 1}`} paid out`} /><b>Paid out</b>
                  </label>
                  <span className="v2-spacer" />
                  <Btn size="sm" kind="r" icon={Trash2} onClick={() => {
                    if (c.sales.length && confirmRemove !== i) { setConfirmRemove(i); return; }
                    setDirty(true); setCarts(cs => cs.filter((_, j) => j !== i)); setOpen(null); setConfirmRemove(null);
                  }}>{confirmRemove === i ? `Remove it and its ${c.sales.length} sales` : 'Remove cart'}</Btn>
                </div>

                <div className="v2-card-h">On the cart</div>
                <div className="v2-table-wrap">
                  <table className="v2-table v2-edit">
                    <thead><tr><th>Name</th><th>EQ split %</th><th>Upsell split %</th><th>Machine $</th><th>Deductions $</th><th style={{ textAlign: 'right' }}>EQ</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Pay</th><th /></tr></thead>
                    <tbody>
                      {c.members.map((m, k) => {
                        const l = lines.find(x => x.cn === m.cn);
                        return (
                          <tr key={m.cn}>
                            <td><ContractorLink hireId={m.hire_id}>{m.first_name} {m.last_name}</ContractorLink> <span className="v2-mut v2-small">{m.cn}</span></td>
                            <td><NumIn v={m.equiv_split} on={v => setMember(i, k, { equiv_split: v })} label={`EQ split for ${m.first_name}`} /></td>
                            <td><NumIn v={m.upsell_split} on={v => setMember(i, k, { upsell_split: v })} label={`Upsell split for ${m.first_name}`} /></td>
                            <td><NumIn v={m.machine_rental} on={v => setMember(i, k, { machine_rental: v })} label={`Machine rental for ${m.first_name}`} /></td>
                            <td><NumIn v={m.deductions} on={v => setMember(i, k, { deductions: v })} label={`Deductions for ${m.first_name}`} /></td>
                            <td style={{ textAlign: 'right' }}>{l ? l.equiv.toFixed(2) : '—'}</td>
                            <td style={{ textAlign: 'right' }}>{l ? l.payout_rate.toFixed(2) : '—'}</td>
                            <td style={{ textAlign: 'right' }}><b>{l ? money(l.total_payout) : '—'}</b></td>
                            <td><button type="button" className="v2-x" onClick={() => removeMember(i, k)} aria-label={`Take ${m.first_name} off the cart`}><X size={14} /></button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="v2-row" style={{ gap: 8, margin: '8px 0 14px' }}>
                  <select className="v2-sel" style={{ width: 260, padding: '5px 8px' }} value="" aria-label="Add someone to the cart"
                    onChange={e => { const h = crew.find(x => x.id === e.target.value); if (h) addMember(i, h); }}>
                    <option value="">Add someone…</option>
                    {crew.filter(h => !onCart.has(h.cn)).sort((a, b) => fullName(a.person).localeCompare(fullName(b.person))).map(h => <option key={h.id} value={h.id}>{fullName(h.person)} · {h.cn}</option>)}
                  </select>
                  {c.members.length > 1 && <Btn size="sm" kind="o" onClick={() => evenSplit(i)}>Even split</Btn>}
                </div>

                <div className="v2-grid2" style={{ gap: 12, marginBottom: 12 }}>
                  <div className="v2-card" style={{ padding: 10 }}>
                    <div className="v2-card-h" style={{ marginBottom: 6 }}>EQ</div>
                    <div className="v2-small">From the sales: <b>{salesEQ.toFixed(2)}</b></div>
                    {c.eq_override != null ? (
                      <div className="v2-row v2-small" style={{ gap: 6, marginTop: 6 }}>Set at payout:
                        <NumIn v={c.eq_override} on={v => change(i, x => ({ ...x, eq_override: v }))} label="EQ set at payout" />
                        <Btn size="sm" kind="o" onClick={() => change(i, x => ({ ...x, eq_override: null }))}>Use the sales</Btn></div>
                    ) : <Btn size="sm" kind="o" onClick={() => change(i, x => ({ ...x, eq_override: Math.round(salesEQ * 100) / 100 }))}>Set the EQ by hand</Btn>}
                    <div className="v2-row v2-small" style={{ gap: 6, marginTop: 8 }}>Crackfiller lbs <NumIn v={c.crackfill_lbs} on={v => change(i, x => ({ ...x, crackfill_lbs: v }))} label="Crackfiller pounds" /></div>
                  </div>
                  <div className="v2-card" style={{ padding: 10 }}>
                    <div className="v2-card-h" style={{ marginBottom: 6 }}>Bonuses <span className="v2-mut" style={{ textTransform: 'none', fontWeight: 600 }}>· shared by EQ split</span></div>
                    {c.bonuses.map((b, k) => (
                      <div key={k} className="v2-row" style={{ gap: 6, marginBottom: 4 }}>
                        <input className="v2-input" style={{ flex: 1, padding: '4px 8px' }} value={b.label} aria-label="Bonus" onChange={e => change(i, x => ({ ...x, bonuses: x.bonuses.map((y, j) => j === k ? { ...y, label: e.target.value } : y) }))} />
                        <NumIn v={b.amount} on={v => change(i, x => ({ ...x, bonuses: x.bonuses.map((y, j) => j === k ? { ...y, amount: v } : y) }))} label="Bonus amount" />
                        <button type="button" className="v2-x" aria-label="Remove bonus" onClick={() => change(i, x => ({ ...x, bonuses: x.bonuses.filter((_, j) => j !== k) }))}><X size={14} /></button>
                      </div>
                    ))}
                    <Btn size="sm" kind="o" icon={Plus} onClick={() => change(i, x => ({ ...x, bonuses: [...x.bonuses, { label: 'Bonus', amount: 0 }] }))}>Add bonus</Btn>
                  </div>
                </div>

                <div className="v2-card-h">Sales ({c.sales.length})</div>
                <div className="v2-table-wrap">
                  <table className="v2-table v2-edit">
                    <thead><tr><th>Route</th><th>Address</th><th>Client</th><th>Service</th><th>Type</th><th>Paid by</th><th style={{ textAlign: 'right' }}>Price</th><th>Notes</th><th /></tr></thead>
                    <tbody>
                      {c.sales.map((s, k) => (
                        <tr key={k}>
                          <td><TextIn v={s.route_code} w={70} on={v => setSale(i, k, { route_code: v })} label="Route" /></td>
                          <td><TextIn v={s.address} w={170} on={v => setSale(i, k, { address: v })} label="Address" /></td>
                          <td><TextIn v={s.client_name} w={140} on={v => setSale(i, k, { client_name: v })} label="Client" /></td>
                          <td><TextIn v={s.service} w={60} on={v => setSale(i, k, { service: v })} label="Service" /></td>
                          <td><select className="v2-sel v2-cell" value={s.type} aria-label="Type" onChange={e => setSale(i, k, { type: e.target.value as CartSale['type'] })}>{SALE_TYPES.map(t => <option key={t}>{t}</option>)}</select></td>
                          <td>{s.payments && Object.keys(s.payments).length > 1 ? (
                            <span className="v2-small">{Object.entries(s.payments).map(([m, a]) => `${m} ${money(n(a))}`).join(' + ')} <button type="button" className="v2-link v2-small" onClick={() => setSale(i, k, { payments: null })}>make single</button></span>
                          ) : <select className="v2-sel v2-cell" value={s.payment_type} aria-label="Paid by" onChange={e => setSale(i, k, { payment_type: e.target.value, payments: null })}>
                            {[...new Set([...PAYMENT_TYPES, s.payment_type])].map(t => <option key={t}>{t}</option>)}</select>}</td>
                          <td style={{ textAlign: 'right' }}><NumIn v={s.price} on={v => setSale(i, k, { price: v })} label="Price" w={84} /></td>
                          <td><TextIn v={s.notes} w={140} on={v => setSale(i, k, { notes: v })} label="Notes" /></td>
                          <td><button type="button" className="v2-x" aria-label="Remove sale" onClick={() => change(i, x => ({ ...x, sales: x.sales.filter((_, j) => j !== k) }))}><X size={14} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 8 }}><Btn size="sm" kind="o" icon={Plus} onClick={() => change(i, x => ({ ...x, sales: [...x.sales, blankSale(x.sales[x.sales.length - 1]?.route_code || '')] }))}>Add sale</Btn></div>
              </div>
            )}
          </section>
        );
      })}
      {!carts.length && <div className="v2-card v2-mut">No carts on this day. Add one to start.</div>}
      <div className="v2-note">Prices are what the client paid (tax included). Card numbers are never entered here.</div>
    </div>
  );
};

const NumIn: React.FC<{ v: number; on: (v: number) => void; label: string; w?: number }> = ({ v, on, label, w = 72 }) => {
  const [t, setT] = useState(String(v ?? 0));
  useEffect(() => { if (Number(t) !== Number(v)) setT(String(v ?? 0)); }, [v]);   // eslint-disable-line react-hooks/exhaustive-deps
  return <input className="v2-input v2-cell" style={{ width: w, textAlign: 'right' }} inputMode="decimal" aria-label={label} value={t}
    onChange={e => { const s = e.target.value.replace(/[^\d.\-]/g, ''); setT(s); const x = Number(s); if (s !== '' && s !== '-' && Number.isFinite(x)) on(x); }} />;
};
const TextIn: React.FC<{ v: string | null; on: (v: string | null) => void; label: string; w?: number }> = ({ v, on, label, w = 120 }) => (
  <input className="v2-input v2-cell" style={{ width: w }} aria-label={label} value={v || ''} onChange={e => on(e.target.value || null)} />
);
