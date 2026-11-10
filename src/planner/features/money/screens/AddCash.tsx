// /money/cash — log cash spending in a few taps: how much, what for, the category (guessed from the words). It goes in the
// cash wallet (an account of its own). From the first cash entry on, ATM withdrawals count as moving money into the
// wallet, not as spending, so nothing is counted twice.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera } from 'lucide-react';
import { Button, Card, Chip, Field, Header, Input, Page, useToast } from '../../../ui/primitives';
import { builtinCategory, SPENDING_CATEGORIES } from '../categories';
import { money, normalizeMerchant, todayIso } from '../lib';
import { useMoney } from '../useMoney';
import { addCashRow } from '../receipts';

const QUICK = ['Dining', 'Groceries', 'Coffee', 'Transport', 'Shopping', 'Gifts', 'Other'];
// everyday words for cash spending ("lunch at Pai", "parking", "haircut"), tried after the household's own rules
const WORDS: [RegExp, string][] = [
  [/\b(coffee|latte|tea|tims|starbucks)\b/i, 'Coffee'],
  [/\b(lunch|dinner|breakfast|brunch|snacks?|takeout|take-out|food truck|pizza|shawarma|restaurant|drinks?|bar)\b/i, 'Dining'],
  [/\b(groceries|grocery|market|produce|fruits?|vegetables?|milk|bread)\b/i, 'Groceries'],
  [/\b(parking|bus|taxi|cab|ttc|presto|go train|uber|lyft|toll|transit)\b/i, 'Transport'],
  [/\b(gas|fuel|petrol)\b/i, 'Gas'],
  [/\b(gift|birthday|wedding|donation|charity|church|temple|mosque|tip jar)\b/i, 'Gifts'],
  [/\b(haircut|barber|salon|nails|spa|threading)\b/i, 'Personal care'],
  [/\b(movie|cinema|tickets?|concert|game|bowling|arcade)\b/i, 'Entertainment'],
  [/\b(kids?|daycare|school|toys?|kiaan)\b/i, 'Kids'],
  [/\b(doctor|pharmacy|medicine|dentist|physio|massage)\b/i, 'Health'],
  [/\b(gym|class|yoga|drop-in)\b/i, 'Fitness'],
];

export function AddCash() {
  const { rules, accounts } = useMoney('0000', '0000');
  const [amount, setAmount] = useState('');
  const [what, setWhat] = useState('');
  const [date, setDate] = useState(todayIso());
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [toast, say] = useToast();

  const guess = useMemo(() => {
    if (!what.trim()) return '';
    const m = normalizeMerchant(what);
    const g = rules[m] || WORDS.find(([re]) => re.test(what))?.[1] || builtinCategory(m, what) || '';
    return SPENDING_CATEGORIES.includes(g) && g !== 'Cash' ? g : '';
  }, [what, rules]);
  const category = picked || guess || 'Other';
  const value = Number(amount.replace(/[^\d.]/g, ''));
  const first = !accounts.some(a => a.id === 'cash');

  async function save() {
    if (!(value > 0) || !what.trim()) return;
    setBusy(true);
    try {
      await addCashRow({ date, desc: what, amount: value, category, note });
      setLog(l => [`${money(value)} · ${what.trim()} · ${category}`, ...l].slice(0, 5));
      say(`Logged ${money(value)} · ${category}`, 'good');
      setAmount(''); setWhat(''); setPicked(null); setNote('');
    } catch (e) { say(e instanceof Error ? e.message : 'Could not save', 'bad'); }
    finally { setBusy(false); }
  }

  return (
    <Page>
      <Header title="Cash" eyebrow="Money" back="/money" />
      <Card className="pl-stack">
        <div className="pl-grid-2">
          <Field label="Amount"><Input autoFocus inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></Field>
          <Field label="Date"><Input type="date" value={date} max={todayIso()} onChange={e => setDate(e.target.value || todayIso())} /></Field>
        </div>
        <Field label="What for"><Input value={what} onChange={e => setWhat(e.target.value)} placeholder="e.g. Lunch at the food truck" /></Field>
        <Field label="Category" hint={!picked && guess ? `Guessed from “${what.trim()}”` : undefined}>
          <div className="mo-chips">
            {QUICK.map(c => <Chip key={c} on={category === c} onClick={() => setPicked(c)}>{c}</Chip>)}
            <select className="pl-input" style={{ minHeight: 34, width: 'auto', padding: '0 10px', fontSize: 14 }} value={QUICK.includes(category) ? '' : category} onChange={e => e.target.value && setPicked(e.target.value)}>
              <option value="">More…</option>
              {SPENDING_CATEGORIES.filter(c => !QUICK.includes(c) && c !== 'Cash').map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </Field>
        <Field label="Note (optional)"><Input value={note} onChange={e => setNote(e.target.value)} /></Field>
      </Card>
      {first && <p className="pl-muted" style={{ fontSize: 13 }}>This starts your cash wallet. From today, ATM withdrawals count as cash moved to the wallet, and what you log here is the spending.</p>}
      <Button primary block disabled={busy || !(value > 0) || !what.trim()} onClick={() => void save()}>{busy ? 'Saving…' : value > 0 ? `Log ${money(value)}` : 'Log it'}</Button>
      <Link to="/money/receipt?pay=cash" className="pl-btn pl-btn--block pl-btn--ghost"><Camera style={{ width: 18, height: 18 }} /> Have the receipt? Take a photo instead</Link>
      {log.length > 0 && (
        <Card>
          <p className="pl-eyebrow">Just logged</p>
          {log.map((l, i) => <p key={i} style={{ fontSize: 14, marginTop: 6 }}>{l}</p>)}
          <Link to={`/money/transactions?acc=cash&m=${date.slice(0, 7)}`} style={{ fontSize: 14, fontWeight: 600 }}>See the cash wallet ›</Link>
        </Card>
      )}
      {toast}
    </Page>
  );
}
