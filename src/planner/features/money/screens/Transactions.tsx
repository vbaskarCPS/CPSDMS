// /money/transactions — every line, grouped by day; tap the category to change it (and teach a rule).
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { Page, Header, Card, Button, Input, Sheet, Empty, useToast } from '../../../ui/primitives';
import { putDoc } from '../../../lib/docs';
import { useMoney, allRows } from '../useMoney';
import { CATEGORIES } from '../categories';
import { dayLabel, money, monthKey, monthLabel, recategorize, shiftMonth } from '../lib';
import { CategoryIcon } from '../CategoryIcon';
import type { Txn } from '../types';

export function Transactions() {
  const [params, setParams] = useSearchParams();
  const m = params.get('m') || monthKey();
  const cat = params.get('cat') || '';
  const acc = params.get('acc') || '';
  const q = params.get('q') || '';
  const { accounts, months, loading, setData } = useMoney(shiftMonth(m, -11), m);   // a year back, so "apply to others" reaches
  const [pick, setPick] = useState<Txn | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyAll, setApplyAll] = useState(true);
  const [toast, say] = useToast();

  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const accName = (id: string) => accounts.find(a => a.id === id)?.name || '';

  const rows = useMemo(() => {
    const base = q ? allRows(months) : months[m] || [];
    const needle = q.trim().toUpperCase();
    return base.filter(t => (!cat || t.category === cat) && (!acc || t.accountId === acc) && (!needle || t.desc.toUpperCase().includes(needle) || t.merchant.includes(needle)))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [months, m, cat, acc, q]);

  const days = useMemo(() => {
    const out: { day: string; rows: Txn[]; total: number }[] = [];
    for (const t of rows) {
      let d = out[out.length - 1];
      if (!d || d.day !== t.date) { d = { day: t.date, rows: [], total: 0 }; out.push(d); }
      d.rows.push(t); if (t.amount < 0) d.total += -t.amount;
    }
    return out;
  }, [rows]);

  const others = useMemo(() => (pick ? allRows(months).filter(t => t.merchant === pick.merchant && t.id !== pick.id) : []), [pick, months]);

  async function change(category: string, applyAll: boolean) {
    if (!pick) return;
    setBusy(true);
    try {
      const ids = new Set([pick.id, ...(applyAll ? others.map(t => t.id) : [])]);
      const next = structuredClone(months);
      await recategorize(next, ids, category);
      await putDoc('rule', pick.merchant, { category });
      setData(d => ({ ...d, months: next, rules: { ...d.rules, [pick.merchant]: category } }));
      say(applyAll && others.length ? `${category} · applied to ${ids.size}` : category, 'good');
      setPick(null);
    } catch (e) { say(e instanceof Error ? e.message : 'Could not save', 'bad'); }
    finally { setBusy(false); }
  }

  return (
    <Page>
      <Header title={cat || 'Transactions'} eyebrow={q ? 'Search · last 12 months' : monthLabel(m)} back="/money" />
      <div className="mo-search pl-row">
        <div className="pl-grow" style={{ position: 'relative' }}>
          <Search style={{ position: 'absolute', left: 12, top: 14, width: 18, height: 18, color: 'var(--ink-2)' }} />
          <Input value={q} placeholder="Search merchants" style={{ paddingLeft: 38 }} onChange={e => set('q', e.target.value)} />
        </div>
        {(cat || acc || q) && <Button small ghost aria-label="Clear filters" onClick={() => { const p = new URLSearchParams(); p.set('m', m); setParams(p, { replace: true }); }}><X /></Button>}
      </div>
      {!q && (
        <div className="pl-row" style={{ justifyContent: 'space-between' }}>
          <Button small ghost onClick={() => set('m', shiftMonth(m, -1))}>‹ {monthLabel(shiftMonth(m, -1)).split(' ')[0]}</Button>
          {accounts.length > 1 && (
            <select className="pl-input" style={{ minHeight: 36, width: 'auto', padding: '0 10px', fontSize: 14 }} value={acc} onChange={e => set('acc', e.target.value)}>
              <option value="">All accounts</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <Button small ghost disabled={m >= monthKey()} onClick={() => set('m', shiftMonth(m, 1))}>{monthLabel(shiftMonth(m, 1)).split(' ')[0]} ›</Button>
        </div>
      )}

      {!loading && rows.length === 0 ? <Card><Empty title="Nothing here" blurb={q ? 'No merchant matches that.' : 'No transactions for this view.'} /></Card> : (
        <Card>
          {days.map(d => (
            <div key={d.day}>
              <div className="mo-day"><span>{dayLabel(d.day)}</span>{d.total > 0 && <span>{money(d.total)}</span>}</div>
              <div className="pl-list">
                {d.rows.map(t => (
                  <div key={t.id} className="mo-txn">
                    <CategoryIcon name={t.category} size={20} />
                    <div className="mo-txn__main">
                      <b>{t.merchant.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase())}</b>
                      <small>{t.desc}{accounts.length > 1 ? ` · ${accName(t.accountId)}` : ''}</small>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span className={`mo-amt ${t.amount > 0 ? 'mo-amt--in' : ''}`}>{money(t.amount, { sign: true })}</span>
                      <button type="button" className="mo-catchip" onClick={() => setPick(t)}>{t.category}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}

      <Sheet open={!!pick} onClose={() => setPick(null)} title={pick?.merchant.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase())}>
        {pick && (
          <>
            <p className="pl-muted" style={{ fontSize: 13 }}>{pick.desc} · {money(pick.amount, { sign: true })}{others.length ? ` · ${others.length} other${others.length === 1 ? '' : 's'} from this merchant` : ''}</p>
            {others.length > 0 && (
              <label className="pl-row" style={{ fontSize: 14, fontWeight: 600 }}>
                <input type="checkbox" checked={applyAll} onChange={e => setApplyAll(e.target.checked)} style={{ width: 20, height: 20 }} />
                Apply to all {others.length + 1} from this merchant
              </label>
            )}
            <div className="mo-catgrid">
              {CATEGORIES.map(c => (
                <button key={c.name} type="button" disabled={busy} className={`pl-btn pl-btn--small ${pick.category === c.name ? 'is-on' : ''}`} onClick={() => void change(c.name, applyAll && others.length > 0)}>
                  <CategoryIcon name={c.name} /> {c.name}
                </button>
              ))}
            </div>
            <p className="pl-muted" style={{ fontSize: 12 }}>Future imports of "{pick.merchant}" get this category.</p>
          </>
        )}
      </Sheet>
      {toast}
    </Page>
  );
}
