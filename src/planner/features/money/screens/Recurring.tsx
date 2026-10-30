// /money/recurring — what charges every month, and what that adds up to.
import { useMemo, useState } from 'react';
import { RefreshCw, EyeOff } from 'lucide-react';
import { Page, Header, Card, Button, Stat, Empty, useToast } from '../../../ui/primitives';
import { useDoc } from '../../../lib/useDoc';
import { useMoney } from '../useMoney';
import { dayLabel, money, monthKey, shiftMonth } from '../lib';
import { findRecurring, monthlyCost } from '../recurring';
import { CategoryIcon } from '../CategoryIcon';
import type { RecurringPrefs } from '../types';

export function Recurring() {
  const m = monthKey();
  const { months, loading } = useMoney(shiftMonth(m, -3), m);
  const prefs = useDoc<RecurringPrefs>('prefs', 'recurringIgnore', { ignore: [] }, 300);
  const [showHidden, setShowHidden] = useState(false);
  const [toast, say] = useToast();
  const list = useMemo(() => findRecurring(months, m, showHidden ? [] : prefs.data.ignore), [months, m, prefs.data.ignore, showHidden]);
  const total = list.filter(r => !prefs.data.ignore.includes(r.merchant)).reduce((s, r) => s + monthlyCost(r), 0);
  const pretty = (s: string) => s.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase());
  const today = `${m}-${String(new Date().getDate()).padStart(2, '0')}`;

  return (
    <Page>
      <Header title="Recurring" eyebrow="Bills & subscriptions" back="/money" />
      <Card>
        <div className="pl-stats">
          <Stat label="Per month" value={money(total, { whole: true })} sub={`${list.length} recurring`} />
          <Stat label="Per year" value={money(total * 12, { whole: true })} />
        </div>
      </Card>
      {!loading && list.length === 0 ? (
        <Card><Empty icon={<RefreshCw />} title="Nothing recurring yet" blurb="Import 3+ months and the bills that repeat show up here." /></Card>
      ) : (
        <Card>
          <div className="pl-list">
            {list.map(r => {
              const hidden = prefs.data.ignore.includes(r.merchant);
              return (
                <div key={r.merchant} className="mo-txn" style={{ opacity: hidden ? 0.5 : 1 }}>
                  <CategoryIcon name={r.category} size={20} />
                  <div className="mo-txn__main">
                    <b>{pretty(r.merchant)}</b>
                    <small>{r.cadence} · next {r.next >= today ? dayLabel(r.next) : `was due ${dayLabel(r.next)}`}{r.lastAmount !== r.avg ? ` · last ${money(r.lastAmount)}` : ''}</small>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="mo-amt">{money(monthlyCost(r))}<span className="pl-muted" style={{ fontWeight: 400, fontSize: 11 }}>/mo</span></span><br />
                    <button type="button" className="mo-catchip" onClick={() => { prefs.update(p => ({ ignore: hidden ? p.ignore.filter(x => x !== r.merchant) : [...p.ignore, r.merchant] })); say(hidden ? 'Shown again' : 'Marked not recurring'); }}>
                      <EyeOff style={{ width: 12, height: 12 }} /> {hidden ? 'Show' : 'Not recurring'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {prefs.data.ignore.length > 0 && <Button ghost block onClick={() => setShowHidden(v => !v)}>{showHidden ? 'Hide' : `Show ${prefs.data.ignore.length} hidden`}</Button>}
      {toast}
    </Page>
  );
}
