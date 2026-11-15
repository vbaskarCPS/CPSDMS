// /money/transfers — sort what sits under 'Transfers' (left out of spending): which account numbers are theirs, card
// payments, e-transfers sent (rent!) and received, and things that aren't transfers at all. The sorting and the
// suggestions are in ../transfers.ts. Nothing is changed when the screen opens: every change is a tap here.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeftRight, ChevronDown, ChevronRight } from 'lucide-react';
import { Page, Header, Card, Button, Field, Input, Sheet, Empty, useToast } from '../../../ui/primitives';
import { putDoc } from '../../../lib/docs';
import { useDoc } from '../../../lib/useDoc';
import { useMoney, allRows } from '../useMoney';
import { CATEGORIES, CATEGORY_NAMES } from '../categories';
import { money, monthKey, niceName, recategorize, shiftMonth } from '../lib';
import { loadReceipts } from '../receipts';
import { CategoryIcon } from '../CategoryIcon';
import { accountColors } from '../accountColor';
import { answerAccount, isCardPayment, nameEnding, rememberSent, sortTransfers, TRANSFER_PREFS_KEY, type Flow, type MoveGroup, type OtherGroup, type SentGroup, type TransferPrefs } from '../transfers';
import type { Receipt, Txn } from '../types';

const CHOICES = CATEGORY_NAMES.filter(c => c !== 'Transfers');
const day = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }); };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** "11 e-transfers now count as Housing" */
const nowCount = (n: number, word: string, category: string) => `${plural(n, word)} now count${n === 1 ? 's' : ''} as ${category}`;
const span = (rows: Txn[]) => { const a = rows[rows.length - 1].date, b = rows[0].date; return a === b ? day(a) : `${day(a)} – ${day(b)}`; };
const linkBtn = { background: 'none', border: 0, padding: 0, textAlign: 'left', color: 'inherit', font: 'inherit', cursor: 'pointer' } as const;
const SHOWN = 12;   // single rows shown before "Show all"

export function Transfers() {
  const m = monthKey();
  const from = shiftMonth(m, -14);
  const { months, accounts, loading, setData, reload } = useMoney(from, m);
  const prefs = useDoc<TransferPrefs>('moneyprefs', TRANSFER_PREFS_KEY, {}, 300);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  useEffect(() => { let on = true; loadReceipts(from).then(r => on && setReceipts(r)).catch(() => undefined); return () => { on = false; }; }, [from]);
  const [toast, say] = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);              // the group whose rows are showing
  const [picks, setPicks] = useState<Record<string, string>>({});     // the category chosen per group
  const [forget, setForget] = useState<Record<string, boolean>>({});  // "Remember for next time" unticked
  const [all, setAll] = useState<Record<string, boolean>>({});        // "Show all" tapped, per list
  const [one, setOne] = useState<Txn | null>(null);                   // one row whose category is being picked
  const [showOwn, setShowOwn] = useState(false);                      // "Between your accounts" opened
  const [naming, setNaming] = useState<{ ending: string; name: string } | null>(null);   // a nickname being typed for one of their account numbers
  const s = useMemo(() => sortTransfers(allRows(months), accounts, prefs.data, receipts), [months, accounts, prefs.data, receipts]);
  const ready = !loading && !prefs.loading;
  const accName = (id: string) => accounts.find(a => a.id === id)?.name || '';
  const colours = useMemo(() => accountColors(accounts), [accounts]);
  const acct = (id: string) => ({ ['--acct' as string]: colours[id] });

  /** Set categories on the person's tap (through recategorize, like the Transactions screen), then say what was done. */
  async function change(sets: { rows: Txn[]; category: string }[], done: string): Promise<boolean> {
    if (busy || !sets.some(x => x.rows.length)) return false;
    setBusy(true);
    try {
      const next = structuredClone(months);
      for (const x of sets) if (x.rows.length) await recategorize(next, new Set(x.rows.map(t => t.id)), x.category);
      setData(d => ({ ...d, months: next }));
      say(done, 'good');
      return true;
    } catch (e) { say(e instanceof Error ? e.message : 'Could not save', 'bad'); void reload(); return false; }
    finally { setBusy(false); }
  }
  /** Future rows from this merchant get the category too (the same rule the Transactions screen teaches). */
  async function teach(merchant: string, category: string) {
    try { await putDoc('rule', merchant, { category }); setData(d => ({ ...d, rules: { ...d.rules, [merchant]: category } })); } catch { /* the rows are sorted; the rule can be taught again */ }
  }

  async function markCards() {
    const rows = s.card;
    if (await change([{ rows, category: 'Credit card payment' }], nowCount(rows.length, 'payment', 'Credit card payment'))) {
      for (const name of new Set(rows.map(t => t.merchant).filter(isCardPayment))) await teach(name, 'Credit card payment');
    }
  }
  async function applySent(g: SentGroup, category: string) {
    if (!(await change([{ rows: g.rows, category }], nowCount(g.count, 'e-transfer', category)))) return;
    if (g.by !== 'rest' && !forget[g.key]) prefs.update(p => rememberSent(p, g, category));
  }
  async function applyRemembered() {
    const byCat = new Map<string, Txn[]>();
    for (const r of s.sent.remembered) byCat.set(r.category, [...(byCat.get(r.category) || []), r.txn]);
    const n = s.sent.remembered.length;
    await change([...byCat].map(([category, rows]) => ({ rows, category })),
      byCat.size === 1 ? nowCount(n, 'e-transfer', [...byCat.keys()][0]) : `${plural(n, 'e-transfer')} sorted the way you chose before`);
  }
  async function applyOther(g: OtherGroup, category: string) {
    if (!(await change([{ rows: g.rows, category }], `${g.count} from ${g.account ? `····${g.account}` : niceName(g.merchant)} now count${g.count === 1 ? 's' : ''} as ${category}`))) return;
    if (!g.account) await teach(g.merchant, category);
  }
  async function applyOne(category: string) {
    if (!one) return;
    if (await change([{ rows: [one], category }], nowCount(1, one.amount > 0 ? 'deposit' : 'e-transfer', category))) setOne(null);
  }
  const answer = (ending: string, yes: boolean) => {
    if (prefs.loadError) { say('Could not load your answers. Try again in a moment.', 'bad'); return; }
    prefs.update(p => answerAccount(p, ending, yes));
    say(yes ? `····${ending} is one of yours` : `····${ending} isn't yours`, 'good');
  };

  // ── pieces ──
  /** In, out and the difference for one account number, then which accounts the money came from and went to. */
  const flowLines = (f: Flow, routes = true) => (
    <div style={{ margin: '6px 0 2px', fontSize: 13 }}>
      <div className="pl-row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <span><span className="mo-amt mo-amt--in">+{money(f.into, { whole: true })}</span> <span className="pl-muted">in</span></span>
        {f.out > 0 && <span><span className="mo-amt">−{money(f.out, { whole: true })}</span> <span className="pl-muted">out</span></span>}
        <span><b className={`mo-amt ${f.net > 0 ? 'mo-amt--in' : ''}`}>{f.net > 0 ? '+' : f.net < 0 ? '−' : ''}{money(Math.abs(f.net), { whole: true })}</b> <span className="pl-muted">{f.net < 0 ? 'net: more came out than went in' : f.net > 0 ? 'net: more went in than came out' : 'net'}</span></span>
      </div>
      {routes && f.routes.map(r => (
        <div key={`${r.from}→${r.to}`} className="pl-row" style={{ gap: 8, padding: '4px 0', borderTop: '1px solid var(--line)', marginTop: 4 }}>
          <span className="pl-grow" style={{ minWidth: 0 }}>{r.from} → {r.to} <span className="pl-muted">({plural(r.count, 'move')})</span></span>
          <span className={`mo-amt ${r.dir === 'in' ? 'mo-amt--in' : ''}`} style={{ flex: 'none' }}>{r.dir === 'in' ? '+' : '−'}{money(r.total)}</span>
        </div>
      ))}
    </div>
  );
  const txnRows = (rows: Txn[]) => (
    <div style={{ margin: '2px 0 8px' }}>
      {rows.map(t => (
        <div key={t.id} className="pl-row mo-acctline" style={{ gap: 8, padding: '5px 0 5px 8px', borderTop: '1px solid var(--line)', fontSize: 13, ...acct(t.accountId) }}>
          <span style={{ width: 96, flex: 'none' }}>{day(t.date)}</span>
          <span className="pl-grow pl-muted" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{accName(t.accountId)}{t.desc ? ` · ${t.desc}` : ''}</span>
          <span className={`mo-amt ${t.amount > 0 ? 'mo-amt--in' : ''}`}>{money(t.amount, { sign: true })}</span>
        </div>
      ))}
    </div>
  );
  /** A group's name and total; tap to see its rows. */
  const head = (key: string, title: ReactNode, sub: ReactNode, total: number, rows: Txn[]) => (
    <>
      <div className="mo-txn" style={{ paddingBottom: 4 }}>
        <button type="button" className="mo-txn__main" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)} style={linkBtn}>
          <b>{title} {open === key ? <ChevronDown aria-hidden style={{ width: 14, height: 14, verticalAlign: -2 }} /> : <ChevronRight aria-hidden style={{ width: 14, height: 14, verticalAlign: -2 }} />}</b>
          <small>{sub}</small>
        </button>
        <span className="mo-amt">{money(total)}</span>
      </div>
      {open === key && txnRows(rows)}
    </>
  );
  /** Every move one way between two accounts: each move once, with the row from each side under it. */
  const moveGroup = (g: MoveGroup) => {
    const key = `mv:${g.key}`, isOpen = open === key;
    const list = all[key] ? g.moves : g.moves.slice(0, SHOWN);
    const side = (t: Txn, sign: string, other: string) => (
      <div className="pl-muted mo-acctline" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2, ...acct(t.accountId) }}>{sign} {accName(t.accountId)} · {t.desc}{t.date !== other ? ` · ${day(t.date)}` : ''}</div>
    );
    return (
      <div key={g.key} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
        <div className="pl-row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <button type="button" className="pl-grow" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)} style={{ ...linkBtn, minWidth: 0 }}>
            <b>{g.from} → {g.to} {isOpen ? <ChevronDown aria-hidden style={{ width: 14, height: 14, verticalAlign: -2 }} /> : <ChevronRight aria-hidden style={{ width: 14, height: 14, verticalAlign: -2 }} />}</b>
            <small className="pl-muted" style={{ display: 'block' }}>{plural(g.count, 'move')}{!(g.fromId && g.toId) ? ` · one side only: ${g.fromId ? g.to : g.from} isn’t linked to the planner` : g.both === g.count ? ' · both sides matched' : ` · ${g.both} matched on both sides`}</small>
          </button>
          <span className="mo-amt" style={{ flex: 'none' }}>{money(g.total)}</span>
        </div>
        {isOpen && (
          <div style={{ margin: '4px 0 2px', fontSize: 13 }}>
            {list.map(m => (
              <div key={m.key} style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                <div className="pl-row" style={{ gap: 8 }}><span className="pl-grow">{day(m.date)}</span><span className="mo-amt">{money(m.amount)}</span></div>
                {m.out && side(m.out, '−', m.date)}
                {m.into && side(m.into, '+', m.date)}
                {!(m.out && m.into) && m.fromId && m.toId && <div className="pl-muted">The other side hasn’t shown up yet</div>}
              </div>
            ))}
            {more(key, g.moves.length)}
          </div>
        )}
      </div>
    );
  };
  const select = (key: string, value: string, leave?: string) => (
    <select className="pl-input pl-grow" aria-label="Category" style={{ minHeight: 36, width: 'auto', minWidth: 0, padding: '0 10px', fontSize: 14 }} value={value}
      onChange={e => setPicks(p => ({ ...p, [key]: e.target.value }))}>
      {leave ? <option value="Transfers">{leave}</option> : !value && <option value="">Choose a category</option>}
      {CHOICES.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
  );
  const more = (key: string, total: number) => total > SHOWN && !all[key]
    && <Button small ghost block onClick={() => setAll(a => ({ ...a, [key]: true }))}>Show all {total}</Button>;

  const sentGroup = (g: SentGroup) => {
    if (g.by === 'rest') {
      // unrelated payments: each one is sorted by itself
      const rows = all.rest ? g.rows : g.rows.slice(0, SHOWN);
      return (
        <div key={g.key} style={{ padding: '8px 0' }}>
          <b style={{ fontSize: 14 }}>{g.label}</b> <small className="pl-muted">{g.count} · {money(g.total)} · tap one to say what it was</small>
          {rows.map(t => (
            <div key={t.id} className="mo-txn mo-acctline" style={{ padding: '6px 0 6px 8px', ...acct(t.accountId) }}>
              <div className="mo-txn__main"><b style={{ fontWeight: 500 }}>{day(t.date)}</b><small>{accName(t.accountId)} · {t.desc}</small></div>
              <span className="mo-amt">{money(-t.amount)}</span>
              <button type="button" className="mo-catchip" disabled={busy} onClick={() => setOne(t)}>Category</button>
            </div>
          ))}
          {more('rest', g.count)}
        </div>
      );
    }
    const cat = picks[g.key] ?? g.suggest ?? '';
    return (
      <div key={g.key} style={{ padding: '4px 0 10px' }}>
        {head(g.key, g.label, `${plural(g.count, 'e-transfer')} · ${span(g.rows)}`, g.total, g.rows)}
        <div className="pl-row" style={{ gap: 8 }}>
          {select(g.key, cat)}
          <Button small primary disabled={busy || !cat} onClick={() => void applySent(g, cat)}>Apply to {g.count === 1 ? 'this one' : `these ${g.count}`}</Button>
        </div>
        <label className="pl-row pl-muted" style={{ gap: 8, fontSize: 13, marginTop: 6 }}>
          <input type="checkbox" checked={!forget[g.key]} onChange={e => setForget(f => ({ ...f, [g.key]: !e.target.checked }))} style={{ width: 18, height: 18 }} />
          Remember for next time
        </label>
      </div>
    );
  };

  const otherGroup = (g: OtherGroup) => {
    const cat = picks[g.key] ?? g.suggest;
    return (
      <div key={g.key} style={{ padding: '4px 0 10px' }}>
        {head(g.key, g.account ? g.label : niceName(g.merchant), `${g.count} · ${span(g.rows)}${g.moneyIn ? ' · money in' : ''}${g.keep ? ' · money put aside' : ''}`, g.total, g.rows)}
        <div className="pl-row" style={{ gap: 8 }}>
          {select(g.key, cat, g.keep ? 'Leave as a transfer' : undefined)}
          {cat !== 'Transfers' && <Button small primary disabled={busy} onClick={() => void applyOther(g, cat)}>Change {g.count} to {cat}</Button>}
        </div>
        {g.account && <button type="button" className="mo-linkbtn" style={{ marginTop: 6 }} onClick={() => answer(g.account!, true)}>It is one of ours</button>}
      </div>
    );
  };

  const act = s.other.filter(g => !g.keep), kept = s.other.filter(g => g.keep);
  const totals = [
    s.totals.own > 0 && `${money(s.totals.own, { whole: true })} between your accounts`,
    s.totals.card > 0 && `${money(s.totals.card, { whole: true })} to cards`,
    s.totals.sent > 0 && `${money(s.totals.sent, { whole: true })} sent by e-transfer`,
    s.totals.received > 0 && `${money(s.totals.received, { whole: true })} received`,
  ].filter(Boolean).join(' · ');
  const toDo = s.unknownAccounts.length + s.card.length + s.sent.groups.length + s.sent.remembered.length + s.received.length + act.length;
  const quiet = s.own.count + kept.length + s.sent.cancelled.length;
  const received = all.received ? s.received : s.received.slice(0, SHOWN);
  const confirmed = new Set(prefs.data.own || []);

  return (
    <Page>
      <Header title="Transfers" eyebrow="Last 14 months" back="/money" />
      {ready && toDo + quiet === 0 && <Card><Empty icon={<ArrowLeftRight />} title="Nothing under Transfers" blurb="Money moved between accounts, card payments and e-transfers show up here to be sorted." /></Card>}
      {ready && toDo + quiet > 0 && (
        <>
          <p className="pl-muted" style={{ fontSize: 13 }}>
            Transfers are left out of spending. Some of these are spending (rent by e-transfer, a car payment): sort them here.
            {totals && <><br /><b style={{ color: 'var(--ink)' }}>{totals}</b></>}
          </p>

          {s.sent.remembered.length > 0 && (
            <Card>
              <div className="pl-row">
                <span className="pl-grow">{s.sent.remembered.length === 1 ? '1 new e-transfer matches' : `${s.sent.remembered.length} new e-transfers match`} what you chose before</span>
                <Button small primary disabled={busy} onClick={() => void applyRemembered()}>Apply</Button>
              </div>
              <div style={{ marginTop: 6, fontSize: 13 }}>
                {s.sent.remembered.map(r => <div key={r.txn.id} className="pl-row" style={{ gap: 8, padding: '3px 0' }}><span className="pl-grow">{day(r.txn.date)} · {money(-r.txn.amount)}</span><span>{r.category}</span></div>)}
              </div>
            </Card>
          )}

          {s.unknownAccounts.length > 0 && (
            <Card>
              <h3 style={{ margin: '0 0 4px' }}>Is this account yours?</h3>
              <small className="pl-muted">Money moved to or from an account number the planner doesn't know. Your own accounts (a savings, an RSP) stay transfers.</small>
              <div className="pl-list" style={{ marginTop: 8 }}>
                {s.unknownAccounts.map(u => (
                  <div key={u.ending} style={{ padding: '10px 0' }}>
                    {/* the question in full (it was cut off beside the buttons on a phone), the buttons under it */}
                    <b style={{ display: 'block' }}>Is the account ending in {u.ending} one of yours?</b>
                    <small className="pl-muted" style={{ display: 'block' }}>{plural(u.count, 'move')}, {u.first === u.last ? day(u.first) : `${day(u.first)} – ${day(u.last)}`}</small>
                    <small className="pl-muted" style={{ display: 'block', overflowWrap: 'anywhere' }}>The bank writes it as “{u.sample}”</small>
                    {flowLines(u.flow)}
                    <div className="pl-row" style={{ gap: 8, marginTop: 8 }}>
                      <Button small primary onClick={() => answer(u.ending, true)}>Yes, ours</Button>
                      <Button small onClick={() => answer(u.ending, false)}>No</Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {s.card.length > 0 && (
            <Card>
              <h3 style={{ margin: '0 0 4px' }}>Card payments</h3>
              {head('card', plural(s.card.length, 'payment'), `${span(s.card)} · paying the card isn't spending: what was bought on it is`, s.totals.card, s.card)}
              <Button block primary disabled={busy} onClick={() => void markCards()}>Mark {s.card.length === 1 ? 'it' : `all ${s.card.length}`} as Credit card payment</Button>
            </Card>
          )}

          {s.sent.groups.length > 0 && (
            <Card>
              <h3 style={{ margin: '0 0 4px' }}>Sent by e-transfer</h3>
              <small className="pl-muted">Money sent to people. Choose what each was for and it counts as spending.</small>
              <div className="pl-list" style={{ marginTop: 6 }}>{s.sent.groups.map(sentGroup)}</div>
            </Card>
          )}

          {s.received.length > 0 && (
            <Card>
              <h3 style={{ margin: '0 0 4px' }}>Received</h3>
              <small className="pl-muted">E-transfers that came in. Income, a refund for something (tap Refund and choose what it was for), or leave it.</small>
              <div className="pl-list" style={{ marginTop: 6 }}>
                {received.map(r => (
                  <div key={r.txn.id} className="mo-txn">
                    <div className="mo-txn__main"><b style={{ fontWeight: 500 }}>{day(r.txn.date)}</b><small>{r.returned ? 'A sent e-transfer that came back · ' : ''}{accName(r.txn.accountId)} · {r.txn.desc}</small></div>
                    <span className="mo-amt mo-amt--in">{money(r.txn.amount, { sign: true })}</span>
                    {r.suggest && <button type="button" className="mo-catchip" disabled={busy} onClick={() => void change([{ rows: [r.txn], category: r.suggest! }], nowCount(1, 'deposit', r.suggest!))}>{r.suggest}</button>}
                    <button type="button" className="mo-catchip" disabled={busy} onClick={() => setOne(r.txn)}>{r.returned ? 'Category' : 'Refund'}</button>
                  </div>
                ))}
              </div>
              {more('received', s.received.length)}
            </Card>
          )}

          {act.length > 0 && (
            <Card>
              <h3 style={{ margin: '0 0 4px' }}>Don't look like transfers</h3>
              <small className="pl-muted">Caught by the word "transfer" or by the bank's label. New ones from the same name follow your choice.</small>
              <div className="pl-list" style={{ marginTop: 6 }}>{act.map(otherGroup)}</div>
            </Card>
          )}

          {toDo === 0 && <p className="pl-muted" style={{ fontSize: 13 }}>All sorted: nothing here needs you.</p>}

          {quiet > 0 && (
            <Card>
              <button type="button" aria-expanded={showOwn} onClick={() => setShowOwn(v => !v)} style={{ ...linkBtn, width: '100%' }}>
                <h3 style={{ margin: 0 }}>Between your accounts {showOwn ? <ChevronDown aria-hidden style={{ width: 16, height: 16, verticalAlign: -2 }} /> : <ChevronRight aria-hidden style={{ width: 16, height: 16, verticalAlign: -2 }} />}</h3>
                <small className="pl-muted">{plural(s.own.moves, 'move')} · {money(s.own.total, { whole: true })} · these stay transfers, nothing to do</small>
              </button>
              {showOwn && (
                <div style={{ marginTop: 8 }}>
                  {/* each move once, the two sides together, by direction */}
                  {s.own.groups.map(moveGroup)}
                  <p className="pl-eyebrow" style={{ margin: '14px 0 0' }}>Each account: in, out, difference</p>
                  {s.own.byEnding.map(e => (
                    <div key={e.ending} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                      <div className="pl-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <b className="pl-grow">{e.name || (e.nick ? `${e.nick} ····${e.ending}` : `····${e.ending}`)}</b>
                        {!e.name && <button type="button" className="mo-catchip" onClick={() => setNaming({ ending: e.ending, name: e.nick || '' })}>{e.nick ? 'Rename' : 'Name it'}</button>}
                        {!e.name && confirmed.has(e.ending) && <button type="button" className="mo-catchip" onClick={() => answer(e.ending, false)}>Not ours</button>}
                      </div>
                      {flowLines(e.flow, false)}
                    </div>
                  ))}
                  {s.sent.cancelled.length > 0 && <small className="pl-muted" style={{ display: 'block', padding: '8px 0' }}>{plural(s.sent.cancelled.length, 'e-transfer')} sent and taken back: left as {s.sent.cancelled.length === 1 ? 'it is' : 'they are'}.</small>}
                  {kept.map(otherGroup)}
                </div>
              )}
            </Card>
          )}
        </>
      )}

      <Sheet open={!!naming} onClose={() => setNaming(null)} title={naming ? `Name the account ending in ${naming.ending}` : ''}>
        {naming && (
          <>
            <Field label="Nickname" hint="Shown wherever this account number comes up, e.g. Savings or RSP. Leave empty for none.">
              <Input autoFocus value={naming.name} maxLength={30} placeholder="e.g. Savings" onChange={e => setNaming({ ...naming, name: e.target.value })} />
            </Field>
            <Button primary block onClick={() => {
              if (prefs.loadError) { say('Could not load your answers. Try again in a moment.', 'bad'); return; }
              prefs.update(p => nameEnding(p, naming.ending, naming.name)); setNaming(null); say('Saved', 'good');
            }}>Save</Button>
          </>
        )}
      </Sheet>

      <Sheet open={!!one} onClose={() => setOne(null)} title={one ? `${day(one.date)} · ${money(one.amount, { sign: true })}` : ''}>
        {one && (
          <>
            <p className="pl-muted" style={{ fontSize: 13 }}>{one.desc} · {accName(one.accountId)}</p>
            <div className="mo-catgrid">
              {CATEGORIES.filter(c => c.name !== 'Transfers').map(c => (
                <button key={c.name} type="button" disabled={busy} className="pl-btn pl-btn--small" onClick={() => void applyOne(c.name)}>
                  <CategoryIcon name={c.name} /> {c.name}
                </button>
              ))}
            </div>
          </>
        )}
      </Sheet>
      {toast}
    </Page>
  );
}
