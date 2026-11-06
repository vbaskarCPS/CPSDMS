// src/planner/features/food/ShopSheet.tsx — recipe → shopping list: the ingredients of one recipe (or every recipe in
// today's protein road), scaled to the servings, ticked except the pantry basics; untick what you have, add the rest.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Minus, Plus, ShoppingCart } from 'lucide-react';
import { getPass } from '../../lib/auth';
import { Button, Sheet, useToast } from '../../ui/primitives';
import { addLines } from '../shop/store';
import { fmtQty, shopLines, type Recipe } from './recipes';

export function ShopSheet({ open, onClose, sources, title }: { open: boolean; onClose: () => void; sources: { recipe: Recipe; servings: number }[]; title?: string }) {
  const single = sources.length === 1 ? sources[0] : null;
  const [servings, setServings] = useState(single?.servings || 1);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [toast, say] = useToast();
  const src = useMemo(() => (single ? [{ recipe: single.recipe, servings }] : sources), [single, servings, sources]);
  const lines = useMemo(() => shopLines(src), [src]);
  // a fresh start each time it opens: the pantry basics start un-ticked
  useEffect(() => { if (!open) return; setServings(single?.servings || 1); setDone(null); setOff(new Set(shopLines(sources).filter(l => l.pantry).map(l => l.key))); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  const picked = lines.filter(l => !off.has(l.key));
  const toggle = (k: string) => setOff(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const add = async () => {
    setBusy(true);
    try {
      const fresh = await addLines(picked.map(l => ({ text: l.text, qty: l.qty, section: l.section, recipe: l.recipe })), getPass()?.user.username || 'me');
      setDone(picked.length);
      say(fresh === picked.length ? `${fresh} added to the list` : `${picked.length} on the list (${picked.length - fresh} merged with what was there)`, 'good');
    } catch (e) { say(e instanceof Error ? e.message : "Couldn't add them", 'bad'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title={title || (single ? `Shop for ${single.recipe.name}` : "Shop for today's plan")}>
      <div className="pl-stack">
        {single && (
          <div className="rc-count">
            <span className="pl-label" style={{ margin: 0 }}>Servings</span>
            <Button small ghost aria-label="Fewer" onClick={() => setServings(s => Math.max(0.5, s - 0.5))} disabled={servings <= 0.5}><Minus size={14} /></Button>
            <b>{fmtQty(servings)}</b>
            <Button small ghost aria-label="More" onClick={() => setServings(s => Math.min(20, s + 0.5))}><Plus size={14} /></Button>
            <span className="pl-muted" style={{ marginLeft: 'auto', fontSize: 13 }}>recipe makes {single.recipe.servings}</span>
          </div>
        )}
        {!single && <p className="pl-muted" style={{ fontSize: 13, margin: 0 }}>{sources.map(s => `${s.recipe.name} × ${fmtQty(s.servings)}`).join(' · ')}</p>}
        {lines.length === 0 ? <p className="pl-muted">No ingredients to shop for.</p> : (
          <div className="rc-shop">
            {lines.map(l => {
              const on = !off.has(l.key);
              return (
                <button type="button" key={l.key} className={`rc-shop__row ${on ? 'is-on' : ''}`} onClick={() => toggle(l.key)}>
                  <span className={`pl-check ${on ? 'is-on' : ''}`} aria-hidden><Check /></span>
                  <span className="pl-grow"><b>{l.qty ? `${l.qty} ` : ''}{l.text}</b>{!single && <small>for {l.recipe}</small>}{l.pantry && !on && <small>probably in the pantry</small>}</span>
                </button>
              );
            })}
          </div>
        )}
        {done === null
          ? <Button primary onClick={() => void add()} disabled={busy || !picked.length}><ShoppingCart size={16} /> {busy ? 'Adding…' : `Add ${picked.length} to the shopping list`}</Button>
          : <Link to="/shop" className="pl-btn pl-btn--primary">Open the shopping list</Link>}
        <p className="pl-muted" style={{ fontSize: 12, margin: 0 }}>Already on the list? The amount is added to that line. Build it and the flyer deals work as usual.</p>
      </div>
      {toast}
    </Sheet>
  );
}
