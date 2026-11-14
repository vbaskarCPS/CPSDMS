// /money — the month at a glance. Snap a receipt or log cash from the top; opening it also matches any receipt
// whose card charge has come in since (receipts.ts matchPending).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Upload, ListOrdered, PiggyBank, Landmark, RefreshCw, Wallet, Camera, Banknote, Receipt as ReceiptIcon } from 'lucide-react';
import { Page, Header, Card, Button, Progress, Stat, Empty, Bars, useToast } from '../../../ui/primitives';
import { useMoney } from '../useMoney';
import { budgetTotal, dailySpend, money, monthKey, monthLabel, shiftMonth, sumByCategory, todayIso, totals, daysInMonth } from '../lib';
import { CategoryIcon, categoryColor } from '../CategoryIcon';
import { loadReceipts, matchPending } from '../receipts';
import { FIRST_MONTHS, monthsBack, unmatchedEmailReceipts } from '../mailReceipts';

export function Overview() {
  const [m, setM] = useState(monthKey());
  const { accounts, months, budget, loading, error, reload } = useMoney(shiftMonth(m, -3), m);
  const [toast, say] = useToast();
  const [notMatched, setNotMatched] = useState(0);
  // receipts waiting for their card charge: match the ones that have come in
  useEffect(() => {
    let on = true;
    matchPending().then(res => { if (on && res.linked.length) { say(`${res.linked.length} receipt${res.linked.length === 1 ? '' : 's'} matched to the bank`, 'good'); void reload(); } }).catch(() => undefined)
      // then: receipts from email still without their bank row (Receipts › Not matched)
      .then(() => loadReceipts(monthsBack(todayIso(), FIRST_MONTHS + 1))).then(rs => { if (on && rs) setNotMatched(unmatchedEmailReceipts(rs).length); }).catch(() => undefined);
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rows = months[m] || [];
  const t = useMemo(() => totals(rows), [rows]);
  const cats = useMemo(() => Object.entries(sumByCategory(rows)).sort((a, b) => b[1] - a[1]), [rows]);
  const bTotal = budgetTotal(budget);
  const daily = useMemo(() => dailySpend(rows, m), [rows, m]);
  const isThisMonth = m === monthKey();
  const dim = daysInMonth(m);
  const dayLabels = Array.from({ length: dim }, (_, i) => ((i + 1) % 7 === 1 ? String(i + 1) : ''));
  const anyData = Object.values(months).some(r => r.length);
  const live = accounts.filter(a => !a.archived);

  return (
    <Page>
      <Header title="Money" eyebrow="Personal accounts" right={<Link to="/money/import" className="pl-btn pl-btn--primary pl-btn--small"><Upload style={{ width: 16, height: 16 }} /> Import</Link>} />

      <div className="mo-month">
        <Button small ghost aria-label="Previous month" onClick={() => setM(shiftMonth(m, -1))}><ChevronLeft /></Button>
        <h2>{monthLabel(m)}</h2>
        <Button small ghost aria-label="Next month" disabled={isThisMonth} onClick={() => setM(shiftMonth(m, 1))}><ChevronRight /></Button>
      </div>

      {error && <p className="pl-error">{error}</p>}

      <div className="mo-quick">
        <Link to="/money/receipt" className="pl-btn"><Camera /> Receipt</Link>
        <Link to="/money/cash" className="pl-btn"><Banknote /> Cash</Link>
      </div>
      {notMatched > 0 && <Link to="/money/receipts" className="pl-muted" style={{ fontSize: 13 }}>{notMatched} receipt{notMatched === 1 ? '' : 's'} from email not matched ›</Link>}

      {!loading && !anyData ? (
        <Card><Empty icon={<Wallet />} title="No transactions yet" blurb="Download a CSV from TD EasyWeb and import it here. Categories, budgets and recurring bills fill in from there."
          action={<Link to="/money/import" className="pl-btn pl-btn--primary">Import a CSV</Link>} /></Card>
      ) : (
        <>
          <Card>
            <div className="pl-stats">
              <Stat label="Spent" value={money(t.spent, { whole: true })} sub={bTotal ? `of ${money(bTotal, { whole: true })} budget` : undefined} tone={bTotal && t.spent > bTotal ? 'bad' : undefined} />
              <Stat label="Income" value={money(t.income, { whole: true })} tone="good" />
              <Stat label="Net" value={money(t.net, { whole: true, sign: true })} tone={t.net < 0 ? 'bad' : 'good'} />
              <Stat label={bTotal ? 'Budget left' : 'Budget'} value={bTotal ? money(bTotal - t.spent, { whole: true, sign: false }) : '—'} sub={bTotal ? (isThisMonth ? `${dim - new Date().getDate()} days left` : undefined) : 'Set one'} tone={bTotal && bTotal - t.spent < 0 ? 'bad' : undefined} />
            </div>
            {bTotal > 0 && <div style={{ marginTop: 12 }}><Progress value={t.spent} max={bTotal} tone={t.spent > bTotal ? 'bad' : t.spent > bTotal * 0.8 ? 'amber' : 'good'} /></div>}
          </Card>

          <div className="mo-links">
            <Link to={`/money/transactions?m=${m}`}><ListOrdered /> All</Link>
            <Link to="/money/budget"><PiggyBank /> Budget</Link>
            <Link to="/money/receipts"><ReceiptIcon /> Receipts</Link>
            <Link to="/money/recurring"><RefreshCw /> Recurring</Link>
            <Link to="/money/accounts"><Landmark /> Accounts</Link>
          </div>

          <Card>
            <p className="pl-eyebrow">Spending by category</p>
            {cats.length === 0 ? <p className="pl-muted" style={{ marginTop: 8 }}>Nothing spent this month.</p> : (
              <div className="pl-list" style={{ marginTop: 4 }}>
                {cats.map(([name, amt]) => {
                  const b = Number(budget[name]) || 0;
                  const pct = b ? amt / b : 0;
                  return (
                    <Link key={name} to={`/money/transactions?m=${m}&cat=${encodeURIComponent(name)}`} className="mo-cat">
                      <div className="mo-cat__row">
                        <CategoryIcon name={name} size={18} />
                        <span className="pl-grow" style={{ fontWeight: 600, fontSize: 15 }}>{name}</span>
                        <span className="mo-amt">{money(amt)}</span>
                        {b > 0 && <span className="pl-muted" style={{ fontSize: 12, minWidth: 54, textAlign: 'right' }}>/ {money(b, { whole: true })}</span>}
                      </div>
                      {b > 0 ? <Progress value={amt} max={b} tone={pct > 1 ? 'bad' : pct > 0.8 ? 'amber' : 'good'} />
                        : <div className="pl-progress"><div className="pl-progress__bar" style={{ width: `${Math.min(100, (amt / (cats[0][1] || 1)) * 100)}%`, background: categoryColor(name) }} /></div>}
                    </Link>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <p className="pl-eyebrow">Daily spend</p>
            <div style={{ marginTop: 8 }}><Bars values={daily} labels={dayLabels} tone="amber" /></div>
            <p className="pl-muted" style={{ fontSize: 12, marginTop: 6 }}>Average {money(t.spent / Math.max(1, isThisMonth ? new Date().getDate() : dim))} a day.</p>
          </Card>

          {live.length > 0 && (
            <Card>
              <p className="pl-eyebrow">Accounts</p>
              <div className="pl-list">
                {live.map(a => (
                  <div key={a.id} className="mo-acct">
                    <div className="mo-acct__icon">{a.type === 'cash' ? <Wallet /> : <Landmark />}</div>
                    <div className="pl-grow"><b>{a.name}</b><br /><small className="pl-muted">{a.type}{a.last4 ? ` ····${a.last4}` : ''}{a.balanceAsOf ? ` · as of ${a.balanceAsOf}` : ''}</small></div>
                    <span className="mo-amt">{a.balance === undefined ? '—' : money(a.balance)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
      {toast}
    </Page>
  );
}
