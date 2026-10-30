// src/planner/features/food/MealEditor.tsx — the confirm screen: the AI's draft (or a favourite, or
// nothing) becomes a meal only once the user has looked at every line and tapped Save.
import { useMemo, useState } from 'react';
import { Trash2, Plus, Star } from 'lucide-react';
import { Button, Card, Chip, Field, Input, Sheet } from '../../ui/primitives';
import { EXTRAS, round, scaleItem, sum, type FoodItem, type Totals } from './model';

const STEPS = [0.5, 0.75, 1, 1.5, 2];

export interface Draft { name: string; time: string; items: FoodItem[]; note?: string; thumb?: string; saveFav: boolean }

function ItemRow({ item, base, onChange, onRemove }: { item: FoodItem; base: FoodItem; onChange: (i: FoodItem) => void; onRemove: () => void }) {
  // the stepper scales from the AI's original numbers, so ×1 always returns to the draft
  const factor = base.kcal > 0 ? item.kcal / base.kcal : 1;
  const current = STEPS.find(s => Math.abs(s - factor) < 0.05);
  const conf = item.confidence || 'medium';
  return (
    <div className="fd-item">
      <div className="fd-item__top">
        <span className={`fd-dot fd-dot--${conf}`} title={`${conf} confidence`} />
        <input className="fd-item__name" value={item.name} onChange={e => onChange({ ...item, name: e.target.value })} aria-label="Food name" />
        <span className="fd-kcal">{item.kcal}</span>
        <button className="pl-btn pl-btn--ghost pl-btn--small" style={{ border: 0, padding: '0 6px' }} aria-label="Remove" onClick={onRemove}><Trash2 style={{ width: 18, height: 18 }} /></button>
      </div>
      <div className="fd-item__meta">
        <span>{item.portion}{item.grams ? ` · ${item.grams} g` : ''}</span>
        <span>P {item.protein} · C {item.carbs} · F {item.fat}</span>
        {conf === 'low' && <span style={{ color: 'var(--amber-2)', fontWeight: 600 }}>Check this one</span>}
      </div>
      <div className="fd-steps" aria-label="Portion">
        {STEPS.map(s => <button key={s} type="button" className={current === s ? 'is-on' : ''} onClick={() => onChange({ ...scaleItem(base, s), name: item.name })}>×{s}</button>)}
      </div>
    </div>
  );
}

export function MealEditor({ draft, setDraft, tips, onSave, saving, onDelete }: {
  draft: Draft; setDraft: (d: Draft) => void; tips?: string; onSave: () => void; saving: boolean; onDelete?: () => void;
}) {
  // originals for the stepper: keyed by position, captured when an item first appears
  const [bases, setBases] = useState<Map<FoodItem, FoodItem>>(() => new Map(draft.items.map(i => [i, i])));
  const [manual, setManual] = useState(false);
  const [m, setM] = useState({ name: '', kcal: '', protein: '', carbs: '', fat: '' });
  const totals: Totals = useMemo(() => round(sum(draft.items)), [draft.items]);

  const baseOf = (i: FoodItem) => bases.get(i) || i;
  const replace = (idx: number, next: FoodItem) => {
    const base = baseOf(draft.items[idx]);
    const items = draft.items.map((it, k) => (k === idx ? next : it));
    setBases(b => { const n = new Map(b); n.delete(draft.items[idx]); n.set(next, base); return n; });
    setDraft({ ...draft, items });
  };
  const add = (i: FoodItem) => { const it = { ...i }; setBases(b => new Map(b).set(it, it)); setDraft({ ...draft, items: [...draft.items, it] }); };
  const remove = (idx: number) => setDraft({ ...draft, items: draft.items.filter((_, k) => k !== idx) });
  const addManual = () => {
    const n = (v: string) => Math.max(0, Math.round(Number(v) || 0));
    if (!m.name.trim()) return;
    add({ name: m.name.trim(), portion: '1 serving', kcal: n(m.kcal), protein: n(m.protein), carbs: n(m.carbs), fat: n(m.fat), confidence: 'high' });
    setM({ name: '', kcal: '', protein: '', carbs: '', fat: '' }); setManual(false);
  };

  return (
    <>
      {draft.thumb && <img className="fd-preview" src={draft.thumb} alt="" />}
      {tips && <p className="pl-muted" style={{ fontSize: 13 }}>{tips}</p>}

      <Card>
        <div className="pl-list">
          {draft.items.length === 0 && <p className="pl-muted" style={{ padding: '8px 0' }}>Nothing yet — add an item below.</p>}
          {draft.items.map((it, idx) => <ItemRow key={idx} item={it} base={baseOf(it)} onChange={n => replace(idx, n)} onRemove={() => remove(idx)} />)}
        </div>
      </Card>

      <div className="pl-stack" style={{ gap: 8 }}>
        <p className="pl-eyebrow">Hidden extras</p>
        <div className="pl-chips">
          {EXTRAS.map(x => <Chip key={x.name} onClick={() => add(x)}>+ {x.name} <small className="pl-muted">{x.portion}</small></Chip>)}
          <Chip onClick={() => setManual(true)}><Plus style={{ width: 16, height: 16 }} /> Add item</Chip>
        </div>
      </div>

      <Card>
        <div className="pl-stack">
          <div className="pl-grid-2">
            <Field label="Meal"><Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Lunch" /></Field>
            <Field label="Time"><Input type="time" value={draft.time} onChange={e => setDraft({ ...draft, time: e.target.value })} /></Field>
          </div>
          <label className="fd-switch"><input type="checkbox" checked={draft.saveFav} onChange={e => setDraft({ ...draft, saveFav: e.target.checked })} /><Star style={{ width: 18, height: 18, color: 'var(--amber)' }} /> Save as favourite</label>
        </div>
      </Card>

      <div className="fd-totals">
        <div><b className="pl-num">{totals.kcal}</b><small>KCAL</small></div>
        <div><b className="pl-num">{totals.protein}</b><small>PROTEIN</small></div>
        <div><b className="pl-num">{totals.carbs}</b><small>CARBS</small></div>
        <div><b className="pl-num">{totals.fat}</b><small>FAT</small></div>
      </div>

      <Button primary block disabled={saving || draft.items.length === 0} onClick={onSave}>{saving ? 'Saving…' : 'Save meal'}</Button>
      {onDelete && <Button block danger ghost onClick={onDelete} disabled={saving}>Remove this meal</Button>}

      <Sheet open={manual} onClose={() => setManual(false)} title="Add an item">
        <Field label="Name"><Input value={m.name} onChange={e => setM({ ...m, name: e.target.value })} autoFocus placeholder="Protein shake" /></Field>
        <div className="pl-grid-2">
          <Field label="kcal"><Input inputMode="numeric" value={m.kcal} onChange={e => setM({ ...m, kcal: e.target.value })} /></Field>
          <Field label="Protein (g)"><Input inputMode="numeric" value={m.protein} onChange={e => setM({ ...m, protein: e.target.value })} /></Field>
          <Field label="Carbs (g)"><Input inputMode="numeric" value={m.carbs} onChange={e => setM({ ...m, carbs: e.target.value })} /></Field>
          <Field label="Fat (g)"><Input inputMode="numeric" value={m.fat} onChange={e => setM({ ...m, fat: e.target.value })} /></Field>
        </div>
        <Button primary block onClick={addManual} disabled={!m.name.trim()}>Add</Button>
      </Sheet>
    </>
  );
}
