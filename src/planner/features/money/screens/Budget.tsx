// /money/budget — a monthly amount per spending category.
import { useMemo, useState } from 'react';
import { Page, Header, Card, Button, Input, useToast } from '../../../ui/primitives';
import { putDoc } from '../../../lib/docs';
import { useMoney } from '../useMoney';
import { SPENDING_CATEGORIES } from '../categories';
import { budgetTotal, money, monthKey, shiftMonth, sumByCategory, round2 } from '../lib';
import { CategoryIcon } from '../CategoryIcon';
import type { Budget as BudgetDoc } from '../types';

export function Budget() {
  const m = monthKey();
  const { months, budget: saved, loading } = useMoney(shiftMonth(m, -3), shiftMonth(m, -1));
  const [draft, setDraft] = useState<BudgetDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, say] = useToast();
  const b = draft ?? saved;
  const total = budgetTotal(b);

  // the last 3 full months' average per category
  const avg = useMemo(() => {
    const keys = [1, 2, 3].map(i => shiftMonth(m, -i));
    const sums: Record<string, number> = {};
    let n = 0;
    for (const k of keys) { const rows = months[k]; if (!rows?.length) continue; n++; for (const [c, v] of Object.entries(sumByCategory(rows))) sums[c] = (sums[c] || 0) + v; }
    const out: Record<string, number> = {};
    if (n) for (const [c, v] of Object.entries(sums)) out[c] = Math.ceil(v / n / 5) * 5;
    return { out, n };
  }, [months, m]);

  const setCat = (c: string, v: string) => setDraft({ ...b, [c]: v === '' ? 0 : Math.max(0, Number(v) || 0) });
  async function save() {
    setBusy(true);
    try { const clean: BudgetDoc = {}; for (const [k, v] of Object.entries(b)) if (v > 0) clean[k] = round2(v); await putDoc('budget', 'current', clean); setDraft(null); say('Budget saved', 'good'); }
    catch (e) { say(e instanceof Error ? e.message : 'Could not save', 'bad'); }
    finally { setBusy(false); }
  }

  return (
    <Page>
      <Header title="Budget" eyebrow="Per month" back="/money" />
      <Card className="pl-row">
        <div className="pl-grow"><p className="pl-eyebrow">Total</p><h2>{money(total, { whole: true })}</h2></div>
        <Button small disabled={!avg.n || loading} onClick={() => setDraft({ ...b, ...avg.out })}>Suggest from last {avg.n || 3} month{avg.n === 1 ? '' : 's'}</Button>
      </Card>
      <Card>
        <div className="pl-list">
          {SPENDING_CATEGORIES.map(c => (
            <div key={c} className="mo-budget-row">
              <CategoryIcon name={c} size={18} />
              <div className="pl-grow"><b style={{ fontSize: 15 }}>{c}</b>{avg.out[c] ? <><br /><small className="pl-muted">avg {money(avg.out[c], { whole: true })}</small></> : null}</div>
              <Input inputMode="decimal" placeholder="0" value={b[c] ? String(b[c]) : ''} onChange={e => setCat(c, e.target.value)} />
            </div>
          ))}
        </div>
      </Card>
      <Button primary block disabled={busy || !draft} onClick={() => void save()}>{busy ? 'Saving…' : 'Save budget'}</Button>
      {toast}
    </Page>
  );
}
