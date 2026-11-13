// /money/recurring — what charges on a regular beat (weekly to yearly), what that adds up to a month, and what seems to
// have stopped. The detection is in ../recurring.ts.
import { useMemo, useState } from 'react';
import { RefreshCw, EyeOff } from 'lucide-react';
import { Page, Header, Card, Button, Stat, Empty, useToast } from '../../../ui/primitives';
import { useDoc } from '../../../lib/useDoc';
import { useMoney } from '../useMoney';
import { dayLabel, money, monthKey } from '../lib';
import { cadenceLabel, findRecurring, monthlyCost, recurringFrom, type Recurring as Line } from '../recurring';
import { CategoryIcon } from '../CategoryIcon';
import type { RecurringPrefs } from '../types';

const pretty = (s: string) => s.replace(/\s+_[A-Z]\b/g, '').replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase());

export function Recurring() {
  const m = monthKey();
  const { months, loading } = useMoney(recurringFrom(m), m);
  const prefs = useDoc<RecurringPrefs>('moneyprefs', 'recurringIgnore', { ignore: [] }, 300);
  const [showHidden, setShowHidden] = useState(false);
  const [toast, say] = useToast();
  const list = useMemo(() => findRecurring(months, m, showHidden ? [] : prefs.data.ignore), [months, m, prefs.data.ignore, showHidden]);
  const isHidden = (r: Line) => r.names.some(n => prefs.data.ignore.includes(n));
  const active = list.filter(r => r.active);
  const stopped = list.filter(r => !r.active);
  const total = active.filter(r => !isHidden(r)).reduce((s, r) => s + monthlyCost(r), 0);
  const d = new Date();
  const today = `${m}-${String(d.getDate()).padStart(2, '0')}`;

  const row = (r: Line) => {
    const hidden = isHidden(r);
    const bits = [cadenceLabel(r.cadence)];
    if (r.active) bits.push(r.next >= today ? `next ${dayLabel(r.next)}` : `due ${dayLabel(r.next)}`);
    else bits.push(`last ${dayLabel(r.last)}`);
    if (r.prevAmount !== undefined) bits.push(`${r.lastAmount > r.prevAmount ? 'up' : 'down'} from ${money(r.prevAmount)}`);
    else if (r.varies) bits.push(`last ${money(r.lastAmount)}, varies`);
    const perMonth = r.cadence === 'monthly' || !r.active;
    return (
      <div key={r.id} className="mo-txn" style={{ opacity: hidden ? 0.5 : 1 }}>
        <CategoryIcon name={r.category} size={20} />
        <div className="mo-txn__main">
          <b>{pretty(r.merchant)}</b>
          <small>{bits.join(' · ')}</small>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="mo-amt">{money(perMonth ? r.avg : monthlyCost(r))}<span className="pl-muted" style={{ fontWeight: 400, fontSize: 11 }}>{perMonth ? (r.cadence === 'monthly' ? '/mo' : ` ${cadenceLabel(r.cadence)}`) : '/mo'}</span></span>
          {!perMonth && <><br /><small className="pl-muted">{money(r.avg)} {cadenceLabel(r.cadence)}</small></>}
          <br />
          <button type="button" className="mo-catchip" onClick={() => {
            prefs.update(p => ({ ignore: hidden ? p.ignore.filter(x => !r.names.includes(x)) : [...new Set([...p.ignore, ...r.names])] }));
            say(hidden ? 'Shown again' : 'Marked not recurring');
          }}>
            <EyeOff style={{ width: 12, height: 12 }} /> {hidden ? 'Show' : 'Not recurring'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <Page>
      <Header title="Recurring" eyebrow="Bills & subscriptions" back="/money" />
      <Card>
        <div className="pl-stats">
          <Stat label="Per month" value={money(total, { whole: true })} sub={`${active.length} recurring`} />
          <Stat label="Per year" value={money(total * 12, { whole: true })} />
        </div>
      </Card>
      {!loading && list.length === 0 ? (
        <Card><Empty icon={<RefreshCw />} title="Nothing recurring yet" blurb="With 3 months or more of transactions, the charges that come back on a regular beat show up here." /></Card>
      ) : (
        <>
          {active.length > 0 && <Card><div className="pl-list">{active.map(row)}</div></Card>}
          {stopped.length > 0 && (
            <Card>
              <h3 style={{ margin: '0 0 4px' }}>Seem to have stopped</h3>
              <small className="pl-muted">They missed their usual date: cancelled, or now on another card. Not in the total.</small>
              <div className="pl-list" style={{ marginTop: 8 }}>{stopped.map(row)}</div>
            </Card>
          )}
        </>
      )}
      {prefs.data.ignore.length > 0 && <Button ghost block onClick={() => setShowHidden(v => !v)}>{showHidden ? 'Hide' : `Show ${prefs.data.ignore.length} hidden`}</Button>}
      {toast}
    </Page>
  );
}
