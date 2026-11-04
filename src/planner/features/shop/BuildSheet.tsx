// src/planner/features/shop/BuildSheet.tsx — "Build it": narrow an item down to the exact product. This week's flyer
// and everyday offers, by type (boneless skinless / bone-in) and size (6 / 12 pack, ~1 kg / family pack), sorted by
// price per kg, per litre or each, then how many. Picking one saves the store and the price on the item.
import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { Deal } from '../../lib/ai';
import { Button, Sheet } from '../../ui/primitives';
import { isFlyer, liveDeals, perLabel, saleNote, sameDeal, storeOf, unitPrice, type ShopItem, type ShopPrefs } from './types';

const money = (n: number | null | undefined) => (typeof n === 'number' ? `$${n.toFixed(2)}` : '');
const until = (iso?: string) => (iso ? `until ${new Date(iso).toLocaleDateString([], { weekday: 'short' })}` : '');
const ANY = '';

/** Sizes in a sensible order: by amount when known, else as written. */
const sizeKey = (d: Deal) => d.size || '';

export function BuildSheet({ item, prefs, checking, onClose, onSave }: {
  item: ShopItem | null; prefs: ShopPrefs; checking: boolean; onClose: () => void;
  onSave: (next: ShopItem) => void;
}) {
  const [variant, setVariant] = useState(ANY);
  const [size, setSize] = useState(ANY);
  const [chosen, setChosen] = useState<Deal | null>(null);
  const [count, setCount] = useState(1);
  const id = item?.id;
  // a fresh start each time the sheet opens on an item
  useEffect(() => {
    if (!item) return;
    setChosen(item.pick || null); setCount(item.count || 1);
    setVariant(item.pick?.variant || ANY); setSize(item.pick ? sizeKey(item.pick) : ANY);
  }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const deals = useMemo(() => (item ? liveDeals(item) : []), [item]);
  const variants = useMemo(() => {
    const n = new Map<string, number>();
    for (const d of deals) if (d.variant) n.set(d.variant, (n.get(d.variant) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
  }, [deals]);
  const ofVariant = deals.filter(d => !variant || d.variant === variant);
  const sizes = useMemo(() => {
    const m = new Map<string, { amount: number; price: number }>();
    for (const d of ofVariant) {
      const k = sizeKey(d); if (!k) continue;
      const was = m.get(k); const p = d.price ?? Infinity;
      m.set(k, { amount: d.amount ?? Infinity, price: was ? Math.min(was.price, p) : p });
    }
    return [...m.entries()].sort((a, b) => a[1].amount - b[1].amount || a[0].localeCompare(b[0])).map(([k, v]) => ({ key: k, from: v.price }));
  }, [ofVariant]);
  const shown = ofVariant.filter(d => !size || sizeKey(d) === size)
    .map(d => ({ d, u: unitPrice(d) }))
    .sort((a, b) => (a.u && b.u && a.u.unit === b.u.unit ? a.u.value - b.u.value : a.u ? -1 : b.u ? 1 : (a.d.price ?? 1e9) - (b.d.price ?? 1e9)));
  // the best value among the offers that compare
  const best = shown.find(x => x.u)?.d;

  if (!item) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const save = (pick: Deal | undefined, store: string | undefined) => onSave({ ...item, pick, store, count: count > 1 ? count : undefined });
  const others = [...prefs.specialty.map(s => s.name), ...prefs.stores].filter(s => !deals.some(d => d.merchant === s));

  return (
    <Sheet open onClose={onClose} title={`Build it — ${item.text}`}>
      <div className="pl-stack">
        {deals.length === 0 && <p className="pl-muted">{checking ? 'Looking at this week’s flyers and prices…' : 'No flyer deal or listed price for this one. Pick a store below, or just get it anywhere.'}</p>}

        {variants.length > 1 && <>
          <p className="pl-label">Type</p>
          <div className="shop__chips">
            <button type="button" className={!variant ? 'is-on' : ''} onClick={() => { setVariant(ANY); setSize(ANY); }}>Any</button>
            {variants.map(v => <button type="button" key={v} className={variant === v ? 'is-on' : ''} onClick={() => { setVariant(v); setSize(ANY); }}>{v}</button>)}
          </div>
        </>}
        {sizes.length > 1 && <>
          <p className="pl-label">Size</p>
          <div className="shop__chips">
            <button type="button" className={!size ? 'is-on' : ''} onClick={() => setSize(ANY)}>Any</button>
            {sizes.map(s => <button type="button" key={s.key} className={size === s.key ? 'is-on' : ''} onClick={() => setSize(s.key)}>{s.key}{isFinite(s.from) ? <small> from {money(s.from)}</small> : null}</button>)}
          </div>
        </>}

        {shown.length > 0 && <p className="pl-label">{shown.length === 1 ? '1 option' : `${shown.length} options`}, best value first</p>}
        {shown.map(({ d, u }, k) => (
          <button type="button" key={k} className={`shop__offer ${chosen && sameDeal(chosen, d) ? 'is-on' : ''}`} onClick={() => setChosen(chosen && sameDeal(chosen, d) ? null : d)}>
            {d.image && <img src={d.image} alt="" loading="lazy" />}
            <div className="pl-grow">
              <b>{d.merchant}{best === d && shown.length > 1 ? <em className="shop__best">Best value</em> : null}</b>
              <span>{d.name}</span>
              <small>{[d.variant, d.size, isFlyer(d) ? `${saleNote(d) ? `${saleNote(d)} · ` : ''}flyer ${until(d.validTo)}` : d.wasPrice ? `was ${money(d.wasPrice)}` : 'everyday price'].filter(Boolean).join(' · ')}</small>
            </div>
            <div className="shop__price">
              <strong>{money(d.price)}{perLabel(d)}</strong>
              {u && <small>{d.per === 'lb' ? '≈ ' : ''}{money(u.value)}/{u.unit === 'each' ? 'ea' : u.unit}</small>}
            </div>
          </button>
        ))}

        {deals.length > 0 && <div className="shop__count">
          <span className="pl-label" style={{ margin: 0 }}>How many</span>
          <Button small ghost aria-label="One less" onClick={() => setCount(c => Math.max(1, c - 1))} disabled={count <= 1}><Minus size={14} /></Button>
          <b>{count}</b>
          <Button small ghost aria-label="One more" onClick={() => setCount(c => Math.min(99, c + 1))}><Plus size={14} /></Button>
          {chosen && typeof chosen.price === 'number' && chosen.per !== 'lb' && chosen.per !== 'kg' && chosen.per !== '100g' && <span className="pl-muted" style={{ marginLeft: 'auto' }}>{money(chosen.price * count)}</span>}
        </div>}
        {chosen
          ? <Button primary onClick={() => save(chosen, chosen.merchant)}>Get {count > 1 ? `${count} × ` : ''}{[chosen.variant, chosen.size].filter(Boolean).join(', ') || 'this'} at {chosen.merchant}</Button>
          : deals.length > 0 ? <p className="pl-muted" style={{ fontSize: 13, margin: 0 }}>Tap an option to pick it.</p> : null}

        <p className="pl-label" style={{ marginTop: 4 }}>Or get it at</p>
        <div className="shop__stores">
          {others.map(s => <button type="button" key={s} className={!item.pick && storeOf(item) === s ? 'is-on' : ''} onClick={() => save(undefined, s)}>{s}{item.suggestedStore === s ? ' ★' : ''}</button>)}
        </div>
        {item.suggestedStore && item.reason && <small className="pl-muted">★ Coach Claude: {item.reason}</small>}
        <Button ghost onClick={() => save(undefined, undefined)}>Just get it anywhere</Button>
      </div>
    </Sheet>
  );
}
