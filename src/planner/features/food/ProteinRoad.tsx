// src/planner/features/food/ProteinRoad.tsx — "Road to 180 g protein": planned in the sauna. Two meals and a couple of
// shakes, each with a time before the kitchen closes and what it'll be (a recipe × servings, a favourite, typed and
// estimated by Claude, or just the grams). A running bar and a nudge until the plan reaches the goal; the slots show up on
// the Today timeline with "Ate it". "Shop for today's plan" sends the recipes' ingredients to the shopping list.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Check, Minus, Plus, ShoppingCart, Sparkles, Trash2, X } from 'lucide-react';
import { getDocs, putDoc } from '../../lib/docs';
import { estimateFoodText } from '../../lib/ai';
import { clock, type Routine } from '../../lib/routine';
import { Button, Card, Field, Input, Progress, Sheet, useToast, uid } from '../../ui/primitives';
import type { ProteinPlan, ProteinSlot } from '../plan/types';
import { DEFAULT_TARGETS, loadTargets, round, sum, type FavMeal, type Targets } from './model';
import { ensureShakeFavourite } from './fasting';
import { afterKitchen, copyPlan, DEFAULT_GOAL, defaultSlots, nextLabel, nudge, planned, sortSlots } from './protein';
import { fmtQty, loadRecipes, recipeSlot, type Recipe } from './recipes';
import { AddRecipeSheet, RecipeRow } from './Recipes';
import { ShopSheet } from './ShopSheet';

type Fill = Pick<ProteinSlot, 'what' | 'protein'> & Partial<Pick<ProteinSlot, 'kcal' | 'items' | 'recipeId' | 'servings'>>;

/** The goal: the food targets' protein (180 to start). */
export function useProteinGoal(): [number, (g: number) => Promise<void>] {
  const [t, setT] = useState<Targets | null>(null);
  useEffect(() => { loadTargets().then(setT).catch(() => setT(null)); }, []);
  const goal = t?.protein || DEFAULT_GOAL;
  const set = async (g: number) => { const next = { ...(t || DEFAULT_TARGETS), protein: g }; setT(next); await putDoc('foodprefs', 'targets', next); };
  return [goal, set];
}

export function ProteinRoad({ plan, yesterday, onChange, routine }: { plan?: ProteinPlan; yesterday?: ProteinPlan; onChange: (p: ProteinPlan) => void; routine: Routine }) {
  const [goal, setGoal] = useProteinGoal();
  const [editGoal, setEditGoal] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [favs, setFavs] = useState<FavMeal[]>([]);
  const [open, setOpen] = useState<string | null>(null);   // the slot being filled
  const [shop, setShop] = useState(false);
  const [idea, setIdea] = useState<{ slot: string; grams: number; servings: number } | null>(null);
  const [toast, say] = useToast();
  useEffect(() => {
    loadRecipes().then(setRecipes).catch(() => undefined);
    getDocs<FavMeal>('favmeal').then(async d => { const list = d.map(x => x.data).filter(Boolean); const shake = await ensureShakeFavourite(list).catch(() => null); setFavs(shake && !list.some(f => f.id === shake.id) ? [shake, ...list] : list); }).catch(() => undefined);
  }, []);

  const slots = useMemo(() => sortSlots(plan?.slots || []), [plan]);
  const total = planned(plan);
  const gap = goal - total;
  const hint = nudge(plan, goal);
  const setSlots = (fn: (s: ProteinSlot[]) => ProteinSlot[]) => onChange({ ...(plan || { slots: [] }), slots: fn(plan?.slots || []), plannedAt: new Date().toISOString() });
  const patch = (id: string, p: Partial<ProteinSlot>) => setSlots(s => s.map(x => (x.id === id ? { ...x, ...p } : x)));
  const add = (kind: ProteinSlot['kind']) => setSlots(s => [...s, { id: uid(), kind, label: nextLabel(s, kind), time: s.length ? sortSlots(s)[s.length - 1].time : '09:00', what: '', protein: 0 }]);
  const slot = slots.find(s => s.id === open) || null;
  const recipeSources = slots.filter(s => s.recipeId).map(s => ({ recipe: recipes.find(r => r.id === s.recipeId), servings: s.servings || 1 })).filter((x): x is { recipe: Recipe; servings: number } => !!x.recipe);
  // the same recipe in two slots: one line, servings added
  const shopSources = Object.values(recipeSources.reduce<Record<string, { recipe: Recipe; servings: number }>>((m, x) => { const k = x.recipe.id; m[k] = m[k] ? { ...m[k], servings: m[k].servings + x.servings } : { ...x }; return m; }, {}));

  const saveGoal = async () => { const g = Math.max(40, Math.min(400, Math.round(Number(editGoal) || goal))); setEditGoal(null); try { await setGoal(g); } catch { say("Couldn't save the goal", 'bad'); } };

  return (
    <Card className={`pl-stack pr-road ${gap <= 0 && total > 0 ? 'is-there' : ''}`}>
      <div className="pl-row" style={{ alignItems: 'baseline' }}>
        <h2 className="pl-grow">Road to {editGoal === null
          ? <button type="button" className="pr-goal" onClick={() => setEditGoal(String(goal))} aria-label="Change the goal">{goal}</button>
          : <input className="pl-input pr-goal-input" autoFocus inputMode="numeric" value={editGoal} onChange={e => setEditGoal(e.target.value.replace(/\D/g, ''))} onBlur={() => void saveGoal()} onKeyDown={e => { if (e.key === 'Enter') void saveGoal(); }} />} g protein</h2>
        <Link to="/food/recipes" className="pl-btn pl-btn--small pl-btn--ghost" aria-label="Recipes"><BookOpen size={15} /></Link>
      </div>
      <p className="pl-muted" style={{ fontSize: 13, margin: 0 }}>{routine.kitchenClose ? `Everything eaten by ${clock(routine.kitchenClose)} — ` : ''}2 meals and a couple of shakes.</p>

      {!slots.length ? (
        <div className="pl-stack" style={{ gap: 8 }}>
          <Button primary onClick={() => onChange({ slots: defaultSlots(routine), plannedAt: new Date().toISOString() })}><Plus size={16} /> Plan 2 meals + 2 shakes</Button>
          {yesterday?.slots?.length ? <Button onClick={() => onChange({ ...copyPlan(yesterday), plannedAt: new Date().toISOString() })}>Same as yesterday ({planned(yesterday)} g)</Button> : null}
        </div>
      ) : (
        <>
          <div className="pr-bar">
            <Progress value={Math.min(total, goal)} max={goal} tone={gap <= 0 ? 'good' : undefined} />
            <span><b>{total}</b> / {goal} g{gap > 0 ? ` · ${gap} g to go` : ' · there ✓'}</span>
          </div>
          {hint && <p className="pr-hint">{hint}</p>}
          <div className="pr-slots">
            {slots.map(s => (
              <div key={s.id} className={`pr-slot ${s.eaten ? 'is-eaten' : ''}`}>
                <input className="pl-input pr-time" type="time" value={s.time} onChange={e => patch(s.id, { time: e.target.value })} aria-label={`${s.label} time`} />
                <button type="button" className="pr-what" onClick={() => setOpen(s.id)}>
                  <small>{s.label}{s.eaten ? ' · eaten ✓' : ''}{afterKitchen(s.time, routine) ? ' · after the kitchen closes' : ''}</small>
                  <b className={s.what ? '' : 'pl-muted'}>{s.what || (s.kind === 'shake' ? 'Pick the shake' : 'Pick the meal')}</b>
                </button>
                <span className={`rc-tag ${s.protein ? '' : 'is-empty'}`}>{s.protein ? `${s.protein} g` : '–'}</span>
                <button type="button" className="shop__x" aria-label={`Remove ${s.label}`} onClick={() => setSlots(x => x.filter(y => y.id !== s.id))}><X size={14} /></button>
              </div>
            ))}
          </div>
          <div className="pl-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button small onClick={() => add('shake')}><Plus size={14} /> Shake</Button>
            <Button small onClick={() => add('meal')}><Plus size={14} /> Meal</Button>
            {shopSources.length > 0 && <Button small ghost style={{ marginLeft: 'auto' }} onClick={() => setShop(true)}><ShoppingCart size={14} /> Shop for today's plan</Button>}
          </div>
        </>
      )}

      <SlotSheet slot={slot} recipes={recipes} favs={favs} gap={Math.max(gap + (slot?.protein || 0), 0)} onClose={() => setOpen(null)}
        onIdea={(grams, servings) => { if (slot) setIdea({ slot: slot.id, grams, servings }); setOpen(null); }}
        onPick={f => { if (slot) patch(slot.id, { recipeId: undefined, servings: undefined, items: undefined, kcal: undefined, ...f }); setOpen(null); }}
        onClear={() => { if (slot) patch(slot.id, { what: '', protein: 0, kcal: undefined, items: undefined, recipeId: undefined, servings: undefined }); setOpen(null); }} />
      <ShopSheet open={shop} onClose={() => setShop(false)} sources={shopSources} />
      <AddRecipeSheet open={!!idea} onClose={() => setIdea(null)} ideaFor={idea?.grams} avoid={recipes.map(r => r.name)}
        onSaved={r => { setRecipes(l => [r, ...l.filter(x => x.id !== r.id)]); if (idea) patch(idea.slot, { items: undefined, kcal: undefined, ...recipeSlot(r, idea.servings) }); setIdea(null); say(`${r.name} saved to your recipes`, 'good'); }} />
      {toast}
    </Card>
  );
}

function SlotSheet({ slot, recipes, favs, gap, onPick, onClear, onClose, onIdea }: {
  slot: ProteinSlot | null; recipes: Recipe[]; favs: FavMeal[]; gap: number;
  onPick: (f: Fill) => void; onClear: () => void; onClose: () => void; onIdea: (grams: number, servings: number) => void;
}) {
  const [servings, setServings] = useState(1);
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const [grams, setGrams] = useState('');
  const [kcal, setKcal] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const id = slot?.id;
  useEffect(() => { if (!slot) return; setServings(slot.servings || 1); setQ(''); setText(''); setErr(''); setGrams(slot.protein && !slot.recipeId && !slot.items ? String(slot.protein) : ''); setKcal(''); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!slot) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;

  const shake = slot.kind === 'shake';
  const ideaG = Math.max(30, Math.round(gap / Math.max(servings, 1)) || 50);
  const match = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());
  const rs = recipes.filter(r => match(r.name));
  const fs = favs.filter(f => match(f.name)).sort((a, b) => (shake ? Number(/shake/i.test(b.name)) - Number(/shake/i.test(a.name)) : 0) || b.totals.protein - a.totals.protein);
  const fav = (f: FavMeal): Fill => {
    const k = servings;
    const items = f.items.map(i => ({ name: i.name, portion: k === 1 ? i.portion : `${fmtQty(k)} × ${i.portion}`, grams: i.grams ? Math.round(i.grams * k) : undefined, kcal: Math.round(i.kcal * k), protein: Math.round(i.protein * k), carbs: Math.round(i.carbs * k), fat: Math.round(i.fat * k) }));
    const t = round(sum(items));
    return { what: k === 1 ? f.name : `${f.name} × ${fmtQty(k)}`, protein: t.protein, kcal: t.kcal, items };
  };
  const estimate = async () => {
    setBusy(true); setErr('');
    try {
      const e = await estimateFoodText(text.trim());
      const items = e.items.map(i => ({ name: i.name, portion: i.portion, grams: i.grams, kcal: i.kcal, protein: i.protein, carbs: i.carbs, fat: i.fat }));
      const t = round(sum(items));
      onPick({ what: text.trim(), protein: t.protein, kcal: t.kcal, items });
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't estimate that"); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open onClose={onClose} title={`${slot.label} · ${clock(slot.time)}`}>
      <div className="pl-stack">
        <p className="pl-muted" style={{ fontSize: 13, margin: 0 }}>{gap > 0 ? `About ${gap} g here gets you to the goal.` : 'The plan already reaches the goal.'}</p>
        <div className="rc-count">
          <span className="pl-label" style={{ margin: 0 }}>{shake ? 'Scoops / servings' : 'Servings'}</span>
          <Button small ghost aria-label="Fewer" onClick={() => setServings(s => Math.max(0.5, s - 0.5))} disabled={servings <= 0.5}><Minus size={14} /></Button>
          <b>{fmtQty(servings)}</b>
          <Button small ghost aria-label="More" onClick={() => setServings(s => Math.min(6, s + 0.5))}><Plus size={14} /></Button>
        </div>
        {(recipes.length + favs.length > 6) && <Input placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />}

        {!shake && <>
          <p className="pl-label" style={{ margin: 0 }}>Your recipes</p>
          {rs.length ? <div className="pl-list">{rs.slice(0, 12).map(r => <RecipeRow key={r.id} r={r} onClick={() => onPick(recipeSlot(r, servings))} right={servings !== 1 ? <small className="pl-muted">→ {Math.round(r.perServing.protein * servings)} g</small> : null} />)}</div>
            : <p className="pl-muted" style={{ fontSize: 13, margin: 0 }}>No recipes yet.</p>}
          <Button onClick={() => onIdea(ideaG, servings)}><Sparkles size={15} /> Find me a recipe for ~{ideaG} g</Button>
        </>}

        <p className="pl-label" style={{ margin: 0 }}>{shake ? 'Shakes & favourites' : 'Favourites'}</p>
        {fs.length ? <div className="pl-list">{fs.slice(0, 10).map(f => (
          <button type="button" key={f.id} className="pl-item" onClick={() => onPick(fav(f))}>
            <div className="pl-grow"><b>{f.name}</b><small>{f.items.map(i => i.name).slice(0, 3).join(', ')}</small></div>
            <span className="rc-tag">{Math.round(f.totals.protein * servings)} g</span>
          </button>
        ))}</div> : <p className="pl-muted" style={{ fontSize: 13, margin: 0 }}>No favourites yet.</p>}
        {shake && <Button small ghost onClick={() => onIdea(Math.min(ideaG, 60), servings)}><Sparkles size={14} /> A shake recipe idea</Button>}

        <p className="pl-label" style={{ margin: 0 }}>Or type it</p>
        <div className="pl-row" style={{ gap: 8 }}>
          <Input className="pl-grow" value={text} onChange={e => setText(e.target.value)} placeholder={shake ? '2 scoops whey + 1 cup milk' : '8 oz chicken thighs + 1 cup rice'} onKeyDown={e => { if (e.key === 'Enter' && text.trim()) void estimate(); }} />
          <Button onClick={() => void estimate()} disabled={busy || !text.trim()}>{busy ? '…' : 'Estimate'}</Button>
        </div>

        <p className="pl-label" style={{ margin: 0 }}>Or just the grams</p>
        <div className="pl-row" style={{ gap: 8 }}>
          <Field label="Protein g"><Input inputMode="numeric" value={grams} onChange={e => setGrams(e.target.value.replace(/\D/g, ''))} style={{ width: 90 }} /></Field>
          <Field label="kcal (optional)"><Input inputMode="numeric" value={kcal} onChange={e => setKcal(e.target.value.replace(/\D/g, ''))} style={{ width: 100 }} /></Field>
          <Button primary style={{ alignSelf: 'flex-end' }} disabled={!Number(grams)} onClick={() => onPick({ what: slot.what && !slot.recipeId && !slot.items ? slot.what : `${slot.kind === 'shake' ? 'Shake' : 'Meal'}`, protein: Number(grams), kcal: Number(kcal) || undefined })}><Check size={15} /></Button>
        </div>
        {err && <p className="pl-error" style={{ margin: 0, fontSize: 13 }}>{err}</p>}
        {slot.what && <Button ghost onClick={onClear}><Trash2 size={15} /> Clear this slot</Button>}
      </div>
    </Sheet>
  );
}
